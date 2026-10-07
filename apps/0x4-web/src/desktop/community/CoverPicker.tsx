// 开播检查页「直播封面」（2026-10-02 goat：主播自己选）：自动 + 8 张直播间氛围图，点一下就存到服务器（只有主播能改）。
// 只在网页版开播检查页用（Room.tsx 按需加载），手机 App 不带这些图。
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
