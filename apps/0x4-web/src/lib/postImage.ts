// 帖子 / 聊天图片地址：新上传的图片服务端返回大图 + 缩略图 + 宽高；老帖子只有一个原图地址，缩略图缺失时回退用原图
export interface PostImage { url: string; thumb?: string; w?: number; h?: number }

// 服务端文件名：<24 位 hex>_<宽>x<高>.webp，缩略图 <同名>_t.webp（群聊消息只存 url，靠文件名推出缩略图和比例）
const NAMED = /^(.*\/files\/[0-9a-f]{24})_(\d{1,5})x(\d{1,5})\.(webp|gif)$/

/** 补齐缩略图和宽高：显式字段优先，其次从文件名推，都没有就只剩原图 */
export function resolveImage(img: PostImage): PostImage {
  const m = NAMED.exec(img.url)
  const w = img.w || (m ? Number(m[2]) : undefined), h = img.h || (m ? Number(m[3]) : undefined)
  return { url: img.url, thumb: img.thumb || (m ? `${m[1]}_${m[2]}x${m[3]}_t.webp` : undefined), ...(w && h ? { w, h } : {}) }
}

/** 帖子里的图片列表：新帖子有 images，老帖子只有 image */
export function postImages(p: { image?: string | null; images?: PostImage[] | null }): PostImage[] {
  const list = Array.isArray(p.images) && p.images.length ? p.images : p.image ? [{ url: p.image }] : []
  return list.filter((x) => x && typeof x.url === 'string' && x.url).map(resolveImage)
}

/** 相对路径补上 API 域名；http、blob:、data: 原样用 */
export const absUrl = (u: string, base: string) => (/^(https?:|blob:|data:)/.test(u) ? u : base + u)

/** 列表里用的地址：有缩略图用缩略图，没有回退原图 */
export const thumbOf = (img: PostImage) => img.thumb || img.url
