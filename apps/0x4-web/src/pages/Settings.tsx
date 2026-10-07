// "Me" page: identity, on-site balance, and grouped settings.
// 2026-09-25 streamlined per goat: removed entries duplicated from Home (trade history / receiving address / earnings & withdrawals),
// hid unreleased "My Rewards" and "Replay onboarding"; merged three private-key export rows into "Backup & Export";
// rarely-touched items (token approvals / reset wallet) collapsed under "Advanced" by default. Solana node setting removed (2026-09-25 goat) — always use our default node
import { useEffect, useState } from 'react'
import { BALANCE_FEATURES } from '@/lib/features'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, AtSign, Ban, Bell, Bot, Check, Crown, Fuel, FileText, Languages, Laptop, SunMoon, ChevronRight, Copy, FileKey2, Fingerprint, Headset, KeyRound, Lock, MessageSquareLock, Pencil, ScanFace, RefreshCw, ShieldCheck, SlidersHorizontal, Timer, Trash2, UserX, Wallet } from 'lucide-react'
import BlocksSheet from '@/components/BlocksSheet'
import AccountDeleteSheet from '@/components/AccountDeleteSheet'
import { useTermsGate } from '@/lib/safety'
import Avatar from '@/components/Avatar'
import Button from '@/components/Button'
import Sheet from '@/components/Sheet'
import ReceiveSheet from '@/components/ReceiveSheet'
import ProfileSheet from '@/components/ProfileSheet'
import NotificationSheet from '@/components/NotificationSheet'
import MeetSessionsSheet from '@/components/MeetSessionsSheet'
import { useGiftWallet } from '@/components/GiftSheet'
import { Input, Label } from '@/components/Field'
import { toast } from '@/components/Toast'
import { persistentSession } from '@/lib/secureStore'
import { LANG_OPTIONS, locale, useLang, t } from '@/lib/i18n'
import { THEME_OPTIONS, useTheme } from '@/lib/theme'
import { clearReloadEvents, reloadEvents } from '@/lib/reloadWatch'

const SHOW_RELOADS = import.meta.env.VITE_DIAG === '1'
import { useSocial, displayName } from '@/store/social'
import { useSettings } from '@/store/settings'
import { useWallet } from '@/store/wallet'
import { fmtUsd, shortId } from '@/lib/format'
import { api } from '@/lib/social'
import { isNative, platform, openExternal, copyText } from '@/lib/native'
import { LEGAL_LINKS, legalUrl } from '@/lib/legal'
import { AUTO_LOCK_OPTIONS } from '@/lib/autolock'
import { onXAuthResult, openXAuthWindow, type XAuthResult } from '@/lib/xauth'
import { biometricStatus, biometryWord, type BiometricStatus } from '@/lib/biometric'
import XBadge, { useXHandles } from '@/components/XBadge'
import { CHAT_MODE_OPTIONS, type ChatMode } from '@/lib/chatPrefs'
import UserName from '@/components/UserName'
import FeeSheet from '@/components/FeeSheet'
import FuelSheet from '@/components/FuelSheet'
import AutoTradeSheet from '@/components/AutoTradeSheet'
import SolAutoTradeSheet from '@/components/SolAutoTradeSheet'
import { useFees } from '@/lib/fees'
import { errorText } from '@/lib/errors'
import { WEB_SURFACE } from '@/lib/surface'
import { disconnectWallet } from '@/desktop/walletGate'
import { replaceRoute, routeQuery } from '@/lib/route'

/** Mnemonic gets its own row; private keys all on one screen: one shared across EVM chains, one for Solana, one for Bitcoin (2026-09-28 goat: Bitcoin no longer separate) */
type Reveal = 'mnemonic' | 'keys'
type Sub = 'theme' | 'lang' | 'backup' | 'about' | 'receive' | 'profile' | 'slippage' | 'rpc' | 'autolock' | 'biometric' | 'notify' | 'chatHistory' | 'meetSessions' | 'licenses' | 'fees' | 'fuel' | 'autoTrade' | 'solAutoTrade' | 'blocks' | 'deleteAccount' | null

