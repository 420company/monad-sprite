// Web "Settings" (/settings, entered from the wallet menu. 2026-09-29 goat: "settings is a (mobile) page too").
// Layout (docs/WEB_DESIGN.md): max 960 wide, group nav on the left, content on the right; the group is recorded in the URL (?tab=) so the bell's "notification settings" jumps straight to the notification group.
// The web wallet lives in the 0x4 browser extension: mobile-only items never appear — create / import / export wallet, biometrics, haptics, auto-lock;
// the wallet group has "Disconnect wallet" (desktop/walletGate's disconnectWallet — both the 0x4 extension and external wallets go through it).
// Every setting reuses the mobile settings page's stores / APIs / sheets (profile, X binding, message history, slippage, fuel fees, auto-trading, account type, logged-in computers); sheets are centered modals on wide web screens.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AtSign, Bell, Bot, ChevronRight, Copy, Crown, FileText, Fuel, Headset, ImagePlus, Info, Languages, Laptop, Palette, LogOut, Mail, MessageSquareLock, Pencil, ShieldCheck, SlidersHorizontal, Trash2, UserRound, Wallet } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { SITE_LINKS, legalUrl } from '@/lib/legal'
import XBadge, { useXHandles } from '@/components/XBadge'
import ProfileSheet from '@/components/ProfileSheet'
import { NotificationPrefs } from '@/components/NotificationSheet'
import MeetSessionsSheet from '@/components/MeetSessionsSheet'
import FeeSheet from '@/components/FeeSheet'
import FuelSheet from '@/components/FuelSheet'
import AutoTradeSheet from '@/components/AutoTradeSheet'
import SolAutoTradeSheet from '@/components/SolAutoTradeSheet'
import { toast } from '@/components/Toast'
import { copyText } from '@/lib/native'
import { LANG_OPTIONS, useLang, t } from '@/lib/i18n'
import { WEB_THEME_OPTIONS, useTheme } from '@/lib/theme'
import { SPACE_WALLS, useSpace } from '../space'
import { CHAT_MODE_OPTIONS, type ChatMode } from '@/lib/chatPrefs'
import { onXAuthResult, openXAuthWindow, type XAuthResult } from '@/lib/xauth'
import { api } from '@/lib/social'
import { useFees } from '@/lib/fees'
import { errorText } from '@/lib/errors'
import { useSocial, displayName } from '@/store/social'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { disconnectWallet } from '../walletGate'
import BlocksSheet from '@/components/BlocksSheet'
import AccountDeleteSheet from '@/components/AccountDeleteSheet'
import { SocialLogin, copyAddr, midShort } from '../ui'
import { replaceRoute, routeQuery } from '@/lib/route'

type Group = 'general' | 'trade' | 'notify' | 'look' | 'lang' | 'wallet' | 'help' | 'about'
/** Groups: label is a function, translated at render time */
const GROUPS: { k: Group; label: () => string; icon: typeof UserRound }[] = [
  { k: 'general', label: () => t('通用'), icon: UserRound },
  { k: 'trade', label: () => t('交易||settings'), icon: Bot },
  { k: 'notify', label: () => t('通知'), icon: Bell },
  { k: 'look', label: () => t('外观'), icon: Palette },
  { k: 'lang', label: () => t('语言'), icon: Languages },
  { k: 'wallet', label: () => t('钱包与安全'), icon: ShieldCheck },
  // Help & support is its own item (2026-10-02 goat: it shouldn't be buried under "About")
  { k: 'help', label: () => t('帮助与客服'), icon: Headset },
  { k: 'about', label: () => t('关于'), icon: Info },
]
const isGroup = (v: string | null): v is Group => !!v && GROUPS.some((g) => g.k === v)

