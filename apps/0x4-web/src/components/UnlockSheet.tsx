// Pre-money-move verification panel (native app). When the wallet is locked, signing operations (transfers / swaps / perp orders etc.) route here:
// Face ID / fingerprint pops automatically when enabled; password entry on failure or cancel; closing the panel = cancelling the operation.
// Triggered via lib/vault/gate.ts's ensureUnlocked.
import { useEffect, useId, useRef, useState } from 'react'
import { Fingerprint, ScanFace } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import { Input, Label } from '@/components/Field'
import { hapticResult } from '@/lib/native'
import { finishUnlock, useUnlockPrompt } from '@/lib/vault/gate'
import { useWallet } from '@/store/wallet'
import { t } from '@/lib/i18n'
import { BiometricCancelled, BiometricInvalidated, biometricStatus, biometryWord, toBiometricError, type BiometricStatus } from '@/lib/biometric'
import { errorText } from '@/lib/errors'

export default function UnlockSheet() {
  const { open, reason } = useUnlockPrompt()
  const { unlock, unlockWithBiometric } = useWallet()
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bio, setBio] = useState<BiometricStatus | null>(null)
  const autoTried = useRef(false)
  const id = useId()

  useEffect(() => {
    if (!open) { setPw(''); setError(null); autoTried.current = false; return }
    biometricStatus().then(setBio)
  }, [open])

  const bioUnlock = async () => {
    if (!bio?.enabled) return
    setBusy(true); setError(null)
    try {
      await unlockWithBiometric(t(reason || '确认这笔操作'))
      finishUnlock(true)
    } catch (raw) {
      const e = toBiometricError(raw)
      if (e instanceof BiometricCancelled) return   // Stay on the panel to switch to password entry
      if (e instanceof BiometricInvalidated) {
        setBio({ ...bio, enabled: false })
        setError(t('{method}已失效，请输入密码解锁，之后可在设置里重新开启', { method: biometryWord(bio.biometry) }).trim())
        return
      }
      setError(errorText(e, t('解锁失败')))
    } finally { setBusy(false) }
  }

  // Face ID / fingerprint auto-pops once on open
  useEffect(() => {
    if (!open || !bio?.enabled || !bio.available || autoTried.current) return
    autoTried.current = true
    void bioUnlock()
  }, [open, bio]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (busy || !pw) return
    setBusy(true); setError(null)
    try {
      await unlock(pw)
      finishUnlock(true)
    } catch (e) {
      setError(errorText(e, t('解锁失败'))); hapticResult('error')
    } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={() => finishUnlock(false)} title={t('验证身份')}>
      <p className="mb-4 text-sm text-muted">{t(reason || '确认这笔操作')}</p>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div>
          <Label htmlFor={id}>{t('钱包密码')}</Label>
          <Input id={id} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setError(null) }} placeholder={t('输入密码')} autoComplete="current-password" disabled={busy} aria-invalid={!!error} />
          {error && <p role="alert" className="mt-2 text-sm text-down">{error}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy && !!pw} disabled={!pw || busy}>{t('确认')}</Button>
        {bio?.enabled && bio.available && (
          <Button type="button" variant="secondary" size="lg" className="w-full" disabled={busy} onClick={() => void bioUnlock()}>
            {bio.biometry === 'faceID' || bio.biometry === 'opticID' ? <ScanFace size={20} /> : <Fingerprint size={20} />}
            {t('使用{name}', { name: biometryWord(bio.biometry).trim() })}
          </Button>
        )}
      </form>
    </Sheet>
  )
}
