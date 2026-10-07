// 能量与收益（网页版，2026-09-30 goat）：我的能量（充值）+ 主播收益：今日收益、待到账、下次结算时间（北京时间 0 点）、
// 链上结算记录（点开区块浏览器）、最近收到的礼物。服务器推 energy_earnings / energy_balance 时实时更新。
// 手机 App 没有这一页（苹果规则：App 里不出现钱），App 里主播只看到「今天收到 N 个礼物」。
import { useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import Avatar from '@/components/Avatar'
import Button from '@/components/Button'
import EnergyDeposit from '@/components/energy/EnergyDeposit'
import energyIcon from '@/components/energy/energy.webp'
import { energyEarnings, energyFile, energyGifts, energyHistory, energyNum, useEnergy, type EnergyEarnings as Earn, type EnergyGift, type EnergyHistory } from '@/lib/energy'
import { displayName, useSocial } from '@/store/social'
import { t, locale, useLang } from '@/lib/i18n'
import { useBack } from '@/lib/useBack'

const scan = (chainId: number | undefined, hash: string) => (chainId === 97 ? `https://testnet.bscscan.com/tx/${hash}` : `https://bscscan.com/tx/${hash}`)
const money = (s: string | number | undefined) => energyNum(String(s ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })
/** 下次结算：北京时间几点（按用户本机时区显示） */
const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export default function EnergyEarnings() {
  const back = useBack('/live')
  const socket = useSocial((s) => s.socket)
  const lang = useLang((s) => s.lang)
  const me = useEnergy((s) => s.me)
  const refreshMe = useEnergy((s) => s.refresh)
  const [earn, setEarn] = useState<Earn | null>(null)
  const [hist, setHist] = useState<EnergyHistory | null>(null)
  const [gifts, setGifts] = useState<EnergyGift[]>([])
  const [deposit, setDeposit] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [e, h] = await Promise.all([energyEarnings(), energyHistory(), refreshMe(), energyGifts().then((r) => setGifts(r.gifts)).catch(() => {})])
      // 送礼没开（服务器没配打赏合约）时这两个接口只回 { enabled: false }，没有 recent / items：页面别因此白屏（2026-10-04 走查发现）
      setEarn(e); setHist(h)
    } catch { /* 显示空状态 */ } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // 有人送礼：今日收益 / 待到账实时变；结算后到账：重新拉记录
  useEffect(() => {
    if (!socket) return
    const off = socket.on((d) => {
      if (d.type === 'energy_earnings') setEarn((x) => (x ? { ...x, today: String(d.today), pending: String(d.pending) } : x))
      if (d.type === 'energy_settled') void load()
    })
    return () => { off() }
  }, [socket]) // eslint-disable-line react-hooks/exhaustive-deps

  const giftName = (id: string) => { const g = gifts.find((x) => x.id === id); return g ? (lang === 'en' ? g.nameEn : g.nameZh) : id }
  const giftIcon = (id: string) => energyFile(gifts.find((x) => x.id === id)?.icon) || energyFile('/files/gift-giftbox.webp')!

  return (
    <div className="flex min-h-full flex-col" data-testid="energy-page">
      <header className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={back} className="icon-button" aria-label={t('返回')}><ArrowLeft size={20} /></button>
        <h1 className="flex-1 text-lg font-semibold">{t('能量与收益')}</h1>
        <button type="button" onClick={() => void load()} className="icon-button" aria-label={t('刷新')} disabled={loading}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </header>

      <div className="flex flex-col gap-4 px-4 pb-8">
        {me && !me.enabled && <p className="rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning">{t('送礼暂未开放')}</p>}

        {/* 我的能量 */}
        <section className="flex items-center gap-3 rounded-2xl bg-card px-4 py-4 ring-1 ring-line">
          <img src={energyIcon} alt="" className="h-11 w-11" draggable={false} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{t('我的能量')}</p>
            <p className="number text-2xl font-semibold">{money(me?.available)}</p>
            <p className="text-[11px] text-muted">{t('只能用来送礼，不能转给别人、退回或提现')}</p>
          </div>
          <Button size="sm" onClick={() => setDeposit(true)} disabled={!me?.enabled}><Plus size={15} />{t('充值')}</Button>
        </section>

        {/* 主播收益 */}
        <section className="rounded-2xl bg-card px-4 py-4 ring-1 ring-line" data-testid="earnings">
          <h2 className="mb-3 text-sm font-semibold">{t('主播收益')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-muted">{t('今日收益')}</p><p className="number text-xl font-semibold" data-testid="earn-today">{money(earn?.today)} <span className="text-xs font-normal text-muted">USDT</span></p></div>
            <div><p className="text-xs text-muted">{t('待到账')}</p><p className="number text-xl font-semibold" data-testid="earn-pending">{money(earn?.pending)} <span className="text-xs font-normal text-muted">USDT</span></p></div>
          </div>
          <p className="mt-3 text-xs text-muted">{t('自动结算到你的钱包，下次结算：{t}', { t: when(earn?.nextSettleAt) })}</p>
        </section>

        {/* 结算记录 */}
        <section className="rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
          <h2 className="mb-1 text-sm font-semibold">{t('结算记录')}</h2>
          {!hist?.items?.length ? <p className="py-4 text-center text-sm text-muted">{t('还没有结算记录')}</p> : (
            <ul className="divide-y divide-line" data-testid="earn-history">
              {hist.items.map((x) => (
                <li key={x.tx} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="number text-sm font-semibold">+{money(x.amount)} USDT</p>
                    <p className="text-[11px] text-muted">{new Date(x.at).toLocaleString(locale())} · {t('{n} 笔', { n: x.tips })}</p>
                  </div>
                  <a href={scan(hist.chainId, x.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent">{t('链上记录')}<ExternalLink size={12} /></a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 最近收到的礼物 */}
        <section className="rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
          <h2 className="mb-1 text-sm font-semibold">{t('最近收到的礼物')}</h2>
          {!earn?.recent?.length ? <p className="py-4 text-center text-sm text-muted">{t('还没有收到礼物')}</p> : (
            <ul className="divide-y divide-line">
              {earn.recent.map((r, i) => (
                <li key={`${r.at}${i}`} className="flex items-center gap-3 py-2">
                  <Avatar address={r.from} src={r.avatar} name={r.nickname} size={30} />
                  <span className="min-w-0 flex-1 truncate text-sm">{displayName({ address: r.from, nickname: r.nickname ?? null })}</span>
                  <img src={giftIcon(r.gift)} alt="" className="h-7 w-7 object-contain" />
                  <span className="text-sm">{giftName(r.gift)}</span>
                  <span className="number w-12 text-right text-xs text-muted">{r.price}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <EnergyDeposit open={deposit} onClose={() => setDeposit(false)} />
    </div>
  )
}