export default function SettingsDesk() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  // ?open=pc: entered from the "a new computer logged into your account" notification (lib/notifRef.ts) — goes to "Wallet & security" and opens logged-in computers (2026-10-04 walkthrough: it used to land on "General")
  const openPc = params.get('open') === 'pc'
  // Legacy links may carry ?tab=notify plus the X-auth return ?x=… — those land on "General"
  const group: Group = openPc ? 'wallet' : isGroup(raw) ? raw : 'general'
  const pick = (k: Group) => setParams({ tab: k }, { replace: true })
  const cur = GROUPS.find((g) => g.k === group)!
  return (
    <div className="wc-page">
      <div className="wc-set">
        <header className="wc-head" style={{ gridColumn: '1 / -1' }}>
          <div><h1 className="wc-title">{t('设置')}</h1><p className="wc-sub">{t('账户、交易、通知和语言。钱包本身的安全设置在 0x4 浏览器插件里。')}</p></div>
        </header>
        <nav className="wc-set-nav" aria-label={t('设置分组')}>
          {GROUPS.map(({ k, label, icon: Icon }) => <button key={k} type="button" aria-current={group === k ? 'true' : undefined} onClick={() => pick(k)}><Icon size={16} aria-hidden="true" />{label()}</button>)}
        </nav>
        <section className="wc-set-main" aria-label={cur.label()}>
          {/* Community not logged in: profile, X, message history and notification prefs all need login — the reason is stated here only once */}
          <SocialLogin bar />
          {group === 'general' && <GeneralGroup />}
          {group === 'trade' && <TradeGroup />}
          {group === 'notify' && <section className="wc-panel"><div className="wc-ph"><h2 className="wc-ph-t">{t('通知')}</h2></div><div className="wc-notify-prefs"><NotificationPrefs active /></div></section>}
          {group === 'look' && <LookGroup />}
          {group === 'lang' && <LangGroup />}
          {group === 'wallet' && <WalletGroup />}
          {group === 'help' && <HelpGroup />}
          {group === 'about' && <AboutGroup />}
        </section>
      </div>
    </div>
  )
}

/** One setting row: title + description on the left, value / button on the right */
function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return <div className="wc-set-row"><div className="wc-set-text"><b>{title}</b>{desc && <p>{desc}</p>}</div>{children}</div>
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="wc-panel"><div className="wc-ph"><h2 className="wc-ph-t">{title}</h2></div>{children}</section>
}

