// 别人的主页 / 私信页上的「…」：举报、拉黑 / 取消拉黑（2026-10-02 goat，上架要求）。自己的主页、没登录时不显示。
import { useState } from 'react'
import { Ban, Flag, MoreHorizontal, UserCheck } from 'lucide-react'
import MessageMenu, { type MenuAnchor, type MenuItem } from '@/components/MessageMenu'
import { toast } from '@/components/Toast'
import { openReport, useBlocks, type ReportKind } from '@/lib/safety'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

/** 「举报」「拉黑 / 取消拉黑」两项菜单（私信页把它们并进自己的菜单里） */
export function useUserSafetyItems(address: string, name: string | undefined, close: () => void, reportKind: ReportKind = 'user'): MenuItem[] {
  const blocked = useBlocks((s) => s.list.some((b) => b.address === address))
  const status = useSocial((s) => s.status)
  const me = useSocial((s) => s.me)
  if (status !== 'ready' || !me || me.address === address) return []
  const toggle = async () => {
    close()
    const { block, unblock } = useBlocks.getState()
    try {
      if (blocked) { await unblock(address); toast.success(t('已取消拉黑')); return }
      if (!confirm(t('拉黑 {name}？互相看不到对方的动态和评论，对方不能再给你发私信、进不了你的直播间，你们会互相取消关注。', { name: name || t('这个用户') }))) return
      await block(address)
      toast.success(t('已拉黑'))
    } catch (e) { toast.error(errorText(e, t('失败'))) }
  }
  return [
    { key: 'report', label: t('举报'), icon: <Flag size={17} />, onSelect: () => { close(); openReport({ kind: reportKind, target: address, id: reportKind === 'user' ? address : undefined, name }) } },
    blocked
      ? { key: 'unblock', label: t('取消拉黑'), icon: <UserCheck size={17} />, onSelect: () => void toggle() }
      : { key: 'block', label: t('拉黑'), icon: <Ban size={17} />, danger: true, onSelect: () => void toggle() },
  ]
}

export default function UserMore({ address, name, className = 'icon-button', size = 20 }: { address: string; name?: string; className?: string; size?: number }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const items = useUserSafetyItems(address, name, () => setAnchor(null))
  if (!items.length) return null
  return (
    <>
      <button type="button" className={className} aria-label={t('更多')} title={t('更多')} aria-haspopup="menu"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAnchor({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }) }}><MoreHorizontal size={size} /></button>
      <MessageMenu anchor={anchor} items={items} onClose={() => setAnchor(null)} label={t('更多')} />
    </>
  )
}
