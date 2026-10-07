// "Me → Notifications": the master switch for system push, per-category switches, and tap haptics.
// Per-category push switches live on the server (/api/me/push-prefs) and follow across devices; the master switch only controls whether this device receives (system permission + device registration).
// Preferences can still be saved when the server has no push keys configured or the build lacks VITE_PUSH — a "not yet enabled" hint shows at the top. The web version doesn't show the master switch.
// 2026-09-29 goat: dropped the standalone "haptics" setting, merged into notifications: one switch per notification category; on = push (sound and vibration follow the phone system) + vibrate while the app is open.
//   Group-chat messages, the sprite and other notifications have no push — they only control in-app vibration while the app is open (native app only).
//   "Tap haptics" and "operation results" merged into one "tap haptics": vibrate on button taps and on operation success / failure.
import { useEffect, useState } from 'react'
import Sheet from '@/components/Sheet'
import { PERP_ENABLED } from '@/lib/features'
import { toast } from '@/components/Toast'
import { t } from '@/lib/i18n'
import { api } from '@/lib/social'
import { hapticNotice, isNative, tap } from '@/lib/native'
import { disablePush, enablePush, pushStatus } from '@/lib/push'
import { useSocial } from '@/store/social'
import { errorText } from '@/lib/errors'
import { VIBE_ROWS, vibeOn, type VibeKind } from '@/lib/notifyHaptics'
import { useSettings } from '@/store/settings'

type Kind = 'dm' | 'comment' | 'mention' | 'gift' | 'follow' | 'like' | 'followPost' | 'followPerp' | 'followBuy' | 'followLive' | 'official'
type Prefs = Record<Kind, boolean>

/** Relating to me: push = this category has a push switch (stored on the server); categories without push only control in-app vibration while the app is open (native app only) */
// Order and wording follow the notification-haptics category table (lib/notifyHaptics.ts VIBE_ROWS)
const PUSH_KINDS = new Set<VibeKind>(['dm', 'mention', 'comment', 'gift', 'follow', 'like', 'official'])
const MINE: { k: VibeKind; label: string; push: boolean }[] = VIBE_ROWS.map(([k, label]) => ({ k, label, push: PUSH_KINDS.has(k) }))
// Go-live reminders (2026-09-30): people I follow went live
const FOLLOWING: [Kind, string][] = ([['followLive', '开播'], ['followPost', '发帖'], ['followPerp', '合约开仓'], ['followBuy', '买入代币']] as [Kind, string][]).filter(([k]) => PERP_ENABLED || k !== 'followPerp')

export default function NotificationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title={t('通知')}><NotificationPrefs active={open} /></Sheet>
}