/** General: profile, X account, message history */
function GeneralGroup() {
  const nav = useNavigate()
  const { me, status, chatMode, setChatMode } = useSocial()
  const ready = status === 'ready'
  const [editing, setEditing] = useState(false)
  const [safety, setSafety] = useState<'blocks' | 'delete' | null>(null)
  const [xBusy, setXBusy] = useState(false)
  const [xConfigured, setXConfigured] = useState<boolean | null>(null)
  const [modeBusy, setModeBusy] = useState(false)
  useEffect(() => {
    setXConfigured(null)
    if (!ready) return
    let alive = true
    api<{ xConfigured: boolean }>('/api/me').then((r) => { if (alive) setXConfigured(r.xConfigured) }).catch(() => {})
    return () => { alive = false }
  }, [ready])
  // X authorization completes in a new window and posts the result back (same lib/xauth as the mobile settings page); on full-page navigation back, the result is in the URL
  useEffect(() => {
    const show = (r: XAuthResult) => {
      setXBusy(false)
      toast[r.x === 'linked' ? 'success' : 'error'](r.x === 'linked' ? t('X 账号已绑定') : r.reason ? t('X 绑定失败：{reason}', { reason: r.reason }) : r.x === 'expired' ? t('X 授权已过期，请重试') : t('X 绑定失败'))
      void useSocial.getState().refreshMe().then(() => {
        const m = useSocial.getState().me
        if (m) useXHandles.getState().set(m.address, m.xHandle ? { handle: m.xHandle, name: null, avatar: null, banner: null, bio: null, verified: false, joined: null, followers: null, following: null } : null)
      })
    }
    const off = onXAuthResult(show)
    const q = routeQuery()
    const x = q.get('x')
    if (x) { show({ x, reason: q.get('reason') }); replaceRoute('/settings') }
    return off
  }, [])
  const linkX = async () => {
    setXBusy(true)
    try {
      const r = await api<{ url: string }>('/api/x/start')
      if (!openXAuthWindow(r.url)) return
      window.setTimeout(() => setXBusy(false), 2000)
    } catch (e) { toast.error(errorText(e, t('失败'))); setXBusy(false) }
  }
  const unlinkX = async () => {
    if (!confirm(t('解绑 X 账号？'))) return
    try { await api('/api/me/x', { method: 'DELETE' }); await useSocial.getState().refreshMe(); if (me?.address) useXHandles.getState().set(me.address, null) /* The X mark is recorded per 0x4 account, not per extension address */; toast.success(t('已解绑')) } catch (e) { toast.error(errorText(e, t('失败'))) }
  }
  // Message history mode: double-confirm before switching to device-only storage / daily clearing; deleted records can't be recovered (same rule as the mobile settings page)
  const pickMode = async (mode: ChatMode) => {
    if (mode === chatMode || modeBusy) return
    const warn = mode === 'device'
      ? t('云端的私信记录会先保存到这台设备，再从云端删除。换设备或清除浏览器数据后无法恢复。确定切换？')
      : mode === 'daily' ? t('每天当地时间 00:00，清空你在云端和本机的私信记录，群消息对你隐藏。清空后无法恢复。确定切换？') : null
    if (warn && !confirm(warn)) return
    setModeBusy(true)
    try { await setChatMode(mode); toast.success(t('已保存')) } catch (e) { toast.error(errorText(e, t('失败'))) } finally { setModeBusy(false) }
  }
  // "Stored only on this phone" becomes "this device" on desktop
  const modeText = (o: (typeof CHAT_MODE_OPTIONS)[number]) => o.value === 'device'
    ? { label: t('只存在这台设备'), note: t('消息送达后从云端删除，记录加密保存在本机。换设备或清除浏览器数据后无法恢复。') }
    : o.value === 'cloud' ? { label: t(o.label), note: t('私信只存密文，换设备连接同一钱包可恢复。') }
      : { label: t(o.label), note: t(o.note) }
  return (
    <>
      <Panel title={t('个人资料')}>
        <div className="wc-set-row">
          {me ? <Avatar address={me.address} src={me.avatar} name={me.nickname} size={48} chainId={me.avatarNft?.chainId} /> : <span className="wc-sk" style={{ width: 48, height: 48, borderRadius: 24 }} />}
          <div className="wc-set-text">
            <b className="flex items-center gap-1.5">{me ? displayName(me) : ready ? '--' : t('社区连上后显示')}{me?.xHandle && <XBadge address={me.address} size={13} />}</b>
            <p>{[me?.handle ? `@${me.handle}` : null, me?.bio || null].filter(Boolean).join(' · ') || t('头像只能用你持有的 NFT，昵称和简介随时可改。')}</p>
          </div>
          <button type="button" className="wc-btn is-sm" disabled={!ready} onClick={() => setEditing(true)}><Pencil size={13} />{t('编辑资料')}</button>
          <button type="button" className="wc-btn is-sm" disabled={!me} onClick={() => me && nav(`/u/${me.address}`)}>{t('我的主页')}<ChevronRight size={13} /></button>
        </div>
        <Row title={<span className="flex items-center gap-2"><AtSign size={15} aria-hidden="true" />{t('X 账号')}</span>} desc={me?.xHandle ? `@${me.xHandle}` : t('绑定后昵称旁边会显示 X 标记。')}>
          {me?.xHandle
            ? <button type="button" className="wc-btn is-sm is-danger" disabled={!ready} onClick={() => void unlinkX()}>{t('解绑')}</button>
            : <button type="button" className="wc-btn is-sm" disabled={!ready || xConfigured === false || xBusy} onClick={() => void linkX()}>{xBusy ? t('正在连接') : xConfigured === false ? t('暂不可用') : t('绑定 X 账号')}</button>}
        </Row>
      </Panel>
      <Panel title={t('消息记录')}>
        <div role="radiogroup" aria-label={t('消息记录')}>
          {CHAT_MODE_OPTIONS.map((o) => { const m = modeText(o); return (
            <button key={o.value} type="button" role="radio" className="wc-radio" aria-checked={chatMode === o.value} disabled={!ready || modeBusy} onClick={() => void pickMode(o.value)}>
              <i aria-hidden="true" /><span>{m.label}<small>{m.note}</small></span>
            </button>
          ) })}
        </div>
        <div className="wc-pf"><span className="flex items-center gap-2"><MessageSquareLock size={13} aria-hidden="true" />{t('群聊记录属于整个群，这里只影响你自己看到的内容。')}</span></div>
      </Panel>
      {/* Blocklist and account deletion (2026-10-02 listing requirement, on both mobile and desktop) */}
      <Panel title={t('隐私与账号')}>
        <Row title={t('黑名单')} desc={t('被你拉黑的人：互相看不到对方的动态和评论，对方不能给你发私信。')}>
          <button type="button" className="wc-btn is-sm" disabled={!ready} onClick={() => setSafety('blocks')}>{t('查看')}<ChevronRight size={13} /></button>
        </Row>
        <Row title={t('注销账号')} desc={t('删除你在 0x4 的资料、动态、关注、私信和小精灵。钱包和链上的币不受影响。')}>
          <button type="button" className="wc-btn is-sm is-danger" disabled={!ready} onClick={() => setSafety('delete')}>{t('注销账号')}</button>
        </Row>
      </Panel>
      <ProfileSheet open={editing} onClose={() => setEditing(false)} />
      <BlocksSheet open={safety === 'blocks'} onClose={() => setSafety(null)} />
      <AccountDeleteSheet open={safety === 'delete'} onClose={() => setSafety(null)} />
    </>
  )
}

