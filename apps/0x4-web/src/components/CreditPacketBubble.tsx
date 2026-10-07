// 余额红包气泡：点开抢，领到的钱直接进余额
import { useState } from 'react'
import { Crown } from 'lucide-react'
import PacketGlyph from './PacketGlyph'
import Sheet from './Sheet'
import Avatar from './Avatar'
import { toast } from './Toast'
import { api } from '@/lib/social'
import { fmtUsd } from '@/lib/format'
import { displayName } from '@/store/social'
import { t } from '@/lib/i18n'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

interface Detail { id: string; creator: string; total: number; count: number; mode: string; remaining_count: number; remaining_amount: number; status: string; message: string | null; claims: { address: string; amount: number; nickname: string | null; avatar: string | null }[] }

export default function CreditPacketBubble({ packetId, creator, creatorName, total, message, me }: { packetId: string; creator: string; creatorName: string; total: number; message: string; me: string }) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api<Detail>(`/api/credits/packets/${packetId}`).then(setD).catch(() => {})
  const mine = d?.claims.find((c) => c.address === me)
  const claim = async () => {
    setBusy(true)
    try { const r = await api<{ amount: number }>(`/api/credits/packets/${packetId}/claim`, { method: 'POST', body: '{}' }); toast.success(t('领到 {amount}，已进余额', { amount: fmtUsd(r.amount) })); load() } catch (e) { toast.error(errorText(e, t('没抢到'))); load() } finally { setBusy(false) }
  }
  return (
    <>
      <div className="my-2 flex justify-center">
        <button onClick={() => { setOpen(true); load() }} className="flex w-64 items-center gap-3 rounded-2xl bg-gradient-to-br from-[#e63946] to-[#c1121f] p-3 text-left text-white shadow-lg">
          <PacketGlyph />
          <div className="min-w-0 flex-1"><div className="truncate font-semibold">{message}</div><div className="text-xs opacity-80">{t('{name} 的余额红包 · {amount}', { name: creatorName, amount: fmtUsd(total) })}</div></div>
        </button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('余额红包')}>
        <div className="rounded-2xl bg-gradient-to-br from-[#e63946] to-[#c1121f] p-5 text-center text-white">
          <div className="mx-auto w-fit"><Avatar address={creator} name={creatorName} size={48} /></div>
          <div className="mt-2 text-sm opacity-90">{t('{name} 的红包', { name: creatorName })}</div>
          <div className="mt-1 text-lg font-semibold">{d?.message || message}</div>
          {mine ? <div className="mt-3 text-3xl font-black">{fmtUsd(mine.amount)}</div> : d && d.status === 'open' && d.creator !== me ? <button onClick={claim} disabled={busy} className="mt-3 rounded-full bg-[#ffd166] px-8 py-2.5 text-lg font-bold text-[#7a1e14] disabled:opacity-60">{t('開')}</button> : <div className="mt-3 text-sm opacity-80">{d?.status === 'refunded' ? t('已过期退回') : d?.creator === me ? t('你发的红包') : d ? t('已领完') : '…'}</div>}
        </div>
        {d && (
          <div className="mt-3">
            <div className="text-xs text-muted">{t('已领 {claimed} / {count} 个 · 共 {total}', { claimed: d.count - d.remaining_count, count: d.count, total: fmtUsd(d.total) })} · {d.mode === 'random' ? t('拼手气') : t('均分')}</div>
            {d.claims.map((c, i) => <div key={c.address} className="flex items-center gap-2 py-1.5 text-sm"><Avatar address={c.address} src={c.avatar} name={c.nickname} size={28} /><span className="flex-1"><UserName address={c.address} name={displayName(c)} />{i === 0 && d.mode === 'random' && d.claims.length > 1 ? <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-warning"><Crown size={12} aria-hidden="true" />{t('手气最佳')}</span> : null}</span><span className="font-semibold">{fmtUsd(c.amount)}</span></div>)}
          </div>
        )}
      </Sheet>
    </>
  )
}
