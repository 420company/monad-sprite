// Post / chat image URLs: newly uploaded images come back from the server with full + thumbnail + dimensions; old posts only have the original URL, falling back to it when the thumbnail is missing
export interface PostImage { url: string; thumb?: string; w?: number; h?: number }

// Server filenames: <24 hex chars>_<width>x<height>.webp, thumbnails <same>_t.webp (group chat messages only store the url; thumbnail and aspect ratio are derived from the filename)
const NAMED = /^(.*\/files\/[0-9a-f]{24})_(\d{1,5})x(\d{1,5})\.(webp|gif)$/

/** Fill in thumbnail and dimensions: explicit fields first, then derive from the filename; with neither, only the original remains */
export function resolveImage(img: PostImage): PostImage {
  const m = NAMED.exec(img.url)
  const w = img.w || (m ? Number(m[2]) : undefined), h = img.h || (m ? Number(m[3]) : undefined)
  return { url: img.url, thumb: img.thumb || (m ? `${m[1]}_${m[2]}x${m[3]}_t.webp` : undefined), ...(w && h ? { w, h } : {}) }
}

/** Image list in a post: new posts have images, old posts only image */
export function postImages(p: { image?: string | null; images?: PostImage[] | null }): PostImage[] {
  const list = Array.isArray(p.images) && p.images.length ? p.images : p.image ? [{ url: p.image }] : []
  return list.filter((x) => x && typeof x.url === 'string' && x.url).map(resolveImage)
}

/** Prefix relative paths with the API domain; http, blob:, and data: are used as-is */
export const absUrl = (u: string, base: string) => (/^(https?:|blob:|data:)/.test(u) ? u : base + u)

/** The URL used in lists: thumbnail when available, original as fallback */
export const thumbOf = (img: PostImage) => img.thumb || img.url
