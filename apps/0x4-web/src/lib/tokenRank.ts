// 选币搜索结果怎么排（2026-10-03 goat：「小精灵搜币为什么没显示官方？搜 uni 出来好多」）。
// 和行情搜索 lib/market.ts rankSearch 同一张官方表（lib/officialTokens.ts）、同一套规则：
// 主流币的官方合约排最前、标「官方」；符号冒充主流币的（也叫 UNI 却不在官方表里、UNI-ERC20 这类）不显示；
// 粘贴合约地址搜的不过滤（用户点名要那个）。手机选币弹层和网页版下拉（components/TokenPicker usePickerLists）都用这里。
import { chainById, type ChainToken } from './chains'
import { mainstreamLookalike, officialAssetOf } from './officialTokens'

/** 一次最多列多少个搜索结果（LI.FI 搜 uni 能回来四百多个） */
export const PICK_LIMIT = 50

/** 主流币的官方合约 */
export const isOfficial = (t: ChainToken): boolean => { const c = chainById(t.chainId); return !!c && !!officialAssetOf(c.dexKey, t.address) }
const isAddressQuery = (q: string) => /^0x[0-9a-f]{40}$/i.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)

export function rankPicked(list: ChainToken[], q: string): ChainToken[] {
  const keep = isAddressQuery(q.trim()) ? list : list.filter((x) => { if (isOfficial(x)) return true; const like = mainstreamLookalike(x.symbol); return !like || !!like.loose })
  return [...keep.filter(isOfficial), ...keep.filter((x) => !isOfficial(x))].slice(0, PICK_LIMIT)
}
