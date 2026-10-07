// Compress images on-device before uploading: saves bandwidth and upload time. Redrawn to canvas and re-exported, so EXIF (incl. GPS) is stripped too.
// Undecodable formats (e.g. HEIC on some browsers) and animated GIFs go to the server as-is; the server compresses once more uniformly.

interface Decoded { source: CanvasImageSource; width: number; height: number; close: () => void }

async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch { /* Retry with <img> */ }
  }
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (!img.naturalWidth) throw new Error('empty')
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch { URL.revokeObjectURL(url); return null }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality))

/** Draw within maxEdge on the long side, then export. WebP preferred; fall back to JPEG where the browser can't encode WebP — but not for possibly-transparent images (JPEG turns transparency black) */
async function encode(d: Decoded, maxEdge: number, quality: number, mayHaveAlpha: boolean): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null
  const scale = Math.min(1, maxEdge / Math.max(d.width, d.height))
  const width = Math.max(1, Math.round(d.width * scale)), height = Math.max(1, Math.round(d.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(d.source, 0, 0, width, height)
  try {
    const webp = await toBlob(canvas, 'image/webp', quality)
    if (webp && webp.type === 'image/webp') return { blob: webp, width, height }
    if (mayHaveAlpha) return null
    const jpeg = await toBlob(canvas, 'image/jpeg', quality)
    return jpeg && jpeg.type === 'image/jpeg' ? { blob: jpeg, width, height } : null
  } finally { canvas.width = canvas.height = 0 } // Release canvas memory promptly on iOS
}

const rename = (name: string, type: string) => (name.replace(/\.[^.]*$/, '') || 'image') + (type === 'image/webp' ? '.webp' : '.jpg')
const canHaveAlpha = (type: string) => /png|webp|gif|avif|heic|heif/i.test(type)

/** Pre-upload compression: long side 2048, quality 0.85. If it can't compress or the result isn't smaller, use the original */
export async function compressForUpload(file: File, maxEdge = 2048, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  const d = await decode(file)
  if (!d) return file
  try {
    const out = await encode(d, maxEdge, quality, canHaveAlpha(file.type))
    const native = /^image\/(jpeg|png|webp)$/.test(file.type)
    if (!out || (native && out.blob.size >= file.size && Math.max(d.width, d.height) <= maxEdge)) return file
    return new File([out.blob], rename(file.name, out.blob.type), { type: out.blob.type })
  } catch { return file } finally { d.close() }
}

/** DM images: the server can't see plaintext, so the full image + thumbnail must be produced on-device at the uniform spec (same as server: 1600 / 720). null when undecodable */
export async function makeImageVariants(file: Blob): Promise<{ large: Blob; thumb: Blob; width: number; height: number } | null> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return null
  const d = await decode(file)
  if (!d) return null
  try {
    const alpha = canHaveAlpha(file.type)
    const large = await encode(d, 1600, 0.8, alpha)
    const thumb = large && await encode(d, 720, 0.7, alpha)
    return large && thumb ? { large: large.blob, thumb: thumb.blob, width: large.width, height: large.height } : null
  } catch { return null } finally { d.close() }
}
