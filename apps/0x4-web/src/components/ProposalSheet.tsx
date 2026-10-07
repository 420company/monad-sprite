// 果蝇提案确认弹层（真金 · 确认下单模式）：果蝇想买 / 卖 → 推送到手机 → 一键打开下单，用自己的钱包签名
import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Button from './Button'
import TradeSheet from './TradeSheet'
import { toast } from './Toast'
import { api, type FlyProposal } from '@/lib/social'
import { lookupAnyChain } from '@/lib/market'
import { chainByDexKey } from '@/lib/chains'
import type { MarketToken } from '@/lib/types'
import { useSocial } from '@/store/social'
import { t, useLang } from '@/lib/i18n'

export default function ProposalSheet() {
  const lang = useLang((s) => s.lang)
  const { flyProposals, dismissProposal } = useSocial()
  const p: FlyProposal | undefined = flyProposals[0]
  const [token, setToken] = useState<MarketToken | null>(null)
  const [trading, setTrading] = useState(false)
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!p) { setToken(null); return }
    // 拉一次行情把提案里的币补全成可下单的代币对象；拉不到就用最小信息
    const fallback: MarketToken = { chain: p.chain, chainId: chainByDexKey(p.chain)?.id || 0, address: p.token, symbol: p.symbol, name: p.symbol, priceUsd: p.price || 0 } as MarketToken
    // 名字用小精灵自己的叫法（BNB），不露出行情里的 WBNB，和行情自选一样（2026-10-04）
    lookupAnyChain(p.token).then((l) => { const hit = l.find((t) => t.chain === p.chain) || l[0]; setToken(hit ? { ...hit, symbol: p.symbol } : fallback) }).catch(() => setToken(fallback))
  }, [p?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!p) return; const t = setInterval(() => setLeft(Math.max(0, p.expiresAt - Date.now())), 1000); return () => clearInterval(t) }, [p])
  if (!p) return null
  const finish = async (action: 'done' | 'skip', tx?: string) => { try { await api(`/api/fly/proposals/${p.id}/${action}`, { method: 'POST', body: JSON.stringify({ tx }) }) } catch { /* 过期或已处理 */ } dismissProposal(p.id) }
  return (
    <>
      <Sheet open={!trading} onClose={() => finish('skip')} title={t('交易建议')}>
        <div className="rounded-2xl bg-card2 p-4">
          <div className="text-xs text-muted">{p.kind === 'half' ? t('{name}：已经翻倍了，建议卖出一半拿回本金', { name: p.flyName }) : t('{name} 想', { name: p.flyName })}</div>
          <div className={`mt-1 text-3xl font-black ${p.side === 'buy' ? 'text-up' : 'text-down'}`}>{p.side === 'buy' ? t('买入 {symbol}', { symbol: p.symbol }) : p.kind === 'half' ? t('卖出一半 {symbol}', { symbol: p.symbol }) : t('卖出 {symbol}', { symbol: p.symbol })}</div>
          {(lang === 'en' ? p.sayEn : p.say) && <p className="mt-3 text-[15px] leading-relaxed">“{lang === 'en' ? p.sayEn : p.say}”</p>}
          <div className="mt-1 text-sm text-muted">{t('约 ${usd} · 还剩 {n} 分钟', { usd: p.usd.toFixed(0), n: Math.ceil(left / 60000) })}</div>
        </div>
        <Button size="lg" className="mt-4 w-full" disabled={!token} onClick={() => setTrading(true)}>{t('确认')}</Button>
        <Button size="md" variant="ghost" className="mt-2 w-full text-muted" onClick={() => finish('skip')}>{t('跳过')}</Button>
      </Sheet>
      {token && <TradeSheet open={trading} side={p.side} token={token} initialPct={p.kind === 'half' ? 50 : undefined} initialUsd={p.kind === 'half' ? undefined : p.usd} onClose={() => { setTrading(false); if (!flyProposals.length) return }} onFilled={(tx) => { toast.success(t('已按小精灵提案成交')); finish('done', tx); setTrading(false) }} />}
    </>
  )
}
