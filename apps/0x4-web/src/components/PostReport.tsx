// The "report" button at a feed post's top-right (2026-10-02 goat, listing requirement): shown only when logged in and on others' posts; on your own posts that spot holds the delete button.
import { Flag } from 'lucide-react'
import { openReport } from '@/lib/safety'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'

export default function PostReport({ id, author, name }: { id: string; author: string; name?: string | null }) {
  const status = useSocial((s) => s.status)
  const me = useSocial((s) => s.me)
  if (status !== 'ready' || !me || me.address === author) return null
  return <button type="button" onClick={() => openReport({ kind: 'post', id, target: author, name: name || undefined })} className="icon-button" aria-label={t('举报')} data-tooltip={t('举报')}><Flag size={17} /></button>
}
