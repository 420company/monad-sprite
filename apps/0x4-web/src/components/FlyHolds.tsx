// "Coins it bought for you" (diamond-hands tiers, 2026-09-27): in 2x-take-profit / diamond-hands mode, coins the sprite hands to the owner after buying.
// Shows average buy price, current multiple of buy price, and status; selling goes through swap (owner's own wallet signs); "stop tracking" frees the slot.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import TokenLogo from '@/components/TokenLogo'
import TradeSheet from '@/components/TradeSheet'
import { toast } from '@/components/Toast'
import { api } from '@/lib/social'
import { lookupAnyChain } from '@/lib/market'
import type { MarketToken } from '@/lib/types'
import { chainByDexKey } from '@/lib/chains'
import { fmtUsd } from '@/lib/format'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

interface Hold { id: string; chain: string; token: string; symbol: string; style: 'double' | 'diamond'; status: string; entryPrice: number; qty: number; usd: number; lastPrice: number | null; multiple: number | null; risk: string | null }

const STATUS: Record<string, string> = { holding: '拿着', half_proposed: '已建议出本', half_sold: '已出本', half_skipped: '拿着', sold: '已卖出' }

export default function FlyHolds({ flyId, holdStyle }: { flyId: string; holdStyle?: string }) {
  const [data, setData] = useState<{ list: Hold[]; active: number; cap: number } | null>(null)
  const [selling, setSelling] = useState<MarketToken | null>(null)
  const load = useCallback(() => api<{ list: Hold[]; active: number; cap: number }>(`/api/flies/${flyId}/holds`).then(setData).catch(() => {}), [flyId])
  useEffect(() => { load() }, [load])
  if (!data || (!data.list.length && (!holdStyle || holdStyle === 'quick'))) return null

  const sell = async (h: Hold) => {
    const fallback = { chain: h.chain, chainId: chainByDexKey(h.chain)?.id || 0, address: h.token, symbol: h.symbol, name: h.symbol, priceUsd: h.lastPrice || 0 } as MarketToken
    const found = await lookupAnyChain(h.token).catch(() => [] as MarketToken[])
    setSelling(found.find((x) => x.chain === h.chain) || found[0] || fallback)
  }
  const dismiss = async (h: Hold) => {
    try { await api(`/api/flies/${flyId}/holds/${h.id}/dismiss`, { method: 'POST' }); load() } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  return (
    <section className="mt-4 rounded-2xl border border-line/70 bg-card" aria-label={t('它帮你买的币')}>
      <div className="flex items-baseline justify-between px-4 pt-3">
        <h2 className="text-[15px] font-semibold">{t('它帮你买的币')}</h2>
        <span className="text-xs tabular-nums text-muted">{t('跟踪中 {n} / {cap}', { n: data.active, cap: data.cap })}</span>
      </div>
      {!data.list.length ? <p className="px-4 pb-4 pt-2 text-sm text-muted">{t('确认买入后，币会出现在这里，涨到 2 倍、5 倍、10 倍时提醒你。')}</p> : (
        <ul className="mt-1 divide-y divide-line/60">
          {data.list.map((h) => {
            const up = (h.multiple ?? 1) >= 1
            const done = h.status === 'sold'
            return (
              <li key={h.id} className="flex items-center gap-3 px-4 py-3">
                <TokenLogo symbol={h.symbol} chain={h.chain} address={h.token} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold"><span className="truncate">{h.symbol}</span>{h.risk && <AlertTriangle size={13} className="shrink-0 text-down" aria-label={t('有风险')} />}</div>
                  <div className="mt-0.5 truncate text-xs text-muted">{t('均价 {price}', { price: fmtUsd(h.entryPrice) })} · {t(STATUS[h.status] || '拿着')} · {h.style === 'double' ? t('翻倍出本') : t('钻石手')}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-sm font-semibold tabular-nums ${up ? 'text-up' : 'text-down'}`}>{h.multiple != null ? `${h.multiple.toFixed(2)}x` : '--'}</div>
                  {!done && <div className="mt-1 flex gap-3 text-xs"><button className="text-accent" onClick={() => sell(h)}>{t('卖出')}</button><button className="text-muted" onClick={() => dismiss(h)}>{t('不再跟踪')}</button></div>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {selling && <TradeSheet open side="sell" token={selling} onClose={() => { setSelling(null); load() }} onFilled={() => { setSelling(null); setTimeout(load, 3000) }} />}
    </section>
  )
}
