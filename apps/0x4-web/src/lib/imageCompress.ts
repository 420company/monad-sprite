// 上传前在本机先压一遍图：省流量和上传时间。重新画到 canvas 再导出，EXIF（含 GPS）也一起没了。
// 解不开的格式（比如部分浏览器的 HEIC）、GIF 动图原样交给服务端；服务端还会再统一压一次。

interface Decoded { source: CanvasImageSource; width: number; height: number; close: () => void }

async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch { /* 换 <img> 再试 */ }
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

/** 画到长边 maxEdge 以内再导出。优先 WebP；浏览器不会编 WebP 时退 JPEG，但可能带透明的图不退（JPEG 会把透明变黑） */
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
  } finally { canvas.width = canvas.height = 0 } // iOS 上及时释放画布内存
}

const rename = (name: string, type: string) => (name.replace(/\.[^.]*$/, '') || 'image') + (type === 'image/webp' ? '.webp' : '.jpg')
const canHaveAlpha = (type: string) => /png|webp|gif|avif|heic|heif/i.test(type)

/** 上传前压缩：长边 2048、质量 0.85。压不了或压完没变小就用原文件 */
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

/** 私信图片：服务端看不到明文，只能在本机按统一规格出大图 + 缩略图（与服务端同规格：1600 / 720）。解不开返回 null */
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
