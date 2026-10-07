// Post-signup suggested follows (borrowed from DeBox's "Social butterfly"): check a few active traders so the friend feed isn't empty from the start
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import Avatar from './Avatar'
import Button from './Button'
import { toast } from './Toast'
import { api } from '@/lib/social'
import { fmtUsd } from '@/lib/format'
import { useSettings } from '@/store/settings'
import { useSocial, displayName } from '@/store/social'
import XBadge from '@/components/XBadge'
import { t } from '@/lib/i18n'
import UserName from './UserName'
import { errorText } from '@/lib/errors'

interface Suggested { address: string; nickname: string | null; avatar: string | null; handle: string | null; bio: string | null; followers: number; posts: number; pnl: number }

export default function SuggestFollow() {
  const { status } = useSocial()
  const { followSuggested, setFollowSuggested, guideDone } = useSettings()
  const [list, setList] = useState<Suggested[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const show = status === 'ready' && guideDone && !followSuggested

  useEffect(() => {
    if (!show) return
    api<Suggested[]>('/api/users/suggested').then((l) => {
      if (!l.length) setFollowSuggested(true) // Skip silently when there's no one to suggest
      setList(l); setPicked(new Set(l.map((u) => u.address)))
    }).catch(() => setFollowSuggested(true))
  }, [show, setFollowSuggested])

  if (!show || !list || !list.length) return null
  const toggle = (a: string) => setPicked((p) => { const n = new Set(p); if (n.has(a)) n.delete(a); else n.add(a); return n })
  const all = picked.size === list.length
  const done = async () => {
    setBusy(true)
    try {
      await Promise.all([...picked].map((a) => api(`/api/users/${a}/follow`, { method: 'POST' })))
      if (picked.size) toast.success(t('已关注 {n} 人', { n: picked.size }))
      setFollowSuggested(true)
    } catch (e) { toast.error(errorText(e, t('关注失败'))) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-bg">
      <div className="safe-top flex items-center justify-end px-4 pt-4"><button onClick={() => setFollowSuggested(true)} className="text-sm text-muted">{t('跳过')}</button></div>
      <div className="px-6 text-center">
        <h2 className="text-2xl font-bold text-accent">{t('社交达人')}</h2>
        <p className="mt-1 text-sm text-muted">{t('你可能想关注这些交易者，他们的买卖会出现在你的好友流里')}</p>
      </div>
      <div className="mt-4 flex-1 space-y-3 overflow-y-auto px-4">
        {list.map((u) => (
          <button key={u.address} onClick={() => toggle(u.address)} className="flex w-full items-start gap-3 rounded-2xl bg-card p-4 text-left">
            <Avatar address={u.address} src={u.avatar} name={u.nickname} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-semibold"><UserName address={u.address} name={displayName(u)} /><XBadge address={u.address} size={12} />{u.handle && <span className="text-xs font-normal text-muted">@{u.handle}</span>}</div>
              <div className="mt-0.5 flex gap-4 text-xs text-muted"><span>{t('动态 {n}', { n: u.posts })}</span><span>{t('粉丝 {n}', { n: u.followers })}</span><span className={u.pnl >= 0 ? 'text-up' : 'text-down'}>{u.pnl >= 0 ? '+' : '-'}{fmtUsd(Math.abs(u.pnl))}</span></div>
              {u.bio && <div className="mt-1 truncate text-xs text-muted">{u.bio}</div>}
            </div>
            <span className={`mt-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${picked.has(u.address) ? 'border-accent bg-accent text-bg' : 'border-line'}`}>{picked.has(u.address) ? <Check size={14} strokeWidth={3} /> : null}</span>
          </button>
        ))}
      </div>
      <div className="safe-bottom flex items-center gap-4 border-t border-line px-4 py-3">
        <button onClick={() => setPicked(all ? new Set() : new Set(list.map((u) => u.address)))} className="flex items-center gap-2 text-sm text-accent"><span className={`h-4 w-4 rounded-full border-2 ${all ? 'border-accent bg-accent' : 'border-muted'}`} />{t('全选')}</button>
        <Button className="flex-1" size="lg" loading={busy} onClick={done}>{picked.size ? t('关注 {n} 人并开始', { n: picked.size }) : t('开始')}</Button>
      </div>
    </div>
  )
}
