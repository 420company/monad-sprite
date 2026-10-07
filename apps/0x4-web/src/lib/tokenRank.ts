// How token-picker search results rank (2026-10-03 goat: "why doesn't the sprite's token search show the official one? searching uni returns so many").
// Same official table (lib/officialTokens.ts) and same rules as markets search lib/market.ts's rankSearch:
// blue-chip tokens' official contracts rank first and carry the "official" mark; symbol-squatters on blue-chip names (also called UNI but absent from the official table, UNI-ERC20 types) aren't shown;
// pasted-contract-address searches aren't filtered (the user asked for that one by name). The mobile token-picker sheet and the web dropdown (components/TokenPicker usePickerLists) both use this.
import { chainById, type ChainToken } from './chains'
import { mainstreamLookalike, officialAssetOf } from './officialTokens'

/** Max search results per query (searching uni on LI.FI returns 400+) */
export const PICK_LIMIT = 50

/** Blue-chip tokens' official contracts */
export const isOfficial = (t: ChainToken): boolean => { const c = chainById(t.chainId); return !!c && !!officialAssetOf(c.dexKey, t.address) }
const isAddressQuery = (q: string) => /^0x[0-9a-f]{40}$/i.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)

export function rankPicked(list: ChainToken[], q: string): ChainToken[] {
  const keep = isAddressQuery(q.trim()) ? list : list.filter((x) => { if (isOfficial(x)) return true; const like = mainstreamLookalike(x.symbol); return !like || !!like.loose })
  return [...keep.filter(isOfficial), ...keep.filter((x) => !isOfficial(x))].slice(0, PICK_LIMIT)
}