/** The notification switches' content (extracted 2026-09-29: mobile places it in a sheet, the web settings page on desktop places it directly in the right content area). active = only read preferences while shown */
export function NotificationPrefs({ active }: { active: boolean }) {
  const open = active
  const ready = useSocial((s) => s.status === 'ready')
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [failed, setFailed] = useState(false)
  const [st, setSt] = useState<Awaited<ReturnType<typeof pushStatus>> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    if (isNative) pushStatus().then((s) => { if (alive) setSt(s) })
    setFailed(false)
    if (ready) api<Prefs>('/api/me/push-prefs').then((p) => { if (alive) { setPrefs(p); useSettings.getState().setPushPrefsCache(p) } }, () => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [open, ready])

  const toggle = async (k: Kind) => {
    if (!prefs) return
    const prev = prefs
    const on = !prefs[k]
    setPrefs({ ...prefs, [k]: on })
    // The same switch also controls whether this category vibrates while the app is open (categories without their own haptic, e.g. "people I follow", only change push)
    if (isVibeKind(k)) { useSettings.getState().setNotifyHaptic(k, on); if (on) hapticNotice() }
    try { const next = await api<Prefs>('/api/me/push-prefs', { method: 'PUT', body: JSON.stringify({ [k]: on }) }); setPrefs(next); useSettings.getState().setPushPrefsCache(next) }
    catch (e) { setPrefs(prev); if (isVibeKind(k)) useSettings.getState().setNotifyHaptic(k, !on); toast.error(errorText(e, t('保存失败'))) }
  }
  const toggleLocal = (k: VibeKind) => { const on = !vibeOn(k); useSettings.getState().setNotifyHaptic(k, on); if (on) hapticNotice() }
  useSettings((s) => s.notifyHaptics)   // Subscription: only re-render when device-local categories change

  const master = !!st && !st.off && st.permission === 'granted'
  const toggleMaster = async () => {
    if (!st || busy) return
    setBusy(true)
    try {
      if (master) await disablePush(); else await enablePush()
      const next = await pushStatus()
      setSt(next)
      if (!master && next.permission === 'denied') toast.error(t('通知权限被关闭，请到系统设置里打开'))
    } finally { setBusy(false) }
  }

  // Push pipeline not up: the build flag is off, or the server hasn't configured keys for this platform
  const unavailable = isNative && !!st && (!st.build || st.server === false)

  return (
    <>
      {unavailable && <p className="mb-3 rounded-lg bg-card2 px-3 py-2.5 text-[13px] text-muted">{t('推送暂未开通。开关会先保存，开通后生效。')}</p>}
      {!isNative && <p className="mb-3 text-[13px] text-muted">{t('推送只在 App 里收到，这里的设置会同步到 App。')}</p>}

      {isNative && st && !unavailable && (
        <div className="mb-5 border-y border-line/60">
          <SwitchRow label={t('允许推送')} checked={master} disabled={busy} onChange={toggleMaster} />
          {!st.off && st.permission === 'denied' && <p className="pb-3 text-[13px] text-warning">{t('系统设置里关闭了 0x4 的通知')}</p>}
        </div>
      )}

      {!ready ? <p className="text-sm text-muted">{t('社交服务未连接')}</p>
        : failed ? <p className="text-sm text-muted">{t('加载失败')}</p>
        : (
          <>
            <section className="mb-5" aria-label={t('和我有关')}>
              <h2 className="mb-1 text-xs font-medium text-muted">{t('和我有关')}</h2>
              <p className="mb-2 text-xs leading-5 text-muted">{t('开启后收到这类通知会有声音和震动。App 在后台时，声音和震动按手机的系统设置。')}</p>
              <div className="divide-y divide-line/60 border-y border-line/60">
                {MINE.filter((r) => r.push || isNative).map((r) => r.push
                  // Users who disabled this category's haptic in an old version: honor their choice with no in-app vibration, and note it; touching the switch once more aligns it with notifications
                  ? <SwitchRow key={r.k} label={t(r.label)} sub={isNative && prefs?.[r.k as Kind] && !vibeOn(r.k) ? t('App 打开时不震动') : undefined} checked={!!prefs?.[r.k as Kind]} disabled={!prefs} onChange={() => toggle(r.k as Kind)} />
                  : <SwitchRow key={r.k} label={t(r.label)} checked={vibeOn(r.k)} onChange={() => toggleLocal(r.k)} />)}
              </div>
            </section>
            <Group title={t('我关注的人')} items={FOLLOWING} prefs={prefs} onToggle={toggle} />
          </>
        )}

      {isNative && <PressHapticsSetting />}
    </>
  )
}

const VIBE_KINDS = new Set<string>(['dm', 'mention', 'group', 'comment', 'gift', 'follow', 'like', 'fly', 'official', 'other'])
const isVibeKind = (k: string): k is VibeKind => VIBE_KINDS.has(k)

/** Tap haptics (2026-09-29 goat: merged the old "tap haptics" and "operation results" into this): vibrate on button taps and operation success/failure. A quick buzz plays when enabling */
function PressHapticsSetting() {
  const { pressHaptics, setPressHaptics } = useSettings()
  return (
    <section className="mb-5" aria-label={t('按键震动')}>
      <div className="border-y border-line/60">
        <SwitchRow label={t('按键震动')} sub={t('点按按钮、操作成功或失败时轻微震动')} checked={pressHaptics} onChange={() => { const on = !pressHaptics; setPressHaptics(on); if (on) tap() }} />
      </div>
    </section>
  )
}

function Group({ title, items, prefs, onToggle }: { title: string; items: [Kind, string][]; prefs: Prefs | null; onToggle: (k: Kind) => void }) {
  return (
    <section className="mb-5" aria-label={title}>
      <h2 className="mb-2 text-xs font-medium text-muted">{title}</h2>
      <div className="divide-y divide-line/60 border-y border-line/60">
        {items.map(([k, label]) => <SwitchRow key={k} label={t(label)} checked={!!prefs?.[k]} disabled={!prefs} onChange={() => onToggle(k)} />)}
      </div>
    </section>
  )
}

function SwitchRow({ label, sub, checked, disabled, onChange }: { label: string; sub?: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={onChange} disabled={disabled} className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left text-[15px] disabled:opacity-50">
      <span className="min-w-0">
        <span className="block">{label}</span>
        {sub && <span className="mt-0.5 block text-xs text-muted">{sub}</span>}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-card2'}`} aria-hidden>
        <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
}
