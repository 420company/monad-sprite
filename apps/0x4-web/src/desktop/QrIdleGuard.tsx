// Shared computers signed in via QR ("this session only"): auto-logout after long idleness (2026-10-01 goat). Rules and timing in qrIdle.ts.
// After 30 idle minutes, pop the idle-timeout prompt: "keep using" renews, "stop and exit" or 2 unanswered minutes logs out and returns to the login page.
// Computers marked "trusted device" on the phone never pop (login lasts 30 days).
import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { t } from '@/lib/i18n'
import { getToken } from '@/lib/social'
import { forgetQrSession, useSocial } from '@/store/social'
import { GRACE_MS, pingActive, watchIdle, type IdleStage, type IdleWatcher } from './qrIdle'

function quit(text: string) {
  forgetQrSession()
  useSocial.getState().logout()
  useSocial.setState({ status: 'error', error: text })
}

export default function QrIdleGuard() {
  const on = useSocial((s) => s.qrMode && !s.qrTrusted && s.status === 'ready')
  const [stage, setStage] = useState<IdleStage>('ok')
  const [watcher, setWatcher] = useState<IdleWatcher | null>(null)

  useEffect(() => {
    if (!on) { setStage('ok'); return }
    const w = watchIdle({
      onStage: (s) => {
        setStage(s)
        if (s === 'out') quit(t('已自动退出，请重新扫码登录'))
      },
      ping: (kind) => { const tk = getToken(); return tk ? pingActive(tk, kind) : Promise.resolve() },
    })
    setWatcher(w)
    return () => { w.stop(); setWatcher(null) }
  }, [on])

  if (!on || stage !== 'warn') return null
  return (
    <div className="desk-gate" role="alertdialog" aria-modal="true" aria-labelledby="qr-idle-title" aria-describedby="qr-idle-sub" data-testid="qr-idle">
      <div className="desk-gate-card cw-card">
        <Clock size={28} aria-hidden="true" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
        <h2 id="qr-idle-title" className="cw-title" style={{ textAlign: 'center', textWrap: 'balance' }}>{t('系统检测到您长时间未进行任何操作，是否停止当前服务？')}</h2>
        <p id="qr-idle-sub" className="cw-sub">{t('{n} 分钟内没有选择，将自动退出登录。', { n: Math.round(GRACE_MS / 60_000) })}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <button type="button" className="wc-btn" onClick={() => quit(t('已退出登录'))} data-testid="qr-idle-quit">{t('停止并退出')}</button>
          <button type="button" className="wc-btn is-primary" onClick={() => watcher?.touch('input')} data-testid="qr-idle-stay" autoFocus>{t('继续使用')}</button>
        </div>
      </div>
    </div>
  )
}
