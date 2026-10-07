// 合约小精灵开的单（2026-10-05 goat：「小精灵开的单子没地方能看」）。小精灵页「交易」里给主人看：
// 当前持仓 = 服务器用小精灵自己的交易密钥向交易所读的账户（GET /api/flies/:id/perp-positions，15 秒一份）；
// 最近成交 = 小精灵回报的成交（和「数据」里的成交记录同一份）。账户是主人自己的合约账户，手动开的仓也会在这里。
import { useEffect, useState } from 'react'
import { api } from '@/lib/social'
import { fmtUsd, timeAgo } from '@/lib/format'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { displaySymbol } from '@/lib/flyText'

interface Pos { symbol: string; coin: string; side: 'long' | 'short'; size: number; entry: number; upnl: number; leverage: number; margin: number }
interface Reply { equity: number | null; available: number | null; positions: Pos[]; at: number }
export interface PerpFill { id: string; side: 'buy' | 'sell'; symbol: string; qty: number; usd: number; price: number; created_at: number; chain: string }

const num = (n: number, d = 4) => n.toLocaleString(undefined, { maximumFractionDigits: d })
const pnl = (n: number) => `${n >= 0 ? '+' : '-'}${fmtUsd(Math.abs(n))}`

export default function FlyPerpPositions({ flyId, tick, fills, marginUsd }: { flyId: string; tick?: number | null; fills: PerpFill[]; /** 单次保证金：可用比它少就开不了新单 */ marginUsd: number }) {
  const [r, setR] = useState<Reply | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => api<Reply>(`/api/flies/${flyId}/perp-positions`).then((x) => { if (alive) { setR(x); setErr(null) } }).catch((e) => { if (alive) setErr(errorText(e, t('暂时读不到合约账户'))) })
    void load()
    const timer = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(timer) }
  }, [flyId, tick])
  // 合约成交（小精灵按「币-PERP」记），最近 5 笔
  const recent = fills.filter((f) => /-PERP$/.test(f.symbol)).slice(0, 5)
  return (
    <section className="mt-3 overflow-hidden rounded-2xl bg-card" aria-label={t('合约账户持仓')}>
      <div className="flex items-baseline justify-between px-4 pt-3"><h3 className="text-sm font-semibold">{t('合约账户持仓')}</h3>{r?.available != null && <span className="text-xs text-muted">{t('可用 {usd}', { usd: fmtUsd(r.available) })}</span>}</div>
      {/* 可用保证金不够单次保证金：小精灵每次开新单都会被交易所拒（2026-10-05 goat 的账户：可用 8.91 < 10） */}
      {r?.available != null && r.available < marginUsd && <p className="mx-4 mt-2 rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{t('可用保证金 {a} 不够单次保证金 {m}，小精灵开不了新单。存入更多 USDT，或在「交易方式」里调低单次保证金。', { a: fmtUsd(r.available), m: fmtUsd(marginUsd) })}</p>}
      {err && !r ? <p className="px-4 py-4 text-sm text-muted">{err}</p>
        : !r ? <div className="mx-4 my-4 skeleton h-12" />
          : r.positions.length === 0 ? <p className="px-4 py-4 text-sm text-muted">{t('现在没有持仓')}</p>
            : <ul className="divide-y divide-line/60">{r.positions.map((p) => (
              <li key={p.symbol} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{p.coin} <span className={p.side === 'long' ? 'text-up' : 'text-down'}>{p.side === 'long' ? t('做多') : t('做空')}</span> <span className="text-xs font-normal text-muted">{p.leverage}x</span></div>
                  <div className="mt-0.5 text-xs text-muted tabular-nums">{t('{size} 个 · 开仓价 {price} · 保证金 {margin}', { size: num(p.size), price: num(p.entry, 6), margin: fmtUsd(p.margin) })}</div>
                </div>
                <div className={`shrink-0 text-right text-[15px] font-semibold tabular-nums ${p.upnl >= 0 ? 'text-up' : 'text-down'}`}>{pnl(p.upnl)}<div className="text-[11px] font-normal text-muted">{t('浮动盈亏')}</div></div>
              </li>
            ))}</ul>}
      {recent.length > 0 && <>
        <h3 className="border-t border-line/60 px-4 pt-3 text-sm font-semibold">{t('最近成交')}</h3>
        <ul className="pb-2">{recent.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
            <span><span className={f.side === 'buy' ? 'text-up' : 'text-down'}>{f.side === 'buy' ? t('买入') : t('卖出')}</span> {displaySymbol(f.symbol)} <span className="text-muted tabular-nums">{num(f.qty)} @ {num(f.price, 6)}</span></span>
            <span className="shrink-0 text-muted">{timeAgo(f.created_at)}</span>
          </li>
        ))}</ul>
      </>}
    </section>
  )
}
