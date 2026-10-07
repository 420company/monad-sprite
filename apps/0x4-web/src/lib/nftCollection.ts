// 进群门槛「持有 NFT」的系列识别：玩家贴地址，服务端认链、认名字（GET /api/nft/collection）。
// 这里只放和界面无关的部分：接口调用、防抖、丢掉过期回包，方便单测状态流转。
import { api } from './social'
import { errorText } from '@/lib/errors'
import { t } from './i18n'

export interface NftCollectionInfo {
  chainId: number
  name: string
  image?: string
  standard: 'erc721' | 'erc1155' | 'metaplex'
  verified: boolean
  /** 同一个地址在多条链上都有 NFT 合约时，全部列出（第一个就是默认选中的） */
  candidates?: NftCollectionInfo[]
}

export type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; result: NftCollectionInfo }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export type CollectionFetcher = (contract: string, chainId: number | null) => Promise<NftCollectionInfo | null>

/** 真接口：404 = 没识别到，返回 null；其他错误照常抛 */
export const fetchCollection: CollectionFetcher = async (contract, chainId) => {
  const qs = new URLSearchParams({ contract })
  if (chainId) qs.set('chainId', String(chainId))
  try {
    return await api<NftCollectionInfo>(`/api/nft/collection?${qs}`)
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 404 || status === 400) return null // 400 = 地址格式不对，对玩家来说也是「没识别到」
    throw e
  }
}

const looksLikeAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)

/**
 * 防抖识别。每次 request 都会作废之前还没回来的请求，只有最后一次的结果会通知出去：
 * 用户边打字边等时，先发出去的慢请求不会盖掉后来的结果。
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
    /** 组件卸载 / 切走时调用，之后回来的结果一律丢弃 */
    cancel() { stop(); seq++ },
  }
}
