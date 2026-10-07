// Group red-packet bubble: tap to claim, shows the claim history
import { useState } from 'react'
import Sheet from './Sheet'
import PacketGlyph from './PacketGlyph'
import Button from './Button'
import Avatar from './Avatar'
import { toast } from './Toast'
import { api } from '@/lib/social'
import { fmtAmount } from '@/lib/format'
import { displayName } from '@/store/social'
import { usePortfolio } from '@/store/portfolio'
import { t } from '@/lib/i18n'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

export interface PacketInfo { id: string; creator: string; symbol: string; total: number; count: number; mode: string; remainingCount: number; status: string; message: string | null }
interface Detail extends PacketInfo { claims: { address: string; amount: number; nickname: string | null; avatar: string | null; createdAt: number }[] }

export default function PacketBubble({ packet, creatorName, me }: { packet: PacketInfo; creatorName: string; me: string }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [got, setGot] = useState<number | null>(null)
  const refresh = usePortfolio((s) => s.refresh)

  const load = async () => {
    setOpen(true)
    try { setDetail(await api<Detail>(`/api/packets/${packet.id}`)) } catch (e) { toast.error(errorText(e, t('加载失败'))) }
  }
  const claim = async () => {
    setBusy(true)
    try {
      const r = await api<{ amount: number; packet: Detail }>(`/api/packets/${packet.id}/claim`, { method: 'POST' })
      setGot(r.amount)
      setDetail(await api<Detail>(`/api/packets/${packet.id}`))
      setTimeout(refresh, 3000)
    } catch (e) { toast.error(errorText(e, t('领取失败'))) } finally { setBusy(false) }
  }
  const mine = detail?.claims.find((c) => c.address === me)
  const done = (detail?.status ?? packet.status) !== 'open'

  return (
    <>
      <button onClick={load} className="my-2 flex w-[260px] items-center gap-3 rounded-2xl bg-gradient-to-br from-[#e8442f] to-[#c4281a] px-4 py-3 text-left text-white shadow-lg active:scale-[.98]">
        <PacketGlyph />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{packet.message || t('恭喜发财')}</span>
          <span className="block text-[11px] text-white/75">{packet.mode === 'random' ? t('{name} 的拼手气红包', { name: creatorName }) : t('{name} 的均分红包', { name: creatorName })} · {done ? t('已领完') : t('剩 {n} 个', { n: packet.remainingCount })}</span>
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('红包')}>
        <div className="rounded-3xl bg-gradient-to-b from-[#e8442f] to-[#b3220f] p-6 text-center text-white">
          <div className="text-sm text-white/80">{t('{name} 的红包', { name: creatorName })}</div>
          <div className="mt-1 text-lg font-semibold">{packet.message || t('恭喜发财')}</div>
          {got !== null || mine ? (
            <div className="mt-4"><div className="text-4xl font-black">{fmtAmount(got ?? mine!.amount, 6)}</div><div className="text-sm">{t('{symbol} 已到账你的钱包', { symbol: packet.symbol })}</div></div>
          ) : done ? (
            <div className="mt-4 text-sm text-white/80">{detail?.status === 'refunded' ? t('红包已过期退回') : t('手慢了，红包已领完')}</div>
          ) : (
            <Button className="mt-4 bg-[#ffd166] text-[#7a1d0c] hover:brightness-105" size="lg" loading={busy} onClick={claim}>{t('开')}</Button>
          )}
        </div>
        <div className="mt-4">
          <div className="text-xs text-muted">{t('已领取 {claimed} / {count} · 共 {total} {symbol}', { claimed: detail?.claims.length ?? 0, count: packet.count, total: fmtAmount(packet.total, 6), symbol: packet.symbol })}</div>
          {detail?.claims.map((c) => (
            <div key={c.address} className="flex items-center gap-3 py-2">
              <Avatar address={c.address} src={c.avatar} name={c.nickname} size={32} />
              <div className="flex-1 text-sm"><UserName address={c.address} name={displayName({ address: c.address, nickname: c.nickname })} /></div>
              <div className="text-sm font-semibold">{fmtAmount(c.amount, 6)} {packet.symbol}</div>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  )
}
