// 扫码登录「信任此设备 / 仅本次登录」本地预览页（开发用，不打包）：/dev/qrtrust-preview.html?v=phone | desk
// phone = 手机扫码后的确认弹层（真组件 MeetScanNative，接口用本地替身）；desk = 电脑上长时间没活动的弹窗（真组件 QrIdleGuard，时钟拨快 30 分钟）
// ?lang=en 看英文，默认中文；截图时关掉动画（不然拍到淡入的半透明那一帧）
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

// 语言商店建好后（注水是微任务）再切语言、再挂组件，不然会被「跟随系统」盖回英文
setTimeout(() => {
  useLang.getState().setLang(LANG)
  if (v === 'desk') {
    document.documentElement.dataset.surface = 'web'
    void import('./desktop/desktop.css'); void import('./desktop/desk-content.css')
    // 时钟拨快：挂上以后过 30 分钟（每 15 秒检查一次，所以截图前等一次检查）
    const real = Date.now.bind(Date)
    let offset = 0
    Date.now = () => real() + offset
    useSocial.setState({ status: 'ready', qrMode: true, qrTrusted: false })
    createRoot(document.getElementById('root')!).render(<div style={{ minHeight: '100vh', background: 'var(--w-bg, #07080b)' }}><QrIdleGuard /></div>)
    setTimeout(() => { offset = 30 * 60_000 + 5_000 }, 300)
    // 预览页没有真的社交连接，别的模块会把状态改回未登录：这里一直按「扫码登录着」显示
    useSocial.subscribe((st) => { if (st.status !== 'ready' || !st.qrMode) useSocial.setState({ status: 'ready', qrMode: true, qrTrusted: false }) })
  } else {
    useSocial.setState({ status: 'ready' })
    const qr = `ox4meet:${'a'.repeat(22)}:${'b'.repeat(22)}`
    createRoot(document.getElementById('root')!).render(<MeetScanNative variant="none" initialRaw={qr} />)
  }
}, 50)