/** Trading: auto-trading, slippage cap, fuel fees, account type */
function TradeGroup() {
  const { slippageBps, setSlippageBps, autoRefuel } = useSettings()
  const ready = useSocial((s) => s.status === 'ready')
  const fees = useFees((s) => s.fees)
  useEffect(() => { if (ready) void useFees.getState().load() }, [ready])
  const [draft, setDraft] = useState(String(slippageBps / 100))
  const [sheet, setSheet] = useState<'auto' | 'solAuto' | 'fuel' | 'fees' | null>(null)
  const save = () => {
    const v = Number(draft)
    if (!(v > 0 && v <= 50)) return toast.error(t('范围 0.1% ~ 50%'))
    setSlippageBps(Math.round(v * 100)); toast.success(t('滑点上限 {v}%', { v }))
  }
  return (
    <>
      <Panel title={t('交易||settings')}>
        <Row title={<span className="flex items-center gap-2"><Bot size={15} aria-hidden="true" />{t('全自动交易（BNB Chain）')}</span>} desc={t('开启后，小精灵会自动执行交易，不用每笔确认。')}>
          <button type="button" className="wc-btn is-sm" onClick={() => setSheet('auto')}>{t('管理||action')}<ChevronRight size={13} /></button>
        </Row>
        {/* Solana version (2026-10-04): enable, disable, withdraw vault coins back to the wallet */}
        <Row title={<span className="flex items-center gap-2"><Bot size={15} aria-hidden="true" />{t('全自动交易（Solana）')}</span>} desc={t('开启后，小精灵会自动执行交易，不用每笔确认。')}>
          <button type="button" className="wc-btn is-sm" onClick={() => setSheet('solAuto')}>{t('管理||action')}<ChevronRight size={13} /></button>
        </Row>
        <Row title={<span className="flex items-center gap-2"><SlidersHorizontal size={15} aria-hidden="true" />{t('滑点上限')}</span>} desc={t('价格偏差超过上限就取消交易。')}>
          <div className="wc-seg" role="group" aria-label={t('滑点预设')}>
            {[0.5, 1, 3, 5].map((v) => <button key={v} type="button" aria-pressed={Number(draft) === v} onClick={() => setDraft(String(v))}>{v}%</button>)}
          </div>
          <label className="wc-input is-sm" style={{ width: 96 }}><input type="number" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('自定义（%）')} /><span>%</span></label>
          <button type="button" className="wc-btn is-sm is-primary" disabled={Number(draft) * 100 === slippageBps} onClick={save}>{t('保存')}</button>
        </Row>
        <Row title={<span className="flex items-center gap-2"><Fuel size={15} aria-hidden="true" />{t('燃料费')}</span>} desc={autoRefuel ? t('已开启自动补充燃料费') : t('开启自动补充，哪条链不够就从 BNB 换一点过去。')}>
          <button type="button" className="wc-btn is-sm" disabled={!ready} onClick={() => setSheet('fuel')}>{t('设置')}<ChevronRight size={13} /></button>
        </Row>
        <Row title={<span className="flex items-center gap-2"><Crown size={15} aria-hidden="true" />{t('账户种类')}</span>} desc={fees.vip ? 'VIP' : t('普通')}>
          <button type="button" className="wc-btn is-sm" disabled={!ready} onClick={() => setSheet('fees')}>{t('查看')}<ChevronRight size={13} /></button>
        </Row>
      </Panel>
      <AutoTradeSheet open={sheet === 'auto'} onClose={() => setSheet(null)} />
      <SolAutoTradeSheet open={sheet === 'solAuto'} onClose={() => setSheet(null)} />
      <FuelSheet open={sheet === 'fuel'} onClose={() => setSheet(null)} />
      <FeeSheet open={sheet === 'fees'} onClose={() => setSheet(null)} />
    </>
  )
}

/** Appearance (2026-10-02 goat: midnight black / taro white; "space" added 10-03): one card per theme showing a thumbnail of that colorway; tap to switch instantly.
 *  Picking "space" adds a row of backgrounds below: 7 built-in + your own images (stored only in this computer's browser, space.ts) */