export default function Settings() {
  const fees = useFees((s) => s.fees)
  const autoRefuel = useSettings((s) => s.autoRefuel)
  const nav = useNavigate()
  const { vault, address, evmAddress, lock, reset, revealMnemonic, revealSecret, revealEvmKey, revealBtcWif, enableBiometric, disableBiometric } = useWallet()
  const { slippageBps, setSlippageBps, backedUp, setBackedUp, autoLockMs, setAutoLockMs } = useSettings()
  const { me, status, chatMode, setChatMode, needTerms } = useSocial()
  // Community account address (2026-10-04 review: previously used the wallet's Solana address as "me"; external wallets like MetaMask have no Solana address, so tapping avatar/follow counts did nothing)
  const myId = me?.address || address
  const [modeBusy, setModeBusy] = useState(false)
  const { wallet } = useGiftWallet()
  const [sub, setSub] = useState<Sub>(null)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  // Settings group panel (2026-09-28 goat regroup): only truly related items with more than one entry get grouped (Security, Trading); opening a sub-setting collapses the panel first — no stacked modals
  const [panel, setPanel] = useState<'security' | 'trade' | null>(null)
  useEffect(() => { if (sub) setPanel(null) }, [sub])
  // Tapping the "new computer logged into your account" notification (/settings?open=pc): opens "Logged-in computers" directly
  const [params, setParams] = useSearchParams()
  // ?open=fuel / ?open=backup: the Home fuel reminder ("top up") and backup-mnemonic reminder open the matching setting directly (2026-10-04 review: previously only landed on top of the "Me" page and you had to find it yourself)
  useEffect(() => {
    const o = params.get('open')
    const to = ({ pc: 'meetSessions', fuel: 'fuel', backup: 'backup' } as const)[o as 'pc' | 'fuel' | 'backup']
    if (!to) return
    setSub(to)
    params.delete('open'); setParams(params, { replace: true })
  }, [params, setParams])
  // Unexpected-reload log only shows in diagnostic builds (VITE_DIAG=1) (2026-09-29 goat: no debug logs in the user UI); always empty in production builds
  const [reloads, setReloads] = useState(() => (SHOW_RELOADS ? reloadEvents() : []))
  const { setting: langSetting, setLang } = useLang()
  const { setting: themeSetting, setTheme } = useTheme()
  const [pw, setPw] = useState('')
  const [secretText, setSecretText] = useState<string | null>(null)
  const [keys, setKeys] = useState<{ evm: string | null; sol: string; btc: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [slipDraft, setSlipDraft] = useState(String(slippageBps / 100))
  const [xBusy, setXBusy] = useState(false)
  const [xConfigured, setXConfigured] = useState<boolean | null>(null)
  const [social, setSocial] = useState<{ followers: number; following: number; posts: number } | null>(null)
  const [socialFailed, setSocialFailed] = useState(false)
  const [socialRetry, setSocialRetry] = useState(0)
  const [bio, setBio] = useState<BiometricStatus | null>(null)
  const [bioPw, setBioPw] = useState('')
  const [bioBusy, setBioBusy] = useState(false)
  useEffect(() => { biometricStatus().then(setBio) }, [])
  const bioName = biometryWord(bio?.biometry ?? 'none') // Spacing around it decided per Chinese/English text
  const closeBio = () => { setSub(null); setBioPw('') }
  const turnOnBio = async () => {
    if (!bioPw || bioBusy) return
    setBioBusy(true)
    try {
      await enableBiometric(bioPw)
      setBio(await biometricStatus()); closeBio(); toast.success(t('已开启{name}解锁', { name: bioName }))
    } catch (e) { toast.error(errorText(e, t('开启失败'))) } finally { setBioBusy(false) }
  }
  const turnOffBio = async () => {
    setBioBusy(true)
    try { await disableBiometric(); setBio(await biometricStatus()); closeBio(); toast.success(t('已关闭{name}解锁', { name: bioName })) }
    finally { setBioBusy(false) }
  }

  useEffect(() => {
    setXConfigured(null)
    if (status !== 'ready') return
    let alive = true
    api<{ xConfigured: boolean }>('/api/me').then(r => { if (alive) setXConfigured(r.xConfigured) }).catch(() => {})
    return () => { alive = false }
  }, [status, socialRetry])
  useEffect(() => {
    setSocial(null); setSocialFailed(false)
    if (status !== 'ready' || !myId) return
    let alive = true
    api<{ followers: number; following: number; posts: number }>(`/api/users/${myId}/social`).then(r => { if (alive) setSocial(r) }).catch(() => { if (alive) setSocialFailed(true) })
    return () => { alive = false }
  }, [status, myId, socialRetry])
  // After X authorization, redirects back from the api domain carrying ?x=linked|failed|expired
  useEffect(() => {
    const show = (r: XAuthResult) => {
      setXBusy(false)
      toast[r.x === 'linked' ? 'success' : 'error'](
        r.x === 'linked' ? t('X 账号已绑定')
          : r.reason ? t('X 绑定失败：{reason}', { reason: r.reason })
          : r.x === 'expired' ? t('X 授权已过期，请重试') : t('X 绑定失败'))
      useSocial.getState().refreshMe().then(() => {
        // Binding result reflects on the badge next to the nickname immediately — no waiting for the next batch query
        const me = useSocial.getState().me
        // Profile card details come from the server; placeholder by binding state here, batch-refreshed on page entry
        if (me) useXHandles.getState().set(me.address, me.xHandle ? { handle: me.xHandle, name: null, avatar: null, banner: null, bio: null, verified: false, joined: null, followers: null, following: null } : null)
      })
    }
    // 1. Result posted back after authorization completes in the new window
    const off = onXAuthResult(show)
    // 2. App deep-link return, or full-page redirect when the popup was blocked — result is in the URL
    const q = routeQuery()
    const x = q.get('x')
    if (x) { show({ x, reason: q.get('reason') }); replaceRoute('/settings') }
    return off
  }, [])

  const linkX = async () => {
    setXBusy(true)
    try {
      const r = await api<{ url: string }>(isNative ? '/api/x/start?native=1' : '/api/x/start')
      // App: system browser overlays on top, deep-link back after authorization; Web: opens a new window, original page doesn't refresh, wallet stays unlocked
      if (isNative) { await openExternal(r.url, { holdUnlock: true }); setXBusy(false) } else if (!openXAuthWindow(r.url)) return
      window.setTimeout(() => setXBusy(false), 2000)
    } catch (e) { toast.error(errorText(e, t('失败'))); setXBusy(false) }
  }
  const unlinkX = async () => { if (!confirm(t('解绑 X 账号？'))) return; try { await api('/api/me/x', { method: 'DELETE' }); await useSocial.getState().refreshMe(); if (address) useXHandles.getState().set(address, null); toast.success(t('已解绑')) } catch (e) { toast.error(errorText(e, t('失败'))) } }
  const doReveal = async () => {
    setBusy(true)
    try {
      if (reveal === 'keys') {
        // Fetch Solana first (wrong password throws here), then EVM; old wallets imported by private key alone may lack an EVM key
        const sol = await revealSecret(pw)
        const evm = vault?.evmSecret ? await revealEvmKey(pw) : null
        // Fetch Bitcoin too; if unavailable (old wallet lacks a Bitcoin key), hide that section — the other two are unaffected
        const btc = await revealBtcWif(pw).catch(() => null)
        setKeys({ evm, sol, btc })
      } else {
        const text = await revealMnemonic(pw)
        if (!text) throw new Error(t('该钱包没有助记词（通过私钥导入）'))
        setSecretText(text)
        setBackedUp(true) // Viewing the mnemonic counts as backed up
      }
    } catch (e) { toast.error(errorText(e, t('失败'))) } finally { setBusy(false) }
  }
  // Message retention mode: switching to device-only / daily-clear requires confirmation — deleted history is unrecoverable
  const pickChatMode = async (mode: ChatMode) => {
    if (mode === chatMode || modeBusy) return
    const warn = mode === 'device'
      ? t('云端的私信记录会先保存到这台手机，再从云端删除。换手机或删除 App 后无法恢复。确定切换？')
      : mode === 'daily'
        ? t('每天当地时间 00:00，清空你在云端和本机的私信记录，群消息对你隐藏。清空后无法恢复。确定切换？')
        : null
    if (warn && !confirm(warn)) return
    setModeBusy(true)
    try {
      await setChatMode(mode)
      setSub(null)
      toast.success(mode === 'cloud' && chatMode === 'device' ? t('之后的消息会加密保存在云端') : t('已保存'))
    } catch (e) { toast.error(errorText(e, t('失败'))) } finally { setModeBusy(false) }
  }
  const closeReveal = () => { setReveal(null); setPw(''); setSecretText(null); setKeys(null) }
  const needBackup = !!vault?.mnemonic && !backedUp

  return (
    <div className="safe-top pb-6">
      <header className="page-header page-gutter"><h1 className="page-title">{t('我')}</h1><div className="flex items-center gap-1">{/* QR login to desktop keeps only the Home entry point (2026-09-28 goat) */}<button onClick={() => setSub('profile')} disabled={status !== 'ready'} className="icon-button" aria-label={t('编辑资料')} data-tooltip={t('编辑资料')}><Pencil size={20} /></button></div></header>
      <section className="page-gutter pb-5" aria-label={t('个人资料')}>
        <div className="flex items-start gap-3">
          <button onClick={() => myId && nav(`/u/${myId}`)} aria-label={t('我的主页')}>
            <Avatar address={myId || 'anon'} src={me?.avatar} name={me?.nickname} size={56} chainId={me?.avatarNft?.chainId} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-xl font-semibold">{me ? <UserName size="lg" address={me.address} name={displayName(me)} /> : shortId(evmAddress || address || '')}</div>
              {me?.xHandle && <XBadge address={me.address} size={15} />}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {me?.handle ? <span>@{me.handle}</span> : <span>{shortId(evmAddress || address || '')}</span>}
              {me?.xHandle && <span className="max-w-full truncate">X @{me.xHandle}</span>}
            </div>
            {me?.bio && <div className="mt-1 line-clamp-2 text-xs text-muted">{me.bio}</div>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 divide-x divide-line text-center">
          {[['关注', social?.following], ['粉丝', social?.followers], ['帖子', social?.posts]].map(([k, v]) => (
            <button key={k as string} onClick={() => myId && nav(`/u/${myId}`)} className="min-h-12 leading-tight"><div className="number text-lg font-semibold">{v ?? '--'}</div><div className="mt-1 text-xs text-muted">{t(k as string)}</div></button>
          ))}
        </div>
        {(socialFailed || status !== 'ready') && <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted" role="status">{status !== 'ready' ? t('社交服务未连接') : t('关注和粉丝数暂时无法更新')}{socialFailed && <button className="icon-button" onClick={() => setSocialRetry(n => n + 1)} aria-label={t('重试社交数据')} data-tooltip={t('重试')}><RefreshCw size={16} /></button>}</div>}
      </section>

      {/* Not-backed-up reminder */}
      {needBackup && !WEB_SURFACE && (
        <button onClick={() => setReveal('mnemonic')} className="page-gutter flex w-full items-center gap-3 border-y border-warning/20 bg-warning/5 py-4 text-left">
          <AlertTriangle size={20} className="shrink-0 text-warning" /><span className="min-w-0 flex-1 text-sm"><span className="font-medium text-warning">{t('备份助记词')}</span><span className="mt-1 block text-xs text-muted">{t('尚未备份，丢失设备后将无法恢复钱包')}</span></span><ChevronRight size={16} className="shrink-0 text-muted" />
        </button>
      )}

      {/* On-site balance: USD balance on our servers (gifting, red packets, sprite subscriptions); tapping the card opens top-up / withdraw / history. Hidden in the mobile App (lib/features) */}
      {BALANCE_FEATURES && <div className="page-gutter">
        <button onClick={() => nav('/earnings')} className="glass-lite flex w-full items-center gap-4 rounded-[24px] px-5 py-4 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-muted">{t('站内余额')}</span>
            <span className="number mt-1 block break-all text-[26px] font-semibold">{status === 'ready' && wallet ? fmtUsd(wallet.balance) : '--'}</span>
            <span className="mt-1 block text-xs text-muted">{t('送礼 · 红包 · 小精灵订阅')}{wallet && wallet.earnings > 0 ? ` · ${t('可提现收入 {amount}', { amount: fmtUsd(wallet.earnings) })}` : ''}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-muted">{t('充值 / 提现')}<ChevronRight size={16} /></span>
        </button>
      </div>}

      {/* Settings (2026-09-28 goat regroup): previously 5 tiles two-per-row — "Privacy" and "Help" each held a single item while "Account & Security" and "Preferences" mixed unrelated ones.
          Now grouped by purpose into full-row lists: single items sit directly on the page; only truly related multi-item sets get grouped (Security, Trading) */}
      <div className="page-gutter mt-4 space-y-5">
        <SettingGroup title={t('钱包')}>
          {/* Web wallet lives in the 0x4 browser extension: no backup / export / reset (the extension never exports private keys, docs/EXTENSION_API.md) */}
          {!WEB_SURFACE && <SettingRow icon={<KeyRound size={16} />} tint="accent" tone={needBackup ? 'down' : undefined} label={t('备份与导出')} value={vault?.mnemonic ? (backedUp ? t('已备份') : t('未备份')) : undefined} onClick={() => setSub('backup')} />}
          {/* Web has no "Assets" tab (the mobile App's Home is assets): the "Me" page holds an entry instead (2026-10-07 goat, when adding bottom "Me") */}
          {WEB_SURFACE && <SettingRow icon={<Wallet size={16} />} tint="accent" label={t('我的资产')} onClick={() => nav('/portfolio')} />}
          <SettingRow icon={<ShieldCheck size={16} />} tint="up" label={t('安全')} onClick={() => setPanel('security')} />
          <SettingRow icon={<Bot size={16} />} tint="social" label={t('交易||settings')} value={fees.vip ? 'VIP' : undefined} onClick={() => setPanel('trade')} />
          {WEB_SURFACE ? <SettingRow icon={<Lock size={16} />} tint="muted" label={t('断开钱包')} chevron={false} onClick={() => { void disconnectWallet(); nav('/discover', { replace: true }) }} /> : <SettingRow icon={<Lock size={16} />} tint="muted" label={t('锁定钱包')} chevron={false} onClick={() => {
            lock()
            // Native App: social still browsable when locked, only money moves need re-auth; Web: locking returns to the unlock page
            if (persistentSession) toast.success(t('已锁定，转账和交易前需要重新验证'))
            else nav('/unlock', { replace: true })
          }} />}
        </SettingGroup>
        <SettingGroup title={t('社交')}>
          {needTerms && <SettingRow icon={<FileText size={16} />} tint="accent" label={t('启用社交功能')} value={t('需要同意条款')} onClick={() => useTermsGate.getState().show(true)} />}
          {me?.xHandle
            ? <SettingRow icon={<AtSign size={16} />} tint="fg" label={t('X 账号')} value={`@${me.xHandle}`} disabled={status !== 'ready'} onClick={unlinkX} />
            : <SettingRow icon={<AtSign size={16} />} tint="fg" label={t('绑定 X 账号')} value={status !== 'ready' ? t('未连接') : xBusy ? t('正在连接') : xConfigured === false ? t('暂不可用') : undefined} disabled={status !== 'ready' || xConfigured === false || xBusy} onClick={linkX} />}
          <SettingRow icon={<MessageSquareLock size={16} />} tint="accent" label={t('消息设定')} disabled={status !== 'ready'} onClick={() => setSub('chatHistory')} />
          <SettingRow icon={<Bell size={16} />} tint="warning" label={t('通知')} onClick={() => setSub('notify')} />
          <SettingRow icon={<Ban size={16} />} tint="muted" label={t('黑名单')} disabled={status !== 'ready'} onClick={() => setSub('blocks')} />
        </SettingGroup>
        <SettingGroup title={t('通用')}>
          <SettingRow icon={<SunMoon size={16} />} tint="social" label={t('外观')} value={t(THEME_OPTIONS.find((o) => o.value === themeSetting)?.label ?? '跟随系统')} onClick={() => setSub('theme')} />
          <SettingRow icon={<Languages size={16} />} tint="up" label="语言 / Language" value={langSetting === 'auto' ? t('跟随系统') : LANG_OPTIONS.find((o) => o.value === langSetting)?.label} onClick={() => setSub('lang')} />
        </SettingGroup>
        <SettingGroup title={t('支持')}>
          <SettingRow icon={<Headset size={16} />} tint="accent" label={t('帮助与客服')} disabled={status !== 'ready'} onClick={() => nav('/support')} />
          <SettingRow icon={<FileText size={16} />} tint="muted" label={t('关于')} value={SHOW_RELOADS && reloads.length ? t('{n} 条刷新记录', { n: reloads.length }) : undefined} onClick={() => setSub('about')} />
        </SettingGroup>
        {/* Delete account (2026-10-02 store requirement): deletes the 0x4 account (server-side profile and content), not the wallet */}
        <SettingGroup>
          <SettingRow icon={<UserX size={16} />} tint="down" tone="down" label={t('注销账号')} value={t('删除资料和内容')} disabled={status !== 'ready'} onClick={() => setSub('deleteAccount')} />
        </SettingGroup>
        {!WEB_SURFACE && <SettingGroup>
          <SettingRow icon={<Trash2 size={16} />} tint="down" tone="down" label={t('重置钱包')} value={t('删除本机数据')} onClick={() => {
            if (confirm(t('这会删除本机上的钱包数据。你确认已经备份助记词或私钥了吗？'))) { reset(); nav('/onboarding', { replace: true }) }
          }} />
        </SettingGroup>}
      </div>

      <Sheet open={panel === 'security'} onClose={() => setPanel(null)} title={t('安全')}>
        <div className="divide-y divide-line/60">
        {bio?.available && <Row icon={(bio.biometry === 'touchID' || bio.biometry === 'fingerprint' || bio.biometry === 'biometric') ? <Fingerprint size={18} /> : <ScanFace size={18} />} label={t('{name}解锁', { name: bioName }).trim()} value={bio.enabled ? t('已开启') : t('未开启')} onClick={() => setSub('biometric')} />}
        {/* Web has no auto-lock (keys live in the 0x4 extension, which locks itself); this item is hidden (2026-10-04 review) */}
        {!WEB_SURFACE && <Row icon={<Timer size={18} />} label={t('自动锁定')} value={t(AUTO_LOCK_OPTIONS.find((o) => o.value === autoLockMs)?.label ?? '5 分钟')} onClick={() => setSub('autolock')} />}
        <Row icon={<Laptop size={18} />} label={t('已登录的电脑')} disabled={status !== 'ready'} onClick={() => setSub('meetSessions')} />
        <Row icon={<ShieldCheck size={18} />} label={t('管理授权')} onClick={() => nav('/approvals')} />
        </div>
      </Sheet>
      <Sheet open={panel === 'trade'} onClose={() => setPanel(null)} title={t('交易||settings')}>
        <div className="divide-y divide-line/60">
        {/* Auto-trading is account-level: this entry doesn't depend on any sprite — on-chain permissions can be revoked here even when the server is unreachable (round 6 #15) */}
        <Row icon={<Bot size={18} />} label={t('全自动交易（BNB Chain）')} onClick={() => setSub('autoTrade')} />
        <Row icon={<Bot size={18} />} label={t('全自动交易（Solana）')} onClick={() => setSub('solAutoTrade')} />
        <Row icon={<SlidersHorizontal size={18} />} label={t('滑点上限')} value={`${slippageBps / 100}%`} onClick={() => { setSlipDraft(String(slippageBps / 100)); setSub('slippage') }} />
        <Row icon={<Fuel size={18} />} label={t('燃料费')} value={autoRefuel ? t('自动补充') : undefined} disabled={status !== 'ready'} onClick={() => setSub('fuel')} />
        <Row icon={<Crown size={18} />} label={t('账户种类')} value={fees.vip ? 'VIP' : t('普通')} disabled={status !== 'ready'} onClick={() => setSub('fees')} />
        </div>
      </Sheet>

      <p className="mt-6 px-5 text-center text-xs text-muted">0x4 Wallet v0.1.0</p>

      <ReceiveSheet open={sub === 'receive'} onClose={() => setSub(null)} address={address} evmAddress={evmAddress} />
      <ProfileSheet open={sub === 'profile'} onClose={() => setSub(null)} />
      <NotificationSheet open={sub === 'notify'} onClose={() => setSub(null)} />
      <MeetSessionsSheet open={sub === 'meetSessions'} onClose={() => setSub(null)} />
      <FeeSheet open={sub === 'fees'} onClose={() => setSub(null)} />
      <FuelSheet open={sub === 'fuel'} onClose={() => setSub(null)} />
      <AutoTradeSheet open={sub === 'autoTrade'} onClose={() => setSub(null)} />
      <SolAutoTradeSheet open={sub === 'solAutoTrade'} onClose={() => setSub(null)} />
      <BlocksSheet open={sub === 'blocks'} onClose={() => setSub(null)} />
      <AccountDeleteSheet open={sub === 'deleteAccount'} onClose={() => setSub(null)} />

      <Sheet open={sub === 'about'} onClose={() => setSub(null)} title={t('关于')}>
        <div className="space-y-5 text-sm leading-relaxed">
          <div className="text-center"><div className="text-base font-semibold">0x4 Wallet</div><div className="mt-0.5 text-xs text-muted">v0.1.0</div></div>
          <section>
            <h3 className="ui-label">{t('法律文件')}</h3>
            <div className="divide-y divide-line overflow-hidden rounded-xl bg-card2">
              {LEGAL_LINKS.map((l) => (
                <button key={l.key} type="button" onClick={() => { void openExternal(legalUrl(l.url)) }} className="flex min-h-11 w-full items-center justify-between px-3 text-left">
                  <span>{t(l.label)}</span><ChevronRight size={15} className="text-muted" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
          {/* TradingView Lightweight Charts license (Apache 2.0 + NOTICE) requires attribution with a link to tradingview.com in the App; the on-chart logo is off, attribution lives here */}
          <section>
            <h3 className="ui-label">{t('开源许可')}</h3>
            <p>{t('K 线图使用 TradingView Lightweight Charts™。')}</p>
            <p className="mt-1 text-xs text-muted">Copyright (c) 2025 TradingView, Inc. · Apache License 2.0</p>
            <p className="mt-1 break-all text-xs text-accent">https://www.tradingview.com/</p>
          </section>
          {/* Unexpected-reload log: recorded when the App is killed in the foreground and auto-reloads (lib/reloadWatch), for cause lookup; only shown in diagnostic builds */}
          {SHOW_RELOADS && reloads.length > 0 && (
            <section>
              <div className="flex items-center justify-between"><h3 className="ui-label mb-0">{t('意外刷新记录')}</h3><button onClick={() => { clearReloadEvents(); setReloads([]) }} className="text-xs text-accent">{t('清除')}</button></div>
              {reloads.slice(0, 5).map((r) => <div key={r.at} className="number mt-1 text-xs text-muted">{new Date(r.at).toLocaleString(locale())} · {r.route}</div>)}
            </section>
          )}
        </div>
      </Sheet>

      <Sheet open={sub === 'slippage'} onClose={() => setSub(null)} title={t('滑点上限')}>
        {/* Tapping a preset only selects and fills the input — "Save" applies and closes (2026-09-26 goat: previously auto-saved and returned on tap) */}
        <p className="text-sm text-muted">{t('价格偏差超过上限就取消交易。')}</p>
        <div className="mt-4 grid grid-cols-4 gap-2" role="group" aria-label={t('滑点预设')}>
          {[0.5, 1, 3, 5].map((v) => (
            <button key={v} aria-pressed={Number(slipDraft) === v} onClick={() => setSlipDraft(String(v))} className={`min-h-11 rounded-lg py-2.5 text-sm font-semibold ${Number(slipDraft) === v ? 'bg-accent text-bg' : 'bg-card2'}`}>{v}%</button>
          ))}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1"><Label htmlFor="slippage-value">{t('自定义（%）')}</Label><Input id="slippage-value" type="number" inputMode="decimal" value={slipDraft} onChange={(e) => setSlipDraft(e.target.value)} /></div>
          <Button onClick={() => { const v = Number(slipDraft); if (!(v > 0 && v <= 50)) return toast.error(t('范围 0.1% ~ 50%')); setSlippageBps(v * 100); setSub(null); toast.success(t('滑点上限 {v}%', { v })) }}>{t('保存')}</Button>
        </div>
      </Sheet>

      <Sheet open={sub === 'chatHistory'} onClose={() => setSub(null)} title={t('消息设定')}>
        <div className="divide-y divide-line/60 border-y border-line/60" role="radiogroup" aria-label={t('消息设定')}>
          {CHAT_MODE_OPTIONS.map((o) => (
            <button key={o.value} role="radio" aria-checked={chatMode === o.value} disabled={modeBusy} onClick={() => void pickChatMode(o.value)} className="flex min-h-15 w-full items-center gap-3 py-3 text-left disabled:opacity-60">
              <span className="min-w-0 flex-1"><span className="block text-[15px]">{t(o.label)}</span><span className="mt-0.5 block text-xs text-muted">{t(o.note)}</span></span>
              {chatMode === o.value && <Check size={18} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t('群聊记录属于整个群，这里只影响你自己看到的内容。')}</p>
      </Sheet>

      <Sheet open={sub === 'autolock'} onClose={() => setSub(null)} title={t('自动锁定')}>
        <p className="text-sm text-muted">{t('闲置或切到后台超过设定时间后自动锁定，再次使用需要输入密码。')}</p>
        <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label={t('自动锁定时间')}>
          {AUTO_LOCK_OPTIONS.map((o) => (
            <button
              key={o.value}
              aria-pressed={autoLockMs === o.value}
              onClick={() => { setAutoLockMs(o.value); setSub(null); toast.success(o.value < 0 ? t('已关闭自动锁定') : t('自动锁定 {time}', { time: t(o.label) })) }}
              className={`min-h-11 rounded-lg px-2 py-2.5 text-sm font-semibold ${autoLockMs === o.value ? 'bg-accent text-bg' : 'bg-card2'}`}
            >{t(o.label)}</button>
          ))}
        </div>
        {autoLockMs < 0 && <p className="mt-3 text-sm text-warning">{t('自动锁定已关闭，离开设备前请手动锁定钱包。')}</p>}
      </Sheet>

      <Sheet open={sub === 'biometric'} onClose={closeBio} title={t('{name}解锁', { name: bioName }).trim()}>
        {bio?.enabled ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t('解锁钱包时可以用{name}代替密码。查看助记词、导出私钥仍然需要输入密码。', { name: bioName })}</p>
            <Button variant="danger" className="w-full" loading={bioBusy} onClick={turnOffBio}>{t('关闭{name}解锁', { name: bioName })}</Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); turnOnBio() }}>
            <p className="text-sm text-muted">{t('开启后，密码会加密保存在本机{store}，只有通过{name}验证才能取用，不会上传。手机里新增{bio}后需要重新开启。', { store: platform === 'android' ? t('系统密钥库') : t('系统钥匙串'), name: bioName, bio: bio?.biometry === 'faceID' ? t('面容') : bio?.biometry === 'biometric' ? t('生物特征') : t('指纹') })}</p>
            <Label htmlFor="bio-password">{t('输入钱包密码以开启')}</Label>
            <Input id="bio-password" type="password" value={bioPw} onChange={(e) => setBioPw(e.target.value)} autoComplete="current-password" />
            <Button type="submit" className="w-full" loading={bioBusy} disabled={!bioPw}>{t('开启')}</Button>
          </form>
        )}
      </Sheet>


      <Sheet open={sub === 'theme'} onClose={() => setSub(null)} title={t('外观')}>
        <div className="divide-y divide-line/60 border-y border-line/60">
          {THEME_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => { setSub(null); setTheme(o.value) }} aria-pressed={themeSetting === o.value} className="flex min-h-14 w-full items-center justify-between text-left text-[15px]">
              {t(o.label)}{themeSetting === o.value && <Check size={18} className="text-accent" />}
            </button>
          ))}
        </div>
      </Sheet>

      {/* Language options are written in their own languages — Chinese (Simplified), Chinese (Traditional), English — never translated, so everyone recognizes their own */}
      <Sheet open={sub === 'lang'} onClose={() => setSub(null)} title="语言 / Language">
        <div className="divide-y divide-line/60 border-y border-line/60">
          {LANG_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => { setSub(null); setLang(o.value) }} aria-pressed={langSetting === o.value} className="flex min-h-14 w-full items-center justify-between text-left text-[15px]">
              {o.value === 'auto' ? '跟随系统 / System' : o.label}{langSetting === o.value && <Check size={18} className="text-accent" />}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sub === 'backup'} onClose={() => setSub(null)} title={t('备份与导出')}>
        <p className="text-sm text-muted">{t('助记词能恢复整个钱包，优先备份它。私钥只在要把钱包导入别的 App 时用。')}</p>
        <div className="mt-3 divide-y divide-line/60 border-y border-line/60">
          {vault?.mnemonic && <Row icon={<KeyRound size={18} />} label={t('查看助记词')} value={backedUp ? t('已备份') : t('未备份')} onClick={() => { setSub(null); setReveal('mnemonic') }} />}
          <Row icon={<FileKey2 size={18} />} label={t('导出私钥')} value={t('EVM · Solana · 比特币')} onClick={() => { setSub(null); setReveal('keys') }} />
        </div>
      </Sheet>

      <Sheet open={!!reveal} onClose={closeReveal} title={reveal === 'mnemonic' ? t('助记词') : t('私钥')}>
        {keys ? (
          <div>
            <div className="rounded-lg bg-down/10 px-3 py-3 text-sm text-down">{t('私钥可控制全部资产，请勿截图或发送给他人。')}</div>
            {/* One key shared across all EVM chains, one for Solana, one for Bitcoin (different algorithms/formats — can't merge into one).
                Wallets imported by private key (no mnemonic): the Bitcoin key is the EVM one in WIF format — say so plainly, don't write "Bitcoin only" (GPT review, low priority) */}
            {keys.evm && <KeyBlock title={t('EVM 私钥')} note={t('适用于 BNB Chain、Ethereum、Base、Arbitrum 等 EVM 网络')} value={keys.evm} />}
            <KeyBlock title={t('Solana 私钥')} note={t('仅适用于 Solana 网络')} value={keys.sol} />
            {keys.btc && <>
              <KeyBlock title={t('比特币私钥（WIF）')} note={!vault?.mnemonic && keys.evm ? t('与 EVM 私钥相同，仅格式不同') : t('仅适用于比特币网络')} value={keys.btc} />
              <p className="mt-2 text-xs text-muted">{t('导入其他比特币钱包时，请在私钥前加上 p2wpkh:，才能得到本钱包的 bc1q 地址。')}</p>
            </>}
          </div>
        ) : secretText ? (
          <div>
            <div className="rounded-lg bg-down/10 px-3 py-3 text-sm text-down">{t('这段内容可控制全部资产，请勿截图或发送给他人。')}</div>
            <div className="mt-3 break-all rounded-lg bg-card2 p-4 font-mono text-sm leading-relaxed">{secretText}</div>
            <Button className="mt-4 w-full" variant="secondary" onClick={() => copyText(secretText).then(() => toast.success(t('已复制')))}><Copy size={16} /> {t('复制')}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="reveal-password">{t('输入密码以确认身份')}</Label>
            <Input id="reveal-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" />
            <Button className="w-full" loading={busy} disabled={!pw} onClick={doReveal}>{t('显示')}</Button>
          </div>
        )}
      </Sheet>
    </div>
  )
}

