// 小精灵「现在」页（2026-09-27 goat：手机上看小精灵在 Cyber Eden 里干什么，和电脑端看到的一致）。嵌在 FlyDetail 的第一个分页。
// 上半部分：它此刻在哪、在做什么（服务器按交易状态 + 作息算的生活状态，/api/flies/:id/life，30 秒刷新）。
// 3D 画面：嵌入游戏（2026-09-30 起在 game.420.meme，420.meme/game 切换后跳过去）的观看模式（?watch=），首次要下载约 40MB 的模型和贴图，所以点了才加载。
// ★网页版 /app 的 CSP 要放行这个地址（deploy/vercel/0x4-site.vercel.json frame-src）
import { useEffect, useState } from 'react'
import { Box, MapPin } from 'lucide-react'
import Button from '@/components/Button'
import { api } from '@/lib/social'
import { locale, t, useLang } from '@/lib/i18n'
import { isNative, openInAppView } from '@/lib/native'

export const GAME_URL = (import.meta.env.VITE_GAME_URL || 'https://game.420.meme/').replace(/\/?$/, '/')

interface LifeView {
  id: string; name: string; address: string; owner: string; ownerNickname: string | null; online: boolean; expired: boolean; nftToken: number | null
  life: { floor: 'F1' | 'F2' | 'F3'; place: string; action: string; text: string; textEn: string; since: number; until: number; symbol: string | null }
  decision: { side: string | null; symbol: string | null; execution: string | null; ts: number; spikes: number | null } | null
}

// 四个区域的名字（2026-09-27 goat）：教堂 / 时光隧道 / 房间 / 派对广场；小精灵只会待在教堂、房间、派对广场
const FLOOR: Record<string, [string, string]> = { F1: ['教堂', 'Cathedral'], F2: ['房间', 'Room'], F3: ['派对广场', 'Party Plaza'] }
const hm = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

/** 「现在」页：它此刻在 Cyber Eden 里做什么 + 3D 画面 + 最近一次交易决策（2026-09-27 起嵌在小精灵详情页的第一个分页里） */
export function WatchPanel({ id }: { id: string }) {
  const lang = useLang((s) => s.lang)
  const [v, setV] = useState<LifeView | null>(null)
  const [err, setErr] = useState(false)
  const [show3d, setShow3d] = useState(false)
  const [loaded3d, setLoaded3d] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => api<LifeView>(`/api/flies/${id}/life`).then((r) => { if (alive) { setV(r); setErr(false) } }).catch(() => { if (alive) setErr(true) })
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, 30_000)
    return () => { alive = false; clearInterval(timer) }
  }, [id])

  const en = lang === 'en'
  if (err && !v) return <div className="mt-4 rounded-2xl bg-card p-4 text-sm text-muted">{t('加载失败，稍后再试')}</div>
  if (!v) return <div className="mt-4 space-y-3"><div className="skeleton h-28" /><div className="skeleton h-40" /></div>
  const text = en ? v.life.textEn : v.life.text
  const side = v.decision?.side
  const sideText = side === 'BUY' ? t('买入') : side === 'SELL' ? t('卖出') : side ? t('持有') : null
  return <>
    <section className="mt-4 rounded-2xl border border-line/70 bg-gradient-to-br from-card to-card2 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-accent">{t('它现在')}</div>
      <div className="mt-0.5 text-lg font-semibold leading-snug">{text}</div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
        <span className="flex items-center gap-1 rounded-full bg-card2 px-2.5 py-1"><MapPin size={12} aria-hidden="true" />{en ? FLOOR[v.life.floor][1] : FLOOR[v.life.floor][0]}</span>
        <span className="rounded-full bg-card2 px-2.5 py-1 tabular-nums">{t('{from} 开始，约 {to} 换下一件事', { from: hm(v.life.since), to: hm(v.life.until) })}</span>
      </div>
    </section>

    {/* 3D 画面：首次约 40MB，点了才加载 */}
    <section className="mt-3 overflow-hidden rounded-2xl border border-line/70 bg-black">
      {show3d ? (
        <div className="relative w-full" style={{ height: 'min(62vh, 520px)' }}>
          {!loaded3d && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70" role="status">{t('正在进入赛博伊甸园…')}</div>}
          {/* 只在网页版内嵌（跨域 + 沙箱：游戏页读不到钱包页面，也不能把整页跳走）；App 里不内嵌，见下面的按钮 */}
          <iframe title={t('赛博伊甸园实时画面')} src={`${GAME_URL}?watch=${encodeURIComponent(v.id)}&lang=${en ? 'en' : 'zh'}`} onLoad={() => setLoaded3d(true)} className="absolute inset-0 h-full w-full border-0" allow="fullscreen" sandbox="allow-scripts allow-same-origin" />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center text-white">
          <Box size={28} className="text-white/80" aria-hidden="true" />
          <div className="text-base font-semibold">{t('在赛博伊甸园里看它')}</div>
          {/* App 里在独立的全屏网页里打开（openInAppView），不嵌进钱包的页面：内嵌的页面能调用 App 的原生接口（含签名），
              游戏页一旦被注入就能碰到钱包（2026-09-28 审查 #2）。独立网页不挂原生接口，又不像系统浏览器那样弹出来（2026-09-29 goat） */}
          <Button size="sm" onClick={() => (isNative ? void openInAppView(`${GAME_URL}?watch=${encodeURIComponent(v.id)}&lang=${en ? 'en' : 'zh'}`, t('返回')).catch(() => {}) : setShow3d(true))}>{t('进入观察模式')}</Button>
        </div>
      )}
    </section>

    <section className="mt-3 rounded-2xl border border-line/70 bg-card p-4">
      <div className="text-xs text-muted">{t('最近一次交易决策')}</div>
      {v.decision && sideText ? (
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <div className={`text-lg font-semibold ${side === 'BUY' ? 'text-up' : side === 'SELL' ? 'text-down' : ''}`}>{sideText} {v.decision.symbol || ''}</div>
          <div className="text-xs tabular-nums text-muted">{v.decision.execution === 'UNFUNDED' || v.decision.execution === 'PAUSED' ? `${t('只记录信号')} · ` : v.decision.execution === 'REJECTED' ? `${t('没下成')} · ` : ''}{hm(v.decision.ts)}</div>
        </div>
      ) : <div className="mt-1 text-sm text-muted">{t('还没有交易决策')}</div>}
    </section>
  </>
}
