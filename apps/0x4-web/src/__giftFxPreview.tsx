// Local preview page for gift animations (dev-only, not shipped in the app): /dev/giftfx-preview.html
// Icons are read directly from server/assets/gifts/ (in production they're the same files copied under /files/ at server startup).
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GiftFxStage, giftSound, type GiftFxGift, type GiftFxHandle } from '@/components/giftFx'

const G = (id: string, nameZh: string, nameEn: string, price: number, fx: string, sound: string | null = null): GiftFxGift & { price: number } =>
  ({ id, nameZh, nameEn, icon: `/files/gift-${id}.webp`, fx, sound, price })
const GIFTS = [
  G('heart', '爱心', 'Heart', 1, 'heart'),
  G('hachimi', '哈基米', 'Hachimi', 5, 'coinrain', '/files/gift-hachimi.mp3'),
  G('kline', '暴涨', 'Pumping', 10, 'kline'),
  G('rose', '玫瑰', 'Rose', 30, 'rose'),
  G('rocket', '火箭', 'Rocket', 50, 'rocket'),
  G('supercar', '跑车', 'Supercar', 100, 'car'),
  G('yacht', '游艇', 'Yacht', 200, 'yacht'),
  G('fireworks', '礼花', 'Fireworks', 888, 'fireworks'),
  G('satoshi', '中本聪', 'Satoshi', 999, 'satoshi'),
  { ...G('custom', '新礼物（没传图标）', 'New gift', 3, 'pop'), icon: null },
]
const resolve = (u: string) => u.replace(/^\/files\//, '/server/assets/gifts/')
const FROM = { id: 'demo', nickname: 'goat' }

function App() {
  const fx = useRef<GiftFxHandle>(null)
  const [lang, setLang] = useState<'zh' | 'en'>('zh')
  const [sound, setSound] = useState(giftSound().on)
  const all = () => GIFTS.slice(0, 9).forEach((g, i) => setTimeout(() => fx.current?.play({ gift: g, from: FROM }), i * 3200))
  ;(window as unknown as { __gfx: unknown }).__gfx = { play: (id: string, n = 1) => { const g = GIFTS.find((x) => x.id === id)!; for (let i = 0; i < n; i++) fx.current?.play({ gift: g, from: FROM }) }, all }
  return <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, borderBottom: '1px solid #222' }}>
      {GIFTS.map((g) => <button key={g.id} onClick={() => fx.current?.play({ gift: g, from: FROM })} style={btn}>
        <img src={resolve(g.icon || '/files/gift-giftbox.webp')} alt="" width={28} height={28} style={{ objectFit: 'contain' }} />{g.nameZh}<small style={{ opacity: .6 }}>{g.price}</small>
      </button>)}
      <button style={btn} onClick={() => { for (let i = 0; i < 10; i++) fx.current?.play({ gift: GIFTS[1], from: FROM }) }}>哈基米连点 10 下</button>
      <button style={btn} onClick={all}>九个挨个播</button>
      <button style={btn} onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>{lang === 'zh' ? 'English' : '中文'}</button>
      <button style={btn} onClick={() => { giftSound().setEnabled(!sound); setSound(!sound) }}>礼物音效：{sound ? '开' : '关'}</button>
    </div>
    <div style={{ position: 'relative', overflow: 'hidden', background: 'radial-gradient(120% 90% at 30% 20%, #2a2f45, #0b0b10 70%)' }}>
      <div style={{ position: 'absolute', left: 16, top: 12, opacity: .5 }}>直播画面</div>
      <GiftFxStage ref={fx} lang={lang} resolve={resolve} />
    </div>
  </div>
}
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 10, border: '1px solid #333', background: '#16161d', color: '#fff', cursor: 'pointer' }

createRoot(document.getElementById('root')!).render(<App />)
