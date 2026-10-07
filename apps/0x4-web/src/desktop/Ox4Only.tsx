// Promo card for 0x4 Wallet-exclusive features (2026-09-30 goat: perp trading etc. are our wallet's exclusives — good for pushing the wallet; the prompt should look sharp, few words, instantly clear).
// When the web build connects an external wallet (MetaMask, Phantom, etc.), perp trading, web quick-trade, DMs, sprite full-auto, and Bitcoin swap into this card;
// with 0x4 Wallet connected — or on the mobile app — render as usual. The card carries only: a cat head, one big title, one short line, "Get 0x4 Wallet", plus an unobtrusive "Already installed? Connect".
import { ArrowRight } from 'lucide-react'
import { isExternalWallet, useWallet } from '@/store/wallet'
import { WEB_SURFACE } from '@/lib/surface'
import { t } from '@/lib/i18n'
import catUrl from './cat-tight.svg'
import { connectOx4, getOx4Wallet } from './walletGate'

export type Ox4Feature = 'perp' | 'dm' | 'auto' | 'btc'

/** One short line per exclusive feature (the big title is always "0x4 Wallet Exclusive") */
const LINE: Record<Ox4Feature, () => string> = {
  perp: () => t('合约交易，一键开单'),
  dm: () => t('私信，端到端加密'),
  auto: () => t('小精灵全自动交易'),
  btc: () => t('比特币收发'),
}

/** Whether an external wallet is currently connected (exclusive features swap to the promo card). Always false on the mobile app */
export function useExternalWallet(): boolean {
  const ext = useWallet(isExternalWallet)
  return WEB_SURFACE && ext
}

/** Exclusive-feature shell: swaps to the promo card for external wallets */
export default function Ox4Only({ feature, children, compact = false }: { feature: Ox4Feature; children: React.ReactNode; compact?: boolean }) {
  if (!useExternalWallet()) return <>{children}</>
  return <Ox4OnlyCard feature={feature} compact={compact} />
}

/** The promo card itself (also used directly inside sheets) */
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