function LookGroup() {
  const theme = useTheme((s) => s.theme)
  const setting = useTheme((s) => s.setting)
  const setTheme = useTheme((s) => s.setTheme)
  const look = setting === 'space' ? 'space' : theme
  return (
    <>
      <Panel title={t('外观')}>
        <div className="wc-looks" role="radiogroup" aria-label={t('外观')}>
          {WEB_THEME_OPTIONS.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={look === o.value} className={`wc-look is-${o.value}`} onClick={() => setTheme(o.value)}>
              <span className="wc-look-pv" aria-hidden="true"><i /><i /><i /></span>
              <span className="wc-look-t">{t(o.label)}</span>
            </button>
          ))}
        </div>
      </Panel>
      {look === 'space' && <SpaceWalls />}
    </>
  )
}

/** "Space" backgrounds: my images (this machine) + 8 built-in */
function SpaceWalls() {
  const { wall, customUrl, setWall, setCustom, clearCustom } = useSpace()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try { await setCustom(f) } catch (e) {
      const m = e instanceof Error ? e.message : ''
      toast.error(m === 'type' ? t('请选择图片文件') : m === 'size' ? t('图片太大了，请选 25MB 以内的') : t('这张图片读不出来，换一张试试'))
    } finally { setBusy(false); if (file.current) file.current.value = '' }
  }
  return (
    <Panel title={t('空间背景')}>
      <div role="radiogroup" aria-label={t('空间背景')}>
        {/* My images go on top */}
        <p className="wc-bgs-h">{t('我的图片')}</p>
        <div className="wc-bgs">
          {customUrl
            ? <div className="wc-bg-own">
                <button type="button" role="radio" aria-checked={wall === 'custom'} className="wc-bg" onClick={() => setWall('custom')}>
                  <img src={customUrl} alt="" draggable={false} />
                  <span>{t('我的图片')}</span>
                </button>
                <button type="button" className="wc-bg-x" onClick={() => void clearCustom()} aria-label={t('删除我的图片')} title={t('删除我的图片')}><Trash2 size={13} /></button>
              </div>
            : null}
          <button type="button" className="wc-bg is-add" disabled={busy} onClick={() => file.current?.click()}>
            <i aria-hidden="true"><ImagePlus size={20} /></i>
            <span>{busy ? t('处理中') : customUrl ? t('换一张图片') : t('用自己的图片')}</span>
          </button>
        </div>
        <p className="wc-bgs-note">{t('自己的图片只保存在这台电脑的浏览器里，不会上传。')}</p>
        <p className="wc-bgs-h">{t('背景')}</p>
        <div className="wc-bgs">
          {SPACE_WALLS.map((w) => (
            <button key={w.id} type="button" role="radio" aria-checked={wall === w.id} className="wc-bg" onClick={() => setWall(w.id)}>
              <img src={w.thumb} alt="" draggable={false} loading="lazy" />
              <span>{t(w.label)}</span>
            </button>
          ))}
        </div>
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </Panel>
  )
}

/** Language: options written in their own language — Chinese (Simplified), Chinese (Traditional), English — never translated, so everyone recognizes their own; language switch in the top bar works anytime */
function LangGroup() {
  const { setting, setLang } = useLang()
  return (
    <Panel title={t('语言')}>
      <div role="radiogroup" aria-label={t('语言')}>
        {LANG_OPTIONS.map((o) => (
          <button key={o.value} type="button" role="radio" className="wc-radio" aria-checked={setting === o.value} onClick={() => setLang(o.value)}>
            <i aria-hidden="true" /><span>{o.value === 'auto' ? t('跟随系统') : o.label}</span>
          </button>
        ))}
      </div>
    </Panel>
  )
}

