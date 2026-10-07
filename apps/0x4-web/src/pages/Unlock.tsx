// Unlock logic stays unchanged; branding and forms follow the welcome page's visual language.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Fingerprint, LockKeyhole, ScanFace } from 'lucide-react'
import Button from '@/components/Button'
import { Input, Label } from '@/components/Field'
import { hapticResult } from '@/lib/native'
import { useWallet } from '@/store/wallet'
import { CatMark, PixelTitle, T_FAST, timelineFor, useIntroPlay } from '@/components/welcome/WelcomeIntro'
import FluidBackground from '@/components/welcome/FluidBackground'
import { t } from '@/lib/i18n'
import { BiometricCancelled, BiometricInvalidated, biometricStatus, biometryWord, toBiometricError, type BiometricStatus } from '@/lib/biometric'
import { errorText } from '@/lib/errors'
import { takeAfterUnlock } from '@/lib/afterUnlock'

/** Where to go after unlock: /pc-login for QR logins, /watch/… for shared live streams — go back there (lib/afterUnlock.ts; 2026-10-04 walkthrough: this used to only know /pc-login, and people unlocking from a live stream were dumped on the home page) */
const afterUnlock = takeAfterUnlock

export default function Unlock() {
  const nav = useNavigate()
  const { unlock, reset, unlockWithBiometric } = useWallet()
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const id = useId()
  const [bio, setBio] = useState<BiometricStatus | null>(null)
  const [bioBusy, setBioBusy] = useState(false)
  const autoTried = useRef(false)

  const bioUnlock = useCallback(async () => {
    if (!bio?.enabled) return
    setBioBusy(true); setError(null)
    try {
      await unlockWithBiometric(t('解锁 0x4 Wallet'))
      nav(afterUnlock(), { replace: true })
    } catch (raw) {
      const e = toBiometricError(raw)
      if (e instanceof BiometricCancelled) return // User cancelled themselves — stay on password input
      if (e instanceof BiometricInvalidated) {
        setBio({ ...bio, enabled: false })
        setError(t('{method}已失效，请输入密码解锁，之后可在设置里重新开启', { method: biometryWord(bio.biometry) }).trim())
        return
      }
      setError(errorText(e, t('解锁失败')))
    } finally { setBioBusy(false) }
  }, [bio, nav, unlockWithBiometric])

  useEffect(() => { biometricStatus().then(setBio) }, [])

  // Auto-pops once on page entry. If auto-locked while the app is backgrounded, the OS won't allow popping then — wait until back in foreground
  useEffect(() => {
    if (!bio?.enabled || !bio.available || autoTried.current) return
    const run = () => {
      if (document.hidden || autoTried.current) return
      autoTried.current = true
      bioUnlock()
    }
    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [bio, bioUnlock])

  const submit = async () => {
    if (loading || !pw) return
    setLoading(true); setError(null)
    try {
      await unlock(pw)
      nav(afterUnlock(), { replace: true })
    } catch (e) {
      const message = errorText(e, t('解锁失败'))
      // Only hint once below the input. It used to also pop a toast, but after toasts moved to screen center that became two copies of the same message;
      // Vibration used to piggyback on the notice strip; added separately here
      setError(message); hapticResult('error')
    } finally { setLoading(false) }
  }

  // Only play the full intro the first time the unlock page is reached per app launch; when backgrounded-locked and back, start in place with just a fade (WelcomeIntro useIntroPlay)
  const intro = useIntroPlay(T_FAST)

  return (
    // The unlock page shares the welcome page's pixel intro (2026-09-25 goat: returning users see this page every launch); the timeline is the shortened version, with the password box appearing at 0.3s
    <div className={`welcome-stage safe-top${intro.play ? '' : ' is-replay'}`} style={timelineFor(intro.tl)}>
      <FluidBackground />
      <div className="welcome-content">
        <div className="welcome-brand">
          <CatMark tl={intro.tl} play={intro.play} />
          <PixelTitle tl={intro.tl} still={!intro.play} />
        </div>
        <form className="welcome-actions space-y-4" onSubmit={event => { event.preventDefault(); submit() }}>
          <div>
            <Label htmlFor={id}>{t('解锁密码')}</Label>
            <div className="relative">
              <Input id={id} type={show ? 'text' : 'password'} value={pw} onChange={event => { setPw(event.target.value); setError(null) }} placeholder={t('输入密码')} autoComplete="current-password" disabled={loading} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className="pr-14" />
              <button type="button" onClick={() => setShow(value => !value)} className="icon-button absolute right-1 top-1" aria-label={show ? t('隐藏密码') : t('显示密码')} aria-pressed={show} title={show ? t('隐藏密码') : t('显示密码')}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
            {error && <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-down">{error}</p>}
          </div>
          <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!pw || bioBusy}>{t('解锁')}</Button>
          {bio?.enabled && bio.available && (
            <Button type="button" variant="secondary" size="lg" className="w-full" loading={bioBusy} disabled={loading} onClick={bioUnlock}>
              {(bio.biometry === 'touchID' || bio.biometry === 'fingerprint' || bio.biometry === 'biometric') ? <Fingerprint size={20} /> : <ScanFace size={20} />}
              {t('使用{method}解锁', { method: biometryWord(bio.biometry) })}
            </Button>
          )}
        </form>
        <button className="mt-4 min-h-11 text-center text-sm text-muted underline underline-offset-4" disabled={loading} onClick={() => {
          if (confirm(t('重置将删除本机钱包，需用助记词或私钥重新导入。确定继续？'))) {
            reset(); nav('/onboarding', { replace: true })
          }
        }}>{t('忘记密码？重置钱包')}</button>
        <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted"><LockKeyhole size={14} />{t('私钥仅保存在本机')}</p>
      </div>
    </div>
  )
}
