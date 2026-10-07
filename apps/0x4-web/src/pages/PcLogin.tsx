// The page a phone camera opens when scanning the computer's login code (2026-09-27): app.420.meme/#/pc-login?c=<code>.
// No need to find the in-app scan button: the system camera opens the URL here directly; after unlocking the wallet, the same confirm as an in-app scan pops (logging into Cyber Eden / 0x4 Meet / admin backend).
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Laptop } from 'lucide-react'
import { MeetScanNative } from '@/components/MeetScan'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'

export default function PcLogin() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const code = params.get('c') || ''
  // The "return here after unlock" recorded before unlocking has been used — clear it (see App.tsx takeAfterUnlock)
  useEffect(() => { try { sessionStorage.removeItem('0x4.afterUnlock') } catch { /* Privacy mode */ } }, [])
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
      <Laptop size={32} className="text-muted" aria-hidden="true" />
      <div className="text-lg font-semibold">{t('登录电脑端')}</div>
      <p className="max-w-72 text-sm text-muted">{status === 'ready' ? t('请在弹出的窗口里确认。') : t('正在连接你的账号…')}</p>
      <MeetScanNative variant="none" initialRaw={code} onDone={() => nav('/', { replace: true })} />
    </div>
  )
}
