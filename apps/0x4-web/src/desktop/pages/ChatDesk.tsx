// 网页版群聊 / 私信 / 「0x4 官方」（/g/:id、/dm/:address、/official 宽屏，2026-09-29：电脑端点进群和私信还是整屏手机页面）。
// 版式：左 320 会话列表（和社区左栏同一个 ChatList，当前会话高亮）· 右边聊天窗（复用手机的 GroupChat / DmChat / Official，
// 收发消息、加密、成员管理、礼物等业务逻辑一行不改，只是装进电脑端的面板里，不再铺满整个屏幕宽）。
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, MessageCircle } from 'lucide-react'
import ChatList from '@/components/ChatList'
import GroupChat from '@/pages/GroupChat'
import DmChat from '@/pages/DmChat'
import Official from '@/pages/Official'
import { useSocial } from '@/store/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { t } from '@/lib/i18n'
import { needWallet } from '../walletGate'
import { Empty, SocialLogin } from '../ui'

export default function ChatDesk({ kind }: { kind: 'group' | 'dm' | 'official' }) {
  const connected = useWallet(isWalletConnected)
  const status = useSocial((s) => s.status)
  // 网页版 0x 登录登进了手机 App 的账号、私信钥匙不是同一把（store/social.ts dmKeyElsewhere）
  const dmKeyElsewhere = useSocial((s) => s.dmKeyElsewhere)
  const loadGroups = useSocial((s) => s.loadGroups)
  const ready = connected && status === 'ready'
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  // 会话列表：和社区左栏同一套（群 + 私信 + 官方公告）
  useEffect(() => {
    if (!ready) return
    let alive = true
    setLoading(true); setFailed(false)
    void useSocial.getState().loadDmList()
    loadGroups().then(() => { if (alive) setFailed(false) }).catch(() => { if (alive) setFailed(true) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [ready, retry, loadGroups])
  // 官方公告不用钱包也能打开：没连钱包 / 社区没登录上时公告页自己会说明，这里不再放左栏，免得同一件事说两遍
  if (kind === 'official' && !ready) {
    return <div className="wc-chatshell is-page is-single"><section className="wc-panel wc-chatpane is-scroll" aria-label={t('聊天')}><Official /></section></div>
  }
  return (
    <div className={`wc-chatshell ${kind === 'official' ? 'is-page' : ''}`}>
      <aside className="wc-panel wc-chatrail" aria-label={t('会话列表')}>
        <div className="wc-ph"><h2 className="wc-ph-t"><MessageCircle size={15} aria-hidden="true" className="self-center" />{t('消息')}</h2><Link to="/community" className="wc-link">{t('社区')}<ArrowRight size={13} /></Link></div>
        <div className="wc-rail-body wc-chats">
          {!connected ? <Empty icon={MessageCircle} text={t('连接 0x4 Wallet 后显示你的群和私信。')} action={<button type="button" className="wc-btn is-sm is-primary" onClick={() => { needWallet() }}>{t('连接 0x4 Wallet')}</button>} />
            // 社区没登录上：原因 +「重新登录」只在左栏说（右边聊天窗等登录上再加载）
            : !ready ? <SocialLogin row={false} />
              : <ChatList loading={loading} failed={failed} onRetry={() => setRetry((n) => n + 1)} />}
        </div>
      </aside>
      <section className={`wc-panel wc-chatpane ${kind === 'official' ? 'is-scroll' : ''}`} aria-label={t('聊天')}>
        {kind === 'dm' && dmKeyElsewhere && <p className="wc-note is-warn">{t('这个账号的私信钥匙在手机 App 上，网页版读不了收到的私信，请在手机上查看。')}</p>}
        {kind === 'group' ? <GroupChat /> : kind === 'dm' ? <DmChat /> : <Official />}
      </section>
    </div>
  )
}