/** Wallet & security: connected addresses, logged-in computers, token approvals, disconnect 0x4 Wallet (web doesn't create / import / export) */
function WalletGroup() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const { evmAddress, address, btcAddress } = useWallet()
  const ready = useSocial((s) => s.status === 'ready')
  const [sessions, setSessions] = useState(() => params.get('open') === 'pc')
  // Once opened, drop open=pc (closing the sheet then refreshing won't pop it again); stay on Wallet & security
  useEffect(() => { if (params.get('open') === 'pc') setParams({ tab: 'wallet' }, { replace: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const addrs = [
    evmAddress && { k: 'EVM', note: t('适用于 BNB Chain、Ethereum、Base、Arbitrum 等 EVM 网络'), v: evmAddress },
    address && { k: 'Solana', note: t('仅适用于 Solana 网络'), v: address },
    btcAddress && { k: 'Bitcoin', note: t('仅适用于比特币网络'), v: btcAddress },
  ].filter(Boolean) as { k: string; note: string; v: string }[]
  return (
    <>
      <Panel title={t('已连接的钱包')}>
        {addrs.map((a) => (
          <Row key={a.k} title={<span className="flex items-center gap-2"><Wallet size={15} aria-hidden="true" />{a.k}<span className="wc-mute num" style={{ fontWeight: 400 }}>{midShort(a.v)}</span></span>} desc={a.note}>
            <button type="button" className="wc-btn is-sm" onClick={() => copyAddr(a.v)}><Copy size={13} />{t('复制地址')}</button>
          </Row>
        ))}
        <div className="wc-pf"><span>{t('私钥只保存在 0x4 浏览器插件里，网页拿不到。')}</span></div>
      </Panel>
      <Panel title={t('安全')}>
        <Row title={<span className="flex items-center gap-2"><Laptop size={15} aria-hidden="true" />{t('已登录的电脑')}</span>} desc={t('扫码登录过的电脑，可以逐台移除。')}>
          <button type="button" className="wc-btn is-sm" disabled={!ready} onClick={() => setSessions(true)}>{t('查看')}<ChevronRight size={13} /></button>
        </Row>
        <Row title={<span className="flex items-center gap-2"><ShieldCheck size={15} aria-hidden="true" />{t('代币授权')}</span>} desc={t('查看和撤销合约对你代币的使用授权。')}>
          <button type="button" className="wc-btn is-sm" onClick={() => nav('/approvals')}>{t('管理||action')}<ChevronRight size={13} /></button>
        </Row>
        <Row title={<span className="flex items-center gap-2"><LogOut size={15} aria-hidden="true" />{t('断开 0x4 Wallet')}</span>} desc={t('断开后这个网站拿不到你的地址，再用时重新连接。')}>
          <button type="button" className="wc-btn is-sm is-danger" onClick={() => { void disconnectWallet(); nav('/discover', { replace: true }) }}>{t('断开')}</button>
        </Row>
      </Panel>
      <MeetSessionsSheet open={sessions} onClose={() => setSessions(false)} />
    </>
  )
}

/** Help & support (its own item since 2026-10-02): tickets (new, view replies) and the support email */
function HelpGroup() {
  const nav = useNavigate()
  const ready = useSocial((s) => s.status === 'ready')
  return (
    <Panel title={t('帮助与客服')}>
      <Row title={<span className="flex items-center gap-2"><Headset size={15} aria-hidden="true" />{t('联系客服')}</span>} desc={t('新建工单、查看客服回复。')}>
        <button type="button" className="wc-btn is-sm" disabled={!ready} onClick={() => nav('/support')}>{t('打开')}<ChevronRight size={13} /></button>
      </Row>
      <Row title={<span className="flex items-center gap-2"><Mail size={15} aria-hidden="true" />{t('客服邮箱')}</span>} desc="support@420.meme">
        <button type="button" className="wc-btn is-sm" onClick={() => copyText('support@420.meme').then(() => toast.success(t('已复制')), () => toast.error(t('复制失败')))}><Copy size={13} />{t('复制')}</button>
      </Row>
    </Panel>
  )
}

/** About: version, legal docs, open-source licenses (the chart library's license requires attribution) */
function AboutGroup() {
  return (
    <>
      <Panel title={t('法律文件')}>
        {/* The download center also goes under "About" (2026-10-04 walkthrough: previously only the three legal docs) */}
        {SITE_LINKS.map((l) => (
          <Row key={l.key} title={t(l.label)}>
            <a className="wc-btn is-sm" href={legalUrl(l.url)} target="_blank" rel="noreferrer">{t('打开')}<ChevronRight size={13} /></a>
          </Row>
        ))}
      </Panel>
      <Panel title={t('开源许可')}>
        {/* TradingView Lightweight Charts' license (Apache 2.0 + NOTICE) requires in-app attribution with a link to tradingview.com */}
        <Row title={<span className="flex items-center gap-2"><FileText size={15} aria-hidden="true" />{t('K 线图使用 TradingView Lightweight Charts™。')}</span>} desc={<>Copyright (c) 2025 TradingView, Inc. · Apache License 2.0 · <a className="wc-link" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">https://www.tradingview.com/</a></>} />
      </Panel>
    </>
  )
}
