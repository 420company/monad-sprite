// Web groups / DMs / "0x4 Official" (/g/:id, /dm/:address, /official widescreen; 2026-09-29: opening groups and DMs on desktop still showed full-screen mobile pages).
// Layout: 320px conversation list on the left (same ChatList as the community sidebar, current conversation highlighted) · chat window on the right (reusing mobile GroupChat / DmChat / Official,
// messaging, encryption, member management, gifts, and other business logic untouched — just mounted inside desktop panels instead of spanning the full screen width).
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
  // Web 0x login lands in the mobile app's account, but the DM key isn't the same one (store/social.ts dmKeyElsewhere)
  const dmKeyElsewhere = useSocial((s) => s.dmKeyElsewhere)
  const loadGroups = useSocial((s) => s.loadGroups)
  const ready = connected && status === 'ready'
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  // Conversation list: same set as the community sidebar (groups + DMs + official announcements)
  useEffect(() => {
    if (!ready) return
    let alive = true
    setLoading(true); setFailed(false)
    void useSocial.getState().loadDmList()
    loadGroups().then(() => { if (alive) setFailed(false) }).catch(() => { if (alive) setFailed(true) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [ready, retry, loadGroups])
  // Official announcements open without a wallet: when no wallet is connected / community login failed, the announcement page explains itself — don't also put it in the sidebar, no need to say the same thing twice
  if (kind === 'official' && !ready) {
    return <div className="wc-chatshell is-page is-single"><section className="wc-panel wc-chatpane is-scroll" aria-label={t('聊天')}><Official /></section></div>
  }
  return (
    <div className={`wc-chatshell ${kind === 'official' ? 'is-page' : ''}`}>
      <aside className="wc-panel wc-chatrail" aria-label={t('会话列表')}>
        <div className="wc-ph"><h2 className="wc-ph-t"><MessageCircle size={15} aria-hidden="true" className="self-center" />{t('消息')}</h2><Link to="/community" className="wc-link">{t('社区')}<ArrowRight size={13} /></Link></div>
        <div className="wc-rail-body wc-chats">
          {!connected ? <Empty icon={MessageCircle} text={t('连接 0x4 Wallet 后显示你的群和私信。')} action={<button type="button" className="wc-btn is-sm is-primary" onClick={() => { needWallet() }}>{t('连接 0x4 Wallet')}</button>} />
            // Community login failed: the reason + "log in again" only appear in the sidebar (the right-side chat window waits for login before loading)
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
