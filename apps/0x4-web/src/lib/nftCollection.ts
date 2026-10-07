// Collection identification for the "hold NFT" group gate: the user pastes an address; the server identifies the chain and name (GET /api/nft/collection).
// Only UI-independent parts here: the API call, debouncing, dropping stale responses — easy to unit-test the state flow.
import { api } from './social'
import { errorText } from '@/lib/errors'
import { t } from './i18n'

export interface NftCollectionInfo {
  chainId: number
  name: string
  image?: string
  standard: 'erc721' | 'erc1155' | 'metaplex'
  verified: boolean
  /** When the same address has NFT contracts on multiple chains, list them all (the first is the default selection) */
  candidates?: NftCollectionInfo[]
}

export type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; result: NftCollectionInfo }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export type CollectionFetcher = (contract: string, chainId: number | null) => Promise<NftCollectionInfo | null>

/** The real endpoint: 404 = not identified, returns null; other errors throw as usual */
export const fetchCollection: CollectionFetcher = async (contract, chainId) => {
  const qs = new URLSearchParams({ contract })
  if (chainId) qs.set('chainId', String(chainId))
  try {
    return await api<NftCollectionInfo>(`/api/nft/collection?${qs}`)
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 404 || status === 400) return null // 400 = bad address format, which is also "not identified" to the user
    throw e
  }
}

const looksLikeAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)

/**
 * Debounced identification. Each request voids previous unreturned requests; only the last result is notified:
 * when a user types and waits, an earlier slow request can't overwrite the later result.
 */
export function createCollectionLookup(fetcher: CollectionFetcher, onState: (s: LookupState) => void, delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0
  const stop = () => { if (timer) { clearTimeout(timer); timer = null } }
  return {
    request(contractIn: string, chainId: number | null = null) {
      stop()
      const my = ++seq
      const contract = contractIn.trim()
      if (!contract) { onState({ status: 'idle' }); return }
      onState({ status: 'loading' })
      timer = setTimeout(async () => {
        timer = null
        if (!looksLikeAddress(contract)) { if (my === seq) onState({ status: 'missing' }); return }
        try {
          const r = await fetcher(contract, chainId)
          if (my !== seq) return
          onState(r ? { status: 'found', result: r } : { status: 'missing' })
        } catch (e) {
          if (my !== seq) return
          onState({ status: 'error', message: errorText(e, t('操作失败')) })
        }
      }, delayMs)
    },
    /** Called on component unmount / switch-away; results arriving afterwards are all dropped */
    cancel() { stop(); seq++ },
  }
}
