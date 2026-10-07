// Pre-live check page's "Stream cover" (2026-10-02 goat: the streamer picks it): auto + 8 room-atmosphere images; one tap saves to the server (only the streamer can change it).
// Only used on the web pre-live check page (lazy-loaded by Room.tsx); the phone app doesn't bundle these images.
import { useState } from 'react'
import { api } from '@/lib/social'
import { toast } from '@/components/Toast'
import { errorText } from '@/lib/errors'
import { t } from '@/lib/i18n'
import { COVER_LIST, coverOf } from './covers'
import './coverPicker.css'

export default function CoverPicker({ roomId, initial }: { roomId: string; initial?: string | null }) {
  const [cover, setCover] = useState<string | null>(initial ?? null)
  const pick = (next: string | null) => {
    if (next === cover) return
    const prev = cover
    setCover(next)
    api(`/api/rooms/${roomId}/cover`, { method: 'POST', body: JSON.stringify({ cover: next }) })
      .catch((e) => { setCover(prev); toast.error(errorText(e, t('封面没能保存，请重试'))) })
  }
  return (
    <section aria-label={t('直播封面')}>
      <h2 className="mb-1 text-[13px] font-semibold">{t('直播封面')}</h2>
      <p className="mb-3 text-[12px] text-muted">{t('显示在社区的直播列表里')}</p>
      <div className="lv-pick" role="radiogroup" aria-label={t('直播封面')}>
        <button type="button" role="radio" aria-checked={cover === null} onClick={() => pick(null)}>
          <img src={coverOf(roomId)} alt="" /><span>{t('自动')}</span>
        </button>
        {COVER_LIST.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={cover === c.id} onClick={() => pick(c.id)}>
            <img src={c.url} alt="" loading="lazy" /><span>{c.label()}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
