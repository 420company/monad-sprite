// Onboarding guide: a three-step intro on first entry; re-viewable from the "me" tab
import { useState } from 'react'
import { Flame, Gift, TrendingUp } from 'lucide-react'
import Button from './Button'
import { useSettings } from '@/store/settings'
import { t } from '@/lib/i18n'

const steps = [
  { Icon: Flame, title: '发现 → 冲', text: '发现页看热门榜，粘贴合约地址就能加自选。任何链的币都可以用你钱包里任意资产直接买。' },
  { Icon: TrendingUp, title: '交易即社交', text: '每笔买卖会自动变成动态，关注厉害的交易者，看排行榜和社区战绩，好友流里跟着冲。' },
  { Icon: Gift, title: '聊天、开播、PK', text: '每个币都有一间房。开直播和别的主播 PK，或者开个会面对面聊。私钥只在你手机里。' },
]

export default function Guide({ force, onClose }: { force?: boolean; onClose?: () => void }) {
  const { guideDone, setGuideDone } = useSettings()
  const [i, setI] = useState(0)
  if (guideDone && !force) return null
  const done = () => { setGuideDone(true); onClose?.() }
  const s = steps[i]
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="safe-bottom w-full max-w-[480px] rounded-t-3xl bg-card p-6">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent"><s.Icon size={28} strokeWidth={1.8} aria-hidden="true" /></span>
        <h2 className="mt-3 text-xl font-bold">{t(s.title)}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t(s.text)}</p>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5">{steps.map((_, k) => <span key={k} className={`h-1.5 rounded-full ${k === i ? 'w-5 bg-accent' : 'w-1.5 bg-line'}`} />)}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={done}>{t('跳过')}</Button>
            <Button size="sm" onClick={() => (i < steps.length - 1 ? setI(i + 1) : done())}>{i < steps.length - 1 ? t('下一步') : t('开始')}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
