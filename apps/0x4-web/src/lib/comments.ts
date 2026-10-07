// 评论：类型、帖子下面露哪几条（纯函数，有单测）、点赞请求。
// 信息流 / 个人主页 / 代币页的帖子下面只露最多 2 条：赞多的优先；赞一样（包括都没人赞）取最新的。
// 服务端 topComments 已经按这个规则挑好了；客户端本地点了赞、删了评论之后再用同一个规则重排，两边不会不一致。
export interface Comment { id: string; author: string; nickname: string | null; avatar: string | null; handle: string | null; text: string; createdAt: number; likes: number; likedByMe: boolean }

export const PREVIEW_COUNT = 2
export const COMMENT_PAGE = 20

/** 从一组评论里挑出帖子下面要露的几条：赞数降序 → 时间降序 → id 降序（同一毫秒也有确定的顺序） */
export function previewComments<T extends Pick<Comment, 'id' | 'likes' | 'createdAt'>>(list: readonly T[], n = PREVIEW_COUNT): T[] {
  return [...list].sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, Math.max(0, n))
}

/** 老服务端的评论没有 likes / likedByMe，补上默认值 */
export const normComment = (c: Partial<Comment> & { id: string; author: string; text: string; createdAt: number }): Comment => ({
  nickname: null, avatar: null, handle: null, ...c, likes: c.likes ?? 0, likedByMe: !!c.likedByMe,
})
