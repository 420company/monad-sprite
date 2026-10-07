// 能量礼物面板（网页版直播间 / 会议）：余额、每个礼物「可送 N 个」、不够的置灰、点一下送一个，连点排队。
// 服务器确认后才会广播动画（GiftFxLayer 收到才播），这里点了不先播；被拒只在本机提示一句。
// 收礼人：直播 = 主播（PK 时可以切到对面主播）；会议 = 主持人 + 台上开视频 / 共享屏幕的人。
// 0x4 Wallet：可开「免确认送礼」（插件授权一次）；其他钱包每一下都要在钱包里确认，面板顶部放一张「0x4 Wallet 专属」提示。
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Plus, X, Zap } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Avatar from '@/components/Avatar'
import { toast } from '@/components/Toast'
import EnergyDeposit from './EnergyDeposit'
import {
  canSend, energyFile, energyGifts, energyNum, endGiftSession, giftDevice, giftSessionStatus, giftWalletKind, GiftQueue, prepareGift, sendGiftHttp, signGiftTip,
  startGiftSession, useEnergy, type EnergyGift, type GiftSendResult,
} from '@/lib/energy'
import type { Ox4GiftSession } from '@/lib/vault/extension'
import { errorText } from '@/lib/errors'
import { t, useLang } from '@/lib/i18n'
import { useWallet } from '@/store/wallet'
import { useSocial } from '@/store/social'
import { connectWallet, getOx4Wallet } from '@/desktop/walletGate'
import energyIcon from './energy.webp'
import { reportActivity } from '@/desktop/qrIdle'

export interface GiftTarget { address: string; nickname?: string | null; avatar?: string | null; label?: string }

/** 被拒原因 → 给点的人看的一句话（服务器已经给了简体原文，翻译走 t） */
const reasonText = (r: string): string | null => ({ insufficient: t('能量不足'), closed: t('送礼暂停中'), disabled: t('送礼暂未开放'), bad_recipient: t('对方现在不能收礼') } as Record<string, string>)[r] ?? null

