// 0x4 Wallet 专属功能的提示卡（2026-09-30 goat：合约交易这些就是我们钱包专属，好推钱包；提示要帅、字少、一看就懂）。
// 网页版连的是外部钱包（MetaMask、Phantom 等）时，合约交易、网页快捷交易、私信、小精灵全自动、比特币换成这张卡；
// 连的是 0x4 Wallet、或者手机 App，原样渲染。卡上只有：猫头、一句大标题、一行短说明、「获取 0x4 Wallet」，外加一个不打扰的「已经装了？连接」。
import { ArrowRight } from 'lucide-react'
import { isExternalWallet, useWallet } from '@/store/wallet'
import { WEB_SURFACE } from '@/lib/surface'
import { t } from '@/lib/i18n'
import catUrl from './cat-tight.svg'
import { connectOx4, getOx4Wallet } from './walletGate'

export type Ox4Feature = 'perp' | 'dm' | 'auto' | 'btc'

/** 每个专属功能的一行短说明（大标题统一是「0x4 Wallet 专属」） */
const LINE: Record<Ox4Feature, () => string> = {
  perp: () => t('合约交易，一键开单'),
  dm: () => t('私信，端到端加密'),
  auto: () => t('小精灵全自动交易'),
  btc: () => t('比特币收发'),
}

/** 现在是不是外部钱包（专属功能要换成提示卡）。手机 App 恒为 false */
export function useExternalWallet(): boolean {
  const ext = useWallet(isExternalWallet)
  return WEB_SURFACE && ext
}

/** 专属功能外壳：外部钱包时换成提示卡 */
export default function Ox4Only({ feature, children, compact = false }: { feature: Ox4Feature; children: React.ReactNode; compact?: boolean }) {
  if (!useExternalWallet()) return <>{children}</>
  return <Ox4OnlyCard feature={feature} compact={compact} />
}

/** 提示卡本身（弹层里也直接用它） */
export function Ox4OnlyCard({ feature, compact = false }: { feature: Ox4Feature; compact?: boolean }) {
  return (
    <section className={`ox4-only ${compact ? 'is-compact' : ''}`} aria-labelledby={`ox4-only-${feature}`}>
      <span className="ox4-only-glow" aria-hidden="true" />
      <span className="ox4-only-cat" aria-hidden="true"><img src={catUrl} alt="" width={58} height={42} /></span>
      <h2 id={`ox4-only-${feature}`} className="ox4-only-title">{t('0x4 Wallet 专属')}</h2>
      <p className="ox4-only-line">{LINE[feature]()}</p>
      <button type="button" className="wc-btn is-primary is-lg ox4-only-btn" onClick={getOx4Wallet}>{t('获取 0x4 Wallet')}<ArrowRight size={16} aria-hidden="true" /></button>
      <button type="button" className="ox4-only-link" onClick={() => void connectOx4()}>{t('已经装了？连接 0x4 Wallet')}</button>
    </section>
  )
}
