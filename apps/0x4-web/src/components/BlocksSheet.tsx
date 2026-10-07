// 黑名单（2026-10-02 goat，上架要求）：我拉黑的人，可以取消。
// 拉黑以后互相看不到对方的动态和评论、不能互发私信、对方进不了我的直播间、互相取消关注。
import { useEffect, useState } from 'react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import Avatar from '@/components/Avatar'
import { toast } from '@/components/Toast'
import { useBlocks } from '@/lib/safety'
import { shortId, timeAgo } from '@/lib/format'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

export default function BlocksSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { list, loaded, load, unblock } = useBlocks()
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (open) void load() }, [open, load])
  const remove = async (address: string) => {
    setBusy(address)
    try { await unblock(address); toast.success(t('已取消拉黑')) } catch (e) { toast.error(errorText(e, t('失败'))) } finally { setBusy(null) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('黑名单')}>
      <p className="text-sm text-muted">{t('被你拉黑的人：互相看不到对方的动态和评论，对方不能给你发私信，也进不了你的直播间。')}</p>
      {!loaded ? <div className="mt-5 space-y-3"><div className="skeleton h-14" /><div className="skeleton h-14" /></div>
        : !list.length ? <div className="mt-5 py-6 text-center text-sm text-muted">{t('没有拉黑任何人')}</div>
          : <div className="mt-4 divide-y divide-line/60 border-y border-line/60">
            {list.map((b) => (
              <div key={b.address} className="flex min-h-15 items-center gap-3 py-3">
                <Avatar address={b.address} src={b.avatar} name={b.nickname} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px]">{b.nickname || shortId(b.address)}</div>
                  <div className="mt-0.5 text-xs text-muted">{t('{time}拉黑', { time: timeAgo(b.ts) })}</div>
                </div>
                <Button size="sm" variant="secondary" loading={busy === b.address} disabled={!!busy} onClick={() => void remove(b.address)}>{t('取消拉黑')}</Button>
              </div>
            ))}
          </div>}
    </Sheet>
  )
}
