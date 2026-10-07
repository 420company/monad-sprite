// "Me" page → Gas (2026-09-27 goat): auto gas top-up switch + BNB reserve amount (min $10) + per-chain gas status
// The reserve is BNB on BSC in the user's own wallet: the app never touches it when buying coins, only uses it to top up gas on other chains (lib/gas.ts)
import { useEffect, useState } from 'react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import FuelGauge from '@/components/FuelGauge'
import { Pager, usePager } from '@/components/ListState'
import { ensureUnlocked } from '@/lib/vault/gate'
import { toast } from '@/components/Toast'
import { usePortfolio } from '@/store/portfolio'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { loadGasRules, BSC, RESERVE_MIN_USD, fuelLevel, gasRule, nativeUsd, type FuelLevel } from '@/lib/gas'
import { useRefuel } from '@/lib/useRefuel'
import { chainById, isGasToken } from '@/lib/chains'
import { ADDABLE_FUEL_CHAINS, fuelChainName, fuelWatchList, isRouteDown, onRouteChange } from '@/lib/fuelChains'
import { Check, LoaderCircle, Minus, Plus, Search } from 'lucide-react'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

// Last quote time for user-added chains (within this app open)
const probedAt = new Map<number, number>()
const prefersReducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

export default function FuelSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { autoRefuel, gasReserveUsd, setAutoRefuel, fuelChains, removeFuelChain } = useSettings()
  const holdings = usePortfolio((s) => s.holdings)
  const scannedChains = usePortfolio((s) => s.scannedChains)
  // Shown chains: the default five + user-added ones (lib/fuelChains.ts; auto top-up reads the same list)
  const watch = fuelWatchList(fuelChains)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [leaving, setLeaving] = useState<number | null>(null)
  // Re-render when a route's "temporarily unavailable" mark changes (quote failed / recovered)
  const [, setRouteTick] = useState(0)
  useEffect(() => onRouteChange(() => setRouteTick((x) => x + 1)), [])
  useEffect(() => { if (!fuelChains.length) setEditing(false) }, [fuelChains.length])
  // Remove: fade out first, then delete (delete directly under reduce-motion)
  const removeChain = (id: number) => {
    if (prefersReducedMotion()) { removeFuelChain(id); return }
    setLeaving(id)
    setTimeout(() => { removeFuelChain(id); setLeaving(null) }, 180)
  }
  const evmAccount = useWallet((s) => s.evmAccount)
  const { run, checkRoute, busyChain, bnbUsd } = useRefuel()
  // On open, quote each user-added chain once (skip ones quoted within 30 min); rows with no route yet show "temporarily untoppable" inline
  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      for (const id of fuelChains) {
        if (!alive) return
        if (Date.now() - (probedAt.get(id) || 0) < 30 * 60_000) continue
        const r = await checkRoute(id, gasRule(id).topUpUsd)
        if (r !== null) probedAt.set(id, Date.now())
      }
    })()
    return () => { alive = false }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(String(gasReserveUsd))
  // Per-chain gas standards follow the server's measurements (refreshed every 3h) — re-evaluate once received
  const [, setRulesTick] = useState(0)
  useEffect(() => { loadGasRules().then(() => setRulesTick((x) => x + 1)) }, [])
  useEffect(() => { if (open) setDraft(String(gasReserveUsd)) }, [open, gasReserveUsd])

  const commit = (on: boolean) => {
    const n = Math.round(Number(draft) || 0)
    if (on && n < RESERVE_MIN_USD) { toast.error(t('燃料费预存最少 ${n}', { n: RESERVE_MIN_USD })); return }
    setAutoRefuel(on, on ? n : undefined)
    if (on) toast.success(t('已开启自动补充燃料费'))
  }
  const short = autoRefuel ? Math.max(0, gasReserveUsd - bnbUsd) : 0

  // 2026-09-29 goat: too much text at the top with ugly line breaks and alignment; icon swapped for the three-level gas gauge (components/FuelGauge).
  // Layout: keep one line of explanation; labels on the left, values / switches / buttons on the right in cards, uniform 16px padding; every chain has something on the right (button or status) for left-right alignment
  return (
    <Sheet open={open} onClose={onClose} title={t('燃料费')}>
      <p className="text-[13px] leading-6 text-muted"><span className="block">{t('每条链用自己的币付燃料费。')}</span><span className="block text-pretty">{t('开启自动补充，哪条链不够就从 BNB 换一点过去。')}</span></p>

      <div className="mt-4 rounded-2xl bg-card2 p-4">
        <button role="switch" aria-checked={autoRefuel} onClick={() => commit(!autoRefuel)} className="flex w-full items-center justify-between gap-4 text-left">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold leading-6">{t('自动补充燃料费')}</span>
            <span className="block text-pretty text-xs leading-5 text-muted">{t('从 BNB 预存里补，不收平台手续费')}</span>
          </span>
          <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${autoRefuel ? 'bg-accent' : 'bg-line'}`} aria-hidden><span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${autoRefuel ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></span>
        </button>

        <div className="mt-4 border-t border-line/60 pt-4">
          <label htmlFor="fuel-reserve" className="flex items-baseline justify-between text-xs leading-5">
            <span className="text-muted">{t('BNB 预存')}</span>
            <span className="text-muted/80">{t('最少 ${n}', { n: RESERVE_MIN_USD })}</span>
          </label>
          <div className="mt-1.5 flex h-11 items-center gap-1 rounded-xl border border-line bg-card px-3">
            <span className="text-sm text-muted">$</span>
            <input id="fuel-reserve" inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))} onBlur={() => autoRefuel && commit(true)} className="w-full bg-transparent text-base tabular-nums text-fg outline-none" />
          </div>
          <div className="mt-3 flex items-baseline justify-between text-sm leading-6">
            <span className="text-muted">{t('钱包里的 BNB')}</span>
            <span className="tabular-nums">${bnbUsd.toFixed(2)}</span>
          </div>
          {autoRefuel && short > 0.5 && <p className="mt-2 text-pretty text-xs leading-5 text-warning">{t('BNB 比预存金额少约 ${usd}。可以在「兑换」里换一些，或从交易所转入。', { usd: short.toFixed(2) })}</p>}
          {autoRefuel && <p className="mt-2 text-pretty text-xs leading-5 text-muted">{t('预存的 BNB 留在你的钱包里，只用来补燃料费。')}</p>}
        </div>
      </div>

      {/* 2026-09-29 goat: "Add chain" sits above the chain list as an action area, not as a row inside the list — so it doesn't blend in with chains */}
      <div className="mt-5 mb-2 flex items-center gap-2 px-1">
        <span className="flex-1 text-xs font-medium tracking-wide text-muted">{t('各链余额')}</span>
        {fuelChains.length > 0 && <button onClick={() => setEditing((v) => !v)} className="h-8 shrink-0 rounded-full px-3 text-xs font-medium text-muted active:bg-card2">{editing ? t('完成') : t('编辑')}</button>}
        <button onClick={() => { setEditing(false); setPicking(true) }} className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 pr-3 pl-2.5 text-xs font-semibold text-accent active:bg-accent/20">
          <Plus size={14} strokeWidth={2.6} />{t('添加链路')}
        </button>
      </div>
      <div className="divide-y divide-line/60 rounded-2xl bg-card px-4">
        {watch.map((id) => {
          const c = chainById(id); if (!c) return null
          const usd = nativeUsd(holdings, id), rule = gasRule(id)
          const level = fuelLevel(id, usd, autoRefuel ? gasReserveUsd : RESERVE_MIN_USD)
          const ok = usd >= rule.minUsd
          const hasCoins = holdings.some((h) => h.chainId === id && !isGasToken(id, h.mint) && h.valueUsd >= 1)
          const extra = fuelChains.includes(id)
          const down = id !== BSC && isRouteDown(id)
          const name = fuelChainName(c.name)
          // A just-added chain whose balance hasn't been scanned yet: hold judgment, show "loading" — not "low" or the top-up button
          const pending = extra && !scannedChains.includes(id)
          return (
            <div key={id} className={`flex min-h-16 items-center gap-3 py-3 ${leaving === id ? 'fuel-row-out' : extra ? 'fuel-row-in' : ''}`}>
              {editing && extra
                ? <button onClick={() => removeChain(id)} aria-label={t('移除 {chain}', { chain: name })} className="grid size-[26px] shrink-0 place-items-center rounded-full bg-down text-white"><Minus size={16} strokeWidth={2.6} /></button>
                : <FuelGauge level={pending ? 'middle' : level} size={26} className={`text-muted ${pending ? 'opacity-40' : ''}`} />}
              <span className="min-w-0 flex-1">
                {/* 2026-09-29 goat: the status word sits next to the chain name, not competing with the top-up button on the right */}
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium leading-5">{name}</span>
                  {!pending && <span className={`shrink-0 rounded-full px-1.5 text-[11px] font-medium leading-[18px] ${FUEL_TONE[level]}`}>{fuelShort(level)}</span>}
                </span>
                <span className="block text-xs leading-5 text-muted tabular-nums">{pending ? `${c.native.symbol} · ${t('读取中')}` : `${c.native.symbol} · $${usd.toFixed(2)}`}</span>
                {!ok && hasCoins && <span className="block text-xs leading-5 text-warning">{t('卖出前需要补充')}</span>}
              </span>
              {/* The button just says "Add" (2026-09-29 goat); the amount is stated in the verification panel and the success toast. Quote first: no password prompt, no tx when there's no route */}
              {!editing && !pending && id !== BSC && !ok && (down
                ? <span className="shrink-0 text-xs text-muted">{t('暂不可补')}</span>
                : <Button size="sm" variant="secondary" className="min-w-[4.25rem] shrink-0" loading={busyChain === id} disabled={!evmAccount}
                    onClick={() => run(id, rule.topUpUsd, { beforeSign: () => ensureUnlocked(t('从 BNB 换 ${usd} 到 {chain}，补充燃料费', { usd: rule.topUpUsd, chain: name })) })
                      .then(() => toast.success(t('已补充 ${usd} 到 {chain}，几秒后到账', { usd: rule.topUpUsd, chain: name })))
                      .catch((e) => toast.error(errorText(e, t('补充失败'))))}>{t('添加')}</Button>)}
            </div>
          )
        })}
      </div>
      <FuelChainPicker open={picking} onClose={() => { setPicking(false); void usePortfolio.getState().refresh() }} />
    </Sheet>
  )
}

/** Chain picker panel: lists only chains measured able to receive gas from BNB; tap to add / remove. Quote once before adding — don't add if there's no route yet */
function FuelChainPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { fuelChains, addFuelChain, removeFuelChain } = useSettings()
  const { checkRoute } = useRefuel()
  const [q, setQ] = useState('')
  const [checking, setChecking] = useState<number | null>(null)
  // Snapshot the added chains at panel open and pin them first; don't re-sort on taps inside the panel — rows shouldn't jump around
  const [pinned, setPinned] = useState<number[]>([])
  useEffect(() => { if (open) { setQ(''); setPinned(useSettings.getState().fuelChains) } }, [open])
  const key = q.trim().toLowerCase()
  const list = ADDABLE_FUEL_CHAINS.map((id) => chainById(id)).filter((c): c is NonNullable<typeof c> => !!c)
    .filter((c) => !key || fuelChainName(c.name).toLowerCase().includes(key) || c.native.symbol.toLowerCase().includes(key))
    .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)))
  // 10 per page (2026-09-29 goat: the list was too long); changing the search term returns to page 1
  const pager = usePager(list, { reset: `${open}:${key}`, size: 10 })
  const toggle = async (id: number, name: string) => {
    if (checking !== null) return
    if (fuelChains.includes(id)) { removeFuelChain(id); return }
    setChecking(id)
    try {
      const ok = await checkRoute(id, gasRule(id).topUpUsd)
      if (ok === false) { toast.error(t('{chain} 暂时无法从 BNB 兑换燃料费，请稍后再试', { chain: name })); return }
      addFuelChain(id)
    } finally { setChecking(null) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('添加链路')}>
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索')} aria-label={t('搜索')} className="ui-field pl-10" />
      </div>
      <div ref={pager.anchor} className="mt-3 divide-y divide-line/60">
        {pager.pageItems.map((c) => {
          const name = fuelChainName(c.name), added = fuelChains.includes(c.id), busy = checking === c.id
          return (
            <button key={c.id} onClick={() => void toggle(c.id, name)} aria-pressed={added} disabled={checking !== null && !busy} className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left disabled:opacity-60">
              <img src={c.logo} alt="" className="size-7 shrink-0 rounded-full bg-card2" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
              <span className="shrink-0 text-xs text-muted">{c.native.symbol}</span>
              <span className={`grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${added ? 'border-accent bg-accent text-bg' : 'border-line'}`}>
                {busy ? <LoaderCircle size={13} className="animate-spin text-muted" /> : added ? <Check size={12} strokeWidth={3} /> : null}
              </span>
            </button>
          )
        })}
        {!list.length && <p className="py-6 text-center text-sm text-muted">{t('没有找到这条链')}</p>}
      </div>
      <Pager p={pager} />
    </Sheet>
  )
}

/** Status tag color next to the chain name: green for sufficient, yellow for low-ish, red for insufficient */
const FUEL_TONE: Record<FuelLevel, string> = { high: 'bg-up/15 text-up', middle: 'bg-warning/15 text-warning', low: 'bg-down/15 text-down' }

/** Status word next to the chain name: sufficient / low-ish / insufficient */
function fuelShort(level: FuelLevel): string {
  return level === 'high' ? t('充足') : level === 'middle' ? t('偏低') : t('不足')
}