/** docked：网页版直播间里贴在视频右边的侧栏（2026-10-02 goat：弹窗挡住了视频），没有遮罩、不挡画面；不传就是原来的弹层 */
export default function GiftPanel({ open, onClose, room, targets, docked = false }: { open: boolean; onClose: () => void; room: string; targets: GiftTarget[]; docked?: boolean }) {
  const { evmAccount } = useWallet()
  const lang = useLang((s) => s.lang)
  const socket = useSocial((s) => s.socket)
  const wsStatus = useSocial((s) => s.wsStatus)
  const me = useEnergy((s) => s.me)
  const refresh = useEnergy((s) => s.refresh)
  const setAvailable = useEnergy((s) => s.setAvailable)
  const [gifts, setGifts] = useState<EnergyGift[]>([])
  const [to, setTo] = useState<string>(targets[0]?.address ?? '')
  const [deposit, setDeposit] = useState(false)
  const [session, setSession] = useState<Ox4GiftSession>({ active: false })
  const [, bump] = useState(0)
  const kind = giftWalletKind(evmAccount)

  useEffect(() => { if (!targets.some((x) => x.address === to)) setTo(targets[0]?.address ?? '') }, [targets, to])
  useEffect(() => {
    if (!open) return
    void energyGifts().then((r) => setGifts(r.gifts)).catch(() => {})
    void refresh()
    if (kind === 'ox4') void giftSessionStatus().then(setSession)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 送礼走实时连接（同一条连接顺序到达，连击更稳）；连接不在就走 HTTP
  const pendingAcks = useRef(new Map<string, (r: GiftSendResult) => void>())
  useEffect(() => {
    if (!socket) return
    const off = socket.on((d) => {
      if (d.type !== 'roomgift_ack') return
      const cb = pendingAcks.current.get(String(d.reqId))
      if (cb) { pendingAcks.current.delete(String(d.reqId)); cb(d as unknown as GiftSendResult) }
    })
    return () => { off() }
  }, [socket])

  // 每个收礼人一条队列（通道 = 房间 × 设备 × 收礼人）
  const queues = useRef(new Map<string, GiftQueue>())
  const queueFor = (addr: string): GiftQueue => {
    let q = queues.current.get(addr)
    if (!q) {
      const device = giftDevice()
      q = new GiftQueue({
        prepare: () => prepareGift(room, device, addr),
        sign: (typed) => { if (!evmAccount) throw new Error(t('请先连接钱包')); return signGiftTip(evmAccount, typed) },
        send: (body) => {
          const payload = { room, device, to: addr, ...body }
          if (socket && wsStatus === 'open') {
            return new Promise<GiftSendResult>((resolve) => {
              const reqId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
              const timer = setTimeout(() => { pendingAcks.current.delete(reqId); resolve(sendGiftHttp(payload) as unknown as GiftSendResult) }, 8000)
              pendingAcks.current.set(reqId, (r) => { clearTimeout(timer); resolve(r) })
              socket.send({ type: 'roomgift_send', reqId, ...payload })
            })
          }
          return sendGiftHttp(payload)
        },
      }, () => bump((n) => n + 1))
      queues.current.set(addr, q)
    }
    return q
  }
  // 离开房间：还没签的全部取消
  useEffect(() => () => { for (const q of queues.current.values()) q.cancel() }, [room])

  const queued = [...queues.current.values()].reduce((a, q) => a + q.queuedEnergy, 0)
  const available = Math.max(0, energyNum(me?.available) - queued)
  const closed = !me?.enabled ? t('送礼暂未开放') : me.open === false ? t('送礼暂停中') : null
  const maxPrice = useMemo(() => gifts.reduce((m, g) => Math.max(m, g.price), 0), [gifts])
  const target = targets.find((x) => x.address === to)

  const tap = async (g: EnergyGift) => {
    if (!to || closed) return
    if (available < g.price) { setDeposit(true); return }
    const r = await queueFor(to).tap({ id: g.id, price: g.price })
    if (r.ok) reportActivity('gift')   // 扫码登录的公共电脑：送礼算「在用」
    if (r.ok) { if (r.available) setAvailable(r.available); else void refresh(); return }
    if (r.reason === 'cancelled') return
    if (r.reason === 'insufficient') { toast.error(t('能量不足')); void refresh(); return }
    const m = reasonText(r.reason) ?? errorText(new Error(r.error), t('送礼失败'))
    if (m) toast.error(m)
  }

  const toggleSession = async () => {
    try {
      if (session.active) { await endGiftSession(); setSession({ active: false }); return }
      if (!me) return
      setSession(await startGiftSession(me, maxPrice || 999))
      toast.success(t('已开启免确认送礼'))
    } catch (e) { const m = errorText(e, t('开启失败')); if (m) toast.error(m) }
  }

  const body = (
      <div className="flex flex-col gap-3 pb-1" data-testid="gift-panel">
        {/* 余额 + 充值 */}
        <div className="flex items-center gap-3 rounded-2xl bg-card2 px-3.5 py-2.5">
          <img src={energyIcon} alt="" className="h-8 w-8 shrink-0" draggable={false} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted">{t('我的能量')}</p>
            <p className="number text-lg font-semibold leading-tight" data-testid="gift-energy">{available.toLocaleString()}</p>
          </div>
          <button type="button" onClick={() => setDeposit(true)} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-accent px-3.5 text-sm font-semibold text-bg" data-testid="gift-topup"><Plus size={15} />{t('充值')}</button>
        </div>

        {/* 收礼人（直播 PK 两边主播 / 会议主持人和台上的人） */}
        {targets.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar" role="radiogroup" aria-label={t('送给谁')}>
            {targets.map((x) => (
              <button key={x.address} type="button" role="radio" aria-checked={x.address === to} onClick={() => setTo(x.address)} data-testid="gift-target"
                className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm ${x.address === to ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted'}`}>
                <Avatar address={x.address} src={x.avatar} name={x.nickname} size={26} />
                <span className="max-w-[9rem] truncate">{x.nickname || x.address.slice(0, 6)}</span>
                {x.label && <span className="text-[11px] text-muted">{x.label}</span>}
              </button>
            ))}
          </div>
        )}

        {/* 用手机 App 扫码登录的电脑（没连钱包，2026-10-01）：送礼要钱包签名，先连钱包 */}
        {kind === 'none' && (
          <div className="flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5" data-testid="gift-need-wallet">
            <Zap size={16} className="shrink-0 text-accent" />
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">{t('送礼要连接钱包。')}</p>
            <button type="button" onClick={connectWallet} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent">{t('连接钱包')}<ArrowRight size={13} /></button>
          </div>
        )}
        {/* 其他钱包：每一下都要在钱包里确认。0x4 Wallet 可以免确认 */}
        {kind === 'external' && (
          <div className="flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5" data-testid="gift-ox4-hint">
            <Zap size={16} className="shrink-0 text-accent" />
            <p className="min-w-0 flex-1 text-xs leading-relaxed"><b className="text-fg">{t('0x4 Wallet 专属')}</b> <span className="text-muted">{t('免确认连续送礼。当前钱包每次送礼都要确认。')}</span></p>
            <button type="button" onClick={getOx4Wallet} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent">{t('获取')}<ArrowRight size={13} /></button>
          </div>
        )}
        {kind === 'ox4' && me?.enabled && (
          <label className="flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-2.5 text-sm" data-testid="gift-session">
            <span className="min-w-0"><span className="flex items-center gap-1.5 font-medium"><Zap size={15} className="text-accent" />{t('免确认送礼')}</span>
              <small className="block text-xs text-muted">{session.active ? t('已开启，{t} 到期', { t: new Date(session.until).toLocaleString() }) : t('开启后点礼物不用每次确认')}</small></span>
            <input type="checkbox" className="switch" checked={session.active} onChange={() => void toggleSession()} aria-label={t('免确认送礼')} />
          </label>
        )}

        {closed ? <p className="rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning" role="status">{closed}</p> : (
          <div className="grid grid-cols-5 gap-2 max-[420px]:grid-cols-4" data-testid="gift-grid">
            {gifts.map((g) => {
              const n = canSend(available, g.price)
              const name = lang === 'en' ? g.nameEn : g.nameZh
              return (
                <button key={g.id} type="button" onClick={() => void tap(g)} disabled={!to} data-testid={`gift-${g.id}`} aria-label={`${name} ${t('{n} 能量', { n: g.price })}`}
                  className={`group flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 transition active:scale-95 ${n > 0 ? 'hover:bg-card2' : 'opacity-40'}`}>
                  <img src={energyFile(g.icon) || energyFile('/files/gift-giftbox.webp')!} alt="" className="h-12 w-12 object-contain transition group-hover:scale-110" draggable={false} />
                  <span className="w-full truncate text-center text-xs font-medium">{name}</span>
                  <span className="number text-[11px] text-muted">{g.price}</span>
                  <span className={`text-[10px] ${n > 0 ? 'text-accent' : 'text-muted'}`} data-testid={`gift-count-${g.id}`}>{n > 0 ? t('可送 {n} 个', { n: n > 999 ? '999+' : n }) : t('能量不足')}</span>
                </button>
              )
            })}
          </div>
        )}
        {target && <p className="text-center text-[11px] text-muted">{t('送给 {name}', { name: target.nickname || target.address.slice(0, 6) })} · {t('主播收到礼物后，能量按比例结算给主播')}</p>}
      </div>
  )
  if (docked) return (
    <aside className="gift-dock" aria-label={t('送礼物')} data-testid="gift-dock">
      <header className="flex items-center justify-between px-4 pb-3 pt-4">
        <h2 className="text-[15px] font-semibold">{t('送礼物')}</h2>
        <button type="button" onClick={onClose} className="icon-button -mr-1.5" aria-label={t('关闭')} title={t('关闭')}><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 [&_[data-testid=gift-grid]]:grid-cols-3">{body}</div>
      <EnergyDeposit open={deposit} onClose={() => setDeposit(false)} />
    </aside>
  )
  return (
    <Sheet open={open} onClose={onClose} title={t('送礼物')}>
      {body}
      <EnergyDeposit open={deposit} onClose={() => setDeposit(false)} />
    </Sheet>
  )
}