/** One private key: title, applicable chains, value with copy button */
function KeyBlock({ title, note, value }: { title: string; note: string; value: string }) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-semibold">{title}</span><span className="text-xs text-muted">{note}</span></div>
      <div className="mt-2 break-all rounded-lg bg-card2 p-4 font-mono text-sm leading-relaxed">{value}</div>
      <Button className="mt-2 w-full" variant="secondary" onClick={() => copyText(value).then(() => toast.success(t('已复制')))}><Copy size={16} /> {t('复制')}</Button>
    </div>
  )
}

const TINT: Record<string, string> = {
  accent: 'bg-accent/15 text-accent', up: 'bg-up/15 text-up', social: 'bg-social/20 text-social', warning: 'bg-warning/15 text-warning',
  down: 'bg-down/15 text-down', muted: 'bg-card2 text-muted', fg: 'bg-card2 text-fg',
}

/** One settings section: subtitle + rounded card, hairline dividers between rows */
function SettingGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      {title && <h2 className="mb-2 px-1 text-xs font-medium tracking-wide text-muted">{title}</h2>}
      <div className="overflow-hidden rounded-[20px] border border-line/60 bg-card divide-y divide-line/50">{children}</div>
    </section>
  )
}

/** Full-row setting: tinted icon on the left, current value and chevron on the right; sub describes what's inside (group entries only) */
function SettingRow({ icon, tint, label, sub, value, onClick, tone, disabled, chevron = true }: { icon: React.ReactNode; tint: keyof typeof TINT; label: string; sub?: string; value?: string; onClick: () => void; tone?: 'down'; disabled?: boolean; chevron?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-card2 disabled:opacity-50">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${TINT[tint]}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] ${tone === 'down' ? 'text-down' : ''}`}>{label}</span>
        {sub && <span className="mt-0.5 block truncate text-xs text-muted">{sub}</span>}
      </span>
      {value && <span className={`max-w-[45%] shrink-0 truncate text-[13px] ${tone === 'down' ? 'text-down' : 'text-muted'}`}>{value}</span>}
      {chevron && <ChevronRight size={16} className="shrink-0 text-muted/70" />}
    </button>
  )
}

/** Setting row with no extra panel; long values get their own line, keeping full touch targets on narrow screens. */
function Row({ icon, label, value, onClick, tone, disabled }: { icon: React.ReactNode; label: string; value?: string; onClick: () => void; tone?: 'down'; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex min-h-15 w-full items-center gap-3 py-3 text-left text-[15px] active:bg-card disabled:opacity-50 ${tone === 'down' ? 'text-down' : ''}`}>
      <span className={`flex w-6 shrink-0 items-center justify-center ${tone === 'down' ? 'text-down' : 'text-muted'}`}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1"><span>{label}</span>{value && <span className="max-w-full break-all text-[13px] text-muted">{value}</span>}</span>
      <ChevronRight size={16} className="shrink-0 text-muted" />
    </button>
  )
}
