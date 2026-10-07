// Comments: types, which ones peek under a post (pure functions, unit-tested), like requests.
// Under posts in the feed / profiles / token pages: at most 2 shown — most likes first; like-count ties (incl. zero likes) take the newest.
// The server's topComments are already picked by this rule; the client re-applies the same rule after local likes / deletes — the two sides never disagree.
export interface Comment { id: string; author: string; nickname: string | null; avatar: string | null; handle: string | null; text: string; createdAt: number; likes: number; likedByMe: boolean }

export const PREVIEW_COUNT = 2
export const COMMENT_PAGE = 20

/** Pick the comments to peek under a post from a set: likes desc → time desc → id desc (deterministic order even within the same millisecond) */
export function previewComments<T extends Pick<Comment, 'id' | 'likes' | 'createdAt'>>(list: readonly T[], n = PREVIEW_COUNT): T[] {
  return [...list].sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, Math.max(0, n))
}

/** Comments from old servers lack likes / likedByMe — fill in defaults */
export const normComment = (c: Partial<Comment> & { id: string; author: string; text: string; createdAt: number }): Comment => ({
  nickname: null, avatar: null, handle: null, ...c, likes: c.likes ?? 0, likedByMe: !!c.likedByMe,
})
