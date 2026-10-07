// Live effects panel (web streamer, 2026-10-02 goat: background swap, beauty, virtual avatar): docked to the right of the video, same spot as the gift sidebar, never covering the picture.
// Selections apply immediately; the streamer's own preview is always mirrored (2026-10-02 goat: flipping the preview the moment effects open feels weird) — viewers see it unmirrored. Settings are stored locally and restored on the next stream.
// Phones (layout="strip", 2026-10-02 goat: phone-app streamers need it too): a panel under the video — real-person / cat-head switch + beauty + a horizontally scrolling row of backgrounds.
// Beauty splits into four: skin smoothing / whitening / face slimming / eye enlarging (goat: make it like Douyin): four sliders on desktop; on phones, a row of four buttons picks one, with a slider below adjusting it.
import { Fragment, useEffect, useState } from 'react'
import './effects.css'
import { Ban, Droplets, ScanFace, Sparkles, UserRound, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { BACKGROUNDS, BEAUTY_ITEMS, loadFx, saveFx, type BeautyKey, type FxBg, type FxSettings } from './settings'
import { onFxStatus, fxStatus } from './fx'
import type { FxStatus } from './processor'

/** title: called "Live effects" in live streams, "Video effects" in meetings (2026-10-03 goat: meetings need virtual avatars too for faceless presence — sharing this panel and the local settings with live) */
export default function EffectsPanel({ onClose, onChange, layout = 'dock', title }: { onClose: () => void; onChange: (s: FxSettings) => void; layout?: 'dock' | 'strip'; title?: string }) {
  const heading = title ?? t('直播特效')
  const [s, setS] = useState<FxSettings>(loadFx)
  const [status, setStatus] = useState<FxStatus | null>(fxStatus)
  useEffect(() => onFxStatus(setStatus), [])
  const set = (p: Partial<FxSettings>) => { const n = { ...s, ...p }; setS(n); saveFx(n); onChange(n) }
  const cat = s.avatar === 'cat'
  const statusText = status === 'loading' ? t('正在加载识别模型，第一次大约要几秒…') : status === 'error' ? t('这台电脑暂时用不了这个特效（浏览器不支持图形加速）') : status === 'noFace' && cat ? t('没看到你的脸：正对摄像头，光线亮一点') : null

  const bgTiles = <>
    {/* Original background = your own room in the camera (in cat-head mode the person is erased, leaving just the room and the cat) */}
    <BgTile on={s.bg === 'none'} onClick={() => set({ bg: 'none' })} label={t('原背景')}><Ban size={18} /></BgTile>
    <BgTile on={s.bg === 'blur'} onClick={() => set({ bg: 'blur' })} label={t('虚化')}><span className="fx-blur" /></BgTile>
    {BACKGROUNDS.map((b) => {
      const v: FxBg = `img:${b.id}`
      return <BgTile key={b.id} on={s.bg === v} onClick={() => set({ bg: v })} label={b.label()}><img src={b.url} alt="" className="absolute inset-0 h-full w-full object-cover" /></BgTile>
    })}
  </>
  const [pick, setPick] = useState<BeautyKey>('beauty')   // Which item is being adjusted on phones
  const pct = (v: number) => (v > 0 ? `${Math.round(v * 100)}%` : t('关'))
  const slider = (k: BeautyKey, label: string) => <input type="range" min={0} max={1} step={0.05} value={s[k]} disabled={cat} onChange={(e) => set({ [k]: Number(e.target.value) })} aria-label={label} className="fx-range" style={{ '--p': `${s[k] * 100}%` } as React.CSSProperties} />

  if (layout === 'strip') return (
    <section className="fx-m" aria-label={heading} data-testid="fx-panel">
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles size={16} className="text-accent" />{heading}</h2>
        <button type="button" onClick={onClose} className="rounded-full bg-card2 px-4 py-1.5 text-sm font-semibold">{t('完成')}</button>
      </header>
      {statusText ? <p className={`-mt-1 text-xs ${status === 'error' ? 'text-down' : 'text-muted'}`} role="status">{statusText}</p>
        : <p className="-mt-1 text-xs text-muted">{t('特效加在你发出去的画面上，上面的预览能直接看到效果。特效在你的手机上处理，画面不经过我们的服务器。')}</p>}
      <div className="fx-m-row">
        <span className="fx-m-label">{t('形象')}</span>
        <div className="fx-seg" role="radiogroup" aria-label={t('虚拟形象')}>
          <button type="button" role="radio" aria-checked={!cat} onClick={() => set({ avatar: 'none' })}><UserRound size={16} />{t('真人')}</button>
          <button type="button" role="radio" aria-checked={cat} onClick={() => set({ avatar: 'cat' })} data-testid="fx-avatar-cat"><img src={`${import.meta.env.BASE_URL}icons/cat.svg`} alt="" width={18} height={18} />{t('0x4 猫头')}</button>
        </div>
      </div>
      <div className={`space-y-2.5 ${cat ? 'opacity-45' : ''}`} aria-disabled={cat}>
        <div className="fx-chips" role="radiogroup" aria-label={t('美颜')}>
          {BEAUTY_ITEMS.map((b) => <button key={b.key} type="button" role="radio" aria-checked={pick === b.key} disabled={cat} onClick={() => setPick(b.key)}>
            {b.label()}{s[b.key] > 0 && <i aria-hidden="true" />}
          </button>)}
        </div>
        <div className="fx-m-row">
          <div className="flex-1">{slider(pick, BEAUTY_ITEMS.find((b) => b.key === pick)!.label())}</div>
          <span className="number w-10 shrink-0 text-right text-xs text-muted">{cat ? '—' : pct(s[pick])}</span>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[13px] font-semibold">{t('背景')}</p>
        <div className="fx-strip" role="radiogroup" aria-label={t('背景')}>{bgTiles}</div>
      </div>
    </section>
  )

  return (
    <aside className="gift-dock" aria-label={heading} data-testid="fx-panel">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles size={16} className="text-accent" />{heading}</h2>
        <button type="button" onClick={onClose} className="icon-button -mr-1.5" aria-label={t('关闭')} title={t('关闭')}><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-5">
        <p className="text-xs leading-relaxed text-muted">{t('特效加在你发出去的画面上，左边的预览能直接看到效果。特效在你自己的电脑上处理，画面不经过我们的服务器。')}</p>
        {statusText && <p className={`rounded-xl px-3 py-2 text-xs ${status === 'error' ? 'bg-down/10 text-down' : 'bg-card2 text-muted'}`} role="status">{statusText}</p>}

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><ScanFace size={15} />{t('虚拟形象')}</h3>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('虚拟形象')}>
            <button type="button" role="radio" aria-checked={!cat} onClick={() => set({ avatar: 'none' })} className={`fx-card ${!cat ? 'is-on' : ''}`}>
              <span className="fx-card-ic"><UserRound size={26} /></span><b>{t('真人')}</b><small>{t('摄像头原画面')}</small>
            </button>
            <button type="button" role="radio" aria-checked={cat} onClick={() => set({ avatar: 'cat' })} className={`fx-card ${cat ? 'is-on' : ''}`} data-testid="fx-avatar-cat">
              <span className="fx-card-ic"><img src={`${import.meta.env.BASE_URL}icons/cat.svg`} alt="" width={34} height={34} /></span><b>{t('0x4 猫头')}</b><small>{t('不露脸，表情跟着你动')}</small>
            </button>
          </div>
        </section>

        <section aria-disabled={cat} className={cat ? 'opacity-45' : ''}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><Droplets size={15} />{t('美颜')}</h3>
            {cat && <span className="text-xs text-muted">{t('虚拟形象下不需要')}</span>}
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3">
            {BEAUTY_ITEMS.map((b) => <Fragment key={b.key}>
              <span className="whitespace-nowrap text-xs">{b.label()}</span>
              {slider(b.key, b.label())}
              <span className="number w-9 text-right text-xs text-muted">{pct(s[b.key])}</span>
            </Fragment>)}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold">{t('背景')}</h3>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('背景')}>{bgTiles}</div>
        </section>
      </div>
    </aside>
  )
}

function BgTile({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} title={label} onClick={onClick} className={`fx-bg ${on ? 'is-on' : ''}`}>
      {children}
      <span className="fx-bg-label">{label}</span>
    </button>
  )
}
