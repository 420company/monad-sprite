// Local preview page for QR login's "trust this device / this session only" (dev only, not bundled): /dev/qrtrust-preview.html?v=phone | desk
// phone = the confirmation sheet after a phone QR scan (real component MeetScanNative, with a local stand-in for the API); desk = the idle-too-long popup on desktop (real component QrIdleGuard, clock fast-forwarded 30 minutes)
// ?lang=en for English, Chinese by default; turn animations off when screenshotting (or you'll catch a half-transparent fade-in frame)
import { createRoot } from 'react-dom/client'
import './index.css'
import { MeetScanNative } from '@/components/MeetScan'
import QrIdleGuard from '@/desktop/QrIdleGuard'
import { useLang } from '@/lib/i18n'
import { setToken } from '@/lib/social'
import { useSocial } from '@/store/social'

const LANG = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh-Hans'
const still = document.createElement('style')
still.textContent = '*,*::before,*::after{animation-duration:1ms!important;animation-delay:0s!important;transition-duration:1ms!important}'
document.head.appendChild(still)

const v = new URLSearchParams(location.search).get('v') || 'phone'
const realFetch = window.fetch.bind(window)
window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url)
  if (u.includes('/api/meet/login/') && u.endsWith('/scan')) return new Response(JSON.stringify({ kind: 'meet', app: 'web', device: 'Chrome · macOS', createdAt: Date.now(), expiresAt: Date.now() + 180_000 }), { headers: { 'content-type': 'application/json' } })
  if (u.includes('/api/auth/web-active')) return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
  return realFetch(url, init)
}) as typeof fetch
setToken('preview')

// Switch language and mount the component only after the language store is built (hydration is a microtask) — otherwise "follow system" reverts it to English
setTimeout(() => {
  useLang.getState().setLang(LANG)
  if (v === 'desk') {
    document.documentElement.dataset.surface = 'web'
    void import('./desktop/desktop.css'); void import('./desktop/desk-content.css')
    // Fast-forward the clock: 30 minutes after mounting (checked every 15 seconds, so wait for one check before screenshotting)
    const real = Date.now.bind(Date)
    let offset = 0
    Date.now = () => real() + offset
    useSocial.setState({ status: 'ready', qrMode: true, qrTrusted: false })
    createRoot(document.getElementById('root')!).render(<div style={{ minHeight: '100vh', background: 'var(--w-bg, #07080b)' }}><QrIdleGuard /></div>)
    setTimeout(() => { offset = 30 * 60_000 + 5_000 }, 300)
    // The preview page has no real social connection, and other modules would flip the state back to logged-out: always display as "QR-logged-in" here
    useSocial.subscribe((st) => { if (st.status !== 'ready' || !st.qrMode) useSocial.setState({ status: 'ready', qrMode: true, qrTrusted: false }) })
  } else {
    useSocial.setState({ status: 'ready' })
    const qr = `ox4meet:${'a'.repeat(22)}:${'b'.repeat(22)}`
    createRoot(document.getElementById('root')!).render(<MeetScanNative variant="none" initialRaw={qr} />)
  }
}, 50)
