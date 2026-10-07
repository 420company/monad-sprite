// "Me → Security → Signed-in computers": computers signed in via QR (0x4 web, meetings, Cyber Eden, admin console) can be logged out one by one or all at once (that computer logs out immediately).
// 2026-10-01 goat: forgetting to log out after scanning at internet cafés / office PCs — web QR logins auto-logout after 30 idle minutes / 12 hours; here you can manually log them out anytime.
import { useEffect, useState } from 'react'
import { Globe, Laptop, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { listMeetSessions, removeAllMeetSessions, removeMeetSession, type MeetSession } from '@/lib/meetLogin'
import { timeAgo } from '@/lib/format'
import { locale, t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

/** Country / region code → its name in the current language (TH → Thailand); unknown codes aren't shown */
export function regionName(code: string | null | undefined, loc: string = locale()): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return ''
  try { return new Intl.DisplayNames([loc], { type: 'region' }).of(code) || '' } catch { return '' }
}

/** What this computer is: web / admin console / meetings & games */
function kindLabel(s: MeetSession): string {
  if (s.kind === 'web') return t('0x4 网页版')
  if (s.kind === 'admin') return t('管理后台')
  return t('会议和赛博伊甸园')
}

export default function MeetSessionsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [list, setList] = useState<MeetSession[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!open) return
    let alive = true
    setFailed(false)
    listMeetSessions().then((r) => { if (alive) setList(r) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [open, retry])

  const remove = async (s: MeetSession) => {
    if (removing || !confirm(t('让「{device}」下线？那台电脑会马上退出。', { device: s.device }))) return
    setRemoving(s.id)
    try { await removeMeetSession(s.id); setList((l) => (l || []).filter((x) => x.id !== s.id)); toast.success(t('已让它下线')) }
    catch (e) { toast.error(errorText(e, t('失败'))) } finally { setRemoving(null) }
  }
  const removeAll = async () => {
    if (removing || !confirm(t('让所有电脑都下线？它们会马上退出，要用的话重新扫码。'))) return
    setRemoving('all')
    try { await removeAllMeetSessions(); setList([]); toast.success(t('所有电脑都已下线')) }
    catch (e) { toast.error(errorText(e, t('失败'))) } finally { setRemoving(null) }
  }

  return <Sheet open={open} onClose={onClose} title={t('已登录的电脑')}>
    <p className="text-sm text-muted">{t('用手机扫码登录过的电脑。网页版 30 分钟没有操作、或者登录满 12 小时会自动退出，关掉浏览器也会退出。')}</p>
    {failed ? <div className="mt-5 flex items-center justify-between gap-3 text-sm text-muted"><span>{t('暂时无法加载')}</span><Button size="sm" variant="secondary" onClick={() => setRetry((n) => n + 1)}><RefreshCw size={15} />{t('重试')}</Button></div>
      : !list ? <div className="mt-5 space-y-3"><div className="skeleton h-14" /><div className="skeleton h-14" /></div>
      : !list.length ? <div className="mt-5 py-6 text-center text-sm text-muted">{t('没有已登录的电脑')}</div>
      : <>
        <div className="mt-4 divide-y divide-line/60 border-y border-line/60" data-testid="pc-sessions">{list.map((s) => {
          const where = regionName(s.region)
          return <div key={s.id} className="flex min-h-15 items-center gap-3 py-3">
            {s.kind === 'admin' ? <ShieldCheck size={19} className="shrink-0 text-accent" /> : s.kind === 'web' ? <Globe size={19} className="shrink-0 text-muted" /> : <Laptop size={19} className="shrink-0 text-muted" />}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5"><span className="truncate text-[15px]">{kindLabel(s)} · {s.device}</span>{s.trusted && <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-[11px] font-medium text-accent" data-testid="trusted-badge">{t('已信任')}</span>}</div>
              <div className="mt-0.5 text-xs text-muted">{where ? `${where} · ` : ''}{t('最近使用 {time}', { time: timeAgo(s.lastSeen) })}</div>
            </div>
            <Button size="sm" variant="danger" loading={removing === s.id} disabled={!!removing} onClick={() => void remove(s)}>{t('让它下线')}</Button>
          </div>
        })}</div>
        {list.length > 1 && <Button className="mt-4 w-full" variant="secondary" loading={removing === 'all'} disabled={!!removing} onClick={() => void removeAll()} data-testid="pc-sessions-all"><LogOut size={16} />{t('全部下线')}</Button>}
      </>}
  </Sheet>
}
