// 网页版「流媒体」页头（2026-10-03 goat：直播和会议合成一个入口，两个功能不变）。
// 标题「流媒体」+ 直播 / 会议切换（各自的地址 /live、/meetings，以前的链接照常能打开）；
// 右上「创建流媒体」→ 弹窗二选一：直播（你来讲，大家看）或会议（大家都能说话），选完走各自原来的创建流程。
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import Sheet from '@/components/Sheet'
import { CreateRoomSheet } from '@/pages/Live'
import { t } from '@/lib/i18n'
import { useSocial } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { needLogin } from '../walletGate'
import { useLiveRooms } from '../liveRooms'
import NewMeetingSheet from './NewMeetingSheet'
import { CmHead } from './CommunityShell'
import liveIcon from './img/stream-live.webp'
import meetIcon from './img/stream-meet.webp'

export function StreamHead({ mode, sub, extra }: { mode: 'live' | 'meet'; sub: string; extra?: ReactNode }) {
  const nav = useNavigate()
  const status = useSocial((s) => s.status)
  const appLogin = useSocial((s) => s.qrMode && s.status === 'ready')
  const connected = useWallet(isWalletConnected) || appLogin
  const livekit = useLiveRooms((s) => s.livekit)
  const [choosing, setChoosing] = useState(false)
  const [creating, setCreating] = useState<'live' | 'meet' | null>(null)
  const avDown = livekit === false
  const pick = (m: 'live' | 'meet') => { setChoosing(false); setCreating(m) }
  return (
    <>
      <CmHead title={t('流媒体')} sub={sub} right={<>
        {extra}
        <button type="button" className="cm-btn" onClick={() => { if (!needLogin()) setChoosing(true) }} disabled={connected && status !== 'ready'} data-testid="stream-create"><Plus size={16} />{t('创建流媒体')}</button>
      </>} />
      <div className="cm-filters">
        <div className="cm-seg" role="tablist" aria-label={t('流媒体')}>
          <button type="button" role="tab" aria-pressed={mode === 'live'} aria-selected={mode === 'live'} onClick={() => nav('/live')}>{t('直播')}</button>
          <button type="button" role="tab" aria-pressed={mode === 'meet'} aria-selected={mode === 'meet'} onClick={() => nav('/meetings')}>{t('会议')}</button>
        </div>
      </div>
      <Sheet open={choosing} center onClose={() => setChoosing(false)} title={t('创建流媒体')}>
        <div className="sm-pick">
          {/* 图标是生成的玻璃图（2026-10-03 goat：「图标要生成」），原图和提示词在 docs/art-src/stream-icons */}
          <button type="button" className="sm-opt is-live" onClick={() => pick('live')} disabled={avDown} data-testid="stream-pick-live">
            <img className="sm-ic" src={liveIcon} alt="" width={64} height={64} />
            <span className="sm-t"><b>{t('直播')}</b><small>{t('面向所有人开播')}</small>
              <span className="sm-tags"><i>{t('PK')}</i><i>{t('礼物')}</i><i>{t('开播提醒')}</i></span></span>
            <ChevronRight size={18} className="sm-go" aria-hidden="true" />
          </button>
          <button type="button" className="sm-opt is-meet" onClick={() => pick('meet')} disabled={avDown} data-testid="stream-pick-meet">
            <img className="sm-ic" src={meetIcon} alt="" width={64} height={64} />
            <span className="sm-t"><b>{t('会议')}</b><small>{t('和一群人面对面')}</small>
              <span className="sm-tags"><i>{t('共享屏幕')}</i><i>{t('密码进入')}</i><i>{t('举手发言')}</i></span></span>
            <ChevronRight size={18} className="sm-go" aria-hidden="true" />
          </button>
          {avDown && <p className="sm-note">{t('音视频服务暂不可用')}</p>}
        </div>
      </Sheet>
      <CreateRoomSheet open={creating === 'live'} onClose={() => setCreating(null)} />
      <NewMeetingSheet open={creating === 'meet'} onClose={() => setCreating(null)} />
    </>
  )
}
