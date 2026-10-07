// 「我」页：身份、站内余额与分组列表。
// 2026-09-25 按 goat 要求精简：删掉与首页重复的入口（交易记录 / 收款地址 / 收入与提现），
// 藏起还没上线的「我的奖励」和「重看新手引导」；三行私钥导出合成「备份与导出」；
// 普通用户不碰的（代币授权 / 重置钱包）收进默认折叠的「高级」。Solana 节点设置已去掉（2026-09-25 goat），一律用我们的默认节点
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

/** 助记词单独一项；私钥一页全部显示：EVM 链共用一把、Solana 一把、比特币一把（2026-09-28 goat：比特币不再单独一项） */
type Reveal = 'mnemonic' | 'keys'
type Sub = 'theme' | 'lang' | 'backup' | 'about' | 'receive' | 'profile' | 'slippage' | 'rpc' | 'autolock' | 'biometric' | 'notify' | 'chatHistory' | 'meetSessions' | 'licenses' | 'fees' | 'fuel' | 'autoTrade' | 'solAutoTrade' | 'blocks' | 'deleteAccount' | null

export default function Settings() {
  const fees = useFees((s) => s.fees)
  const autoRefuel = useSettings((s) => s.autoRefuel)
  const nav = useNavigate()
  const { vault, address, evmAddress, lock, reset, revealMnemonic, revealSecret, revealEvmKey, revealBtcWif, enableBiometric, disableBiometric } = useWallet()
  const { slippageBps, setSlippageBps, backedUp, setBackedUp, autoLockMs, setAutoLockMs } = useSettings()
  const { me, status, chatMode, setChatMode, needTerms } = useSocial()
  // 社区账号地址（2026-10-04 走查：以前用钱包的 Solana 地址当「我」，MetaMask 这类外部钱包没有 Solana 地址，点头像、关注数都没反应）
  const myId = me?.address || address
  const [modeBusy, setModeBusy] = useState(false)
  const { wallet } = useGiftWallet()
  const [sub, setSub] = useState<Sub>(null)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  // 设置分组面板（2026-09-28 goat 重排）：只有真正同类、而且不止一项的才收成一组（安全、交易）；打开某个子设置时先收起面板，不叠两层弹层
  const [panel, setPanel] = useState<'security' | 'trade' | null>(null)
  useEffect(() => { if (sub) setPanel(null) }, [sub])
  // 「新电脑登录了你的账号」通知点进来（/settings?open=pc）：直接打开「已登录的电脑」
  const [params, setParams] = useSearchParams()
  // ?open=fuel / ?open=backup：首页燃料费提醒「去补充」、备份助记词提醒直接打开对应设置（2026-10-04 走查：以前只跳到「我」页顶上，要自己找）
  useEffect(() => {
    const o = params.get('open')
    const to = ({ pc: 'meetSessions', fuel: 'fuel', backup: 'backup' } as const)[o as 'pc' | 'fuel' | 'backup']
    if (!to) return
    setSub(to)
    params.delete('open'); setParams(params, { replace: true })
  }, [params, setParams])
  // 意外刷新记录只在诊断构建（VITE_DIAG=1）里显示（2026-09-29 goat：用户界面里不该出现调试记录）；正式构建恒为空
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
  const bioName = biometryWord(bio?.biometry ?? 'none') // 已按中英文决定两边空格
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
  // X 授权完成后从 api 域名跳回来，带着 ?x=linked|failed|expired
  useEffect(() => {
    const show = (r: XAuthResult) => {
      setXBusy(false)
      toast[r.x === 'linked' ? 'success' : 'error'](
        r.x === 'linked' ? t('X 账号已绑定')
          : r.reason ? t('X 绑定失败：{reason}', { reason: r.reason })
          : r.x === 'expired' ? t('X 授权已过期，请重试') : t('X 绑定失败'))
      useSocial.getState().refreshMe().then(() => {
        // 绑定结果立刻反映到昵称旁的标记，不用等下一次批量查询
        const me = useSocial.getState().me
        // 资料卡的详细字段由服务端返回，这里先按有没有绑定占位，进页面时会批量刷新
        if (me) useXHandles.getState().set(me.address, me.xHandle ? { handle: me.xHandle, name: null, avatar: null, banner: null, bio: null, verified: false, joined: null, followers: null, following: null } : null)
      })
    }
    // ① 新窗口授权完成后发回来的结果
    const off = onXAuthResult(show)
    // ② App 深链跳回，或弹窗被拦退回整页跳转时，结果在地址里
    const q = routeQuery()
    const x = q.get('x')
    if (x) { show({ x, reason: q.get('reason') }); replaceRoute('/settings') }
    return off
  }, [])

  const linkX = async () => {
    setXBusy(true)
    try {
      const r = await api<{ url: string }>(isNative ? '/api/x/start?native=1' : '/api/x/start')
      // App：系统浏览器叠在上面，授权完走深链跳回；网页：开新窗口，原页面不刷新，钱包就不会被锁
      if (isNative) { await openExternal(r.url, { holdUnlock: true }); setXBusy(false) } else if (!openXAuthWindow(r.url)) return
      window.setTimeout(() => setXBusy(false), 2000)
    } catch (e) { toast.error(errorText(e, t('失败'))); setXBusy(false) }
  }
  const unlinkX = async () => { if (!confirm(t('解绑 X 账号？'))) return; try { await api('/api/me/x', { method: 'DELETE' }); await useSocial.getState().refreshMe(); if (address) useXHandles.getState().set(address, null); toast.success(t('已解绑')) } catch (e) { toast.error(errorText(e, t('失败'))) } }
  const doReveal = async () => {
    setBusy(true)
    try {
      if (reveal === 'keys') {
        // 先取 Solana（密码错会在这里抛出），再取 EVM；只用私钥导入的老钱包可能没有 EVM 私钥
        const sol = await revealSecret(pw)
        const evm = vault?.evmSecret ? await revealEvmKey(pw) : null
        // 比特币一起取；取不到（老钱包没有比特币密钥）就不显示这一块，不影响另外两把
        const btc = await revealBtcWif(pw).catch(() => null)
        setKeys({ evm, sol, btc })
      } else {
        const text = await revealMnemonic(pw)
        if (!text) throw new Error(t('该钱包没有助记词（通过私钥导入）'))
        setSecretText(text)
        setBackedUp(true) // 看过助记词即视为已备份
      }
    } catch (e) { toast.error(errorText(e, t('失败'))) } finally { setBusy(false) }
  }
  // 消息记录模式：切到只存在手机 / 每天清空前二次确认，记录删了找不回来
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
      <header className="page-header page-gutter"><h1 className="page-title">{t('我')}</h1><div className="flex items-center gap-1">{/* 扫码登录电脑端只留首页一个入口（2026-09-28 goat） */}<button onClick={() => setSub('profile')} disabled={status !== 'ready'} className="icon-button" aria-label={t('编辑资料')} data-tooltip={t('编辑资料')}><Pencil size={20} /></button></div></header>
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

      {/* 未备份提醒 */}
      {needBackup && !WEB_SURFACE && (
        <button onClick={() => setReveal('mnemonic')} className="page-gutter flex w-full items-center gap-3 border-y border-warning/20 bg-warning/5 py-4 text-left">
          <AlertTriangle size={20} className="shrink-0 text-warning" /><span className="min-w-0 flex-1 text-sm"><span className="font-medium text-warning">{t('备份助记词')}</span><span className="mt-1 block text-xs text-muted">{t('尚未备份，丢失设备后将无法恢复钱包')}</span></span><ChevronRight size={16} className="shrink-0 text-muted" />
        </button>
      )}

      {/* 站内余额：记在我们服务器上的美元余额（送礼、发红包、订阅果蝇用），整张卡点进去充值 / 提现 / 看记录。手机 App 里不显示（lib/features） */}
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

      {/* 设置（2026-09-28 goat 重排）：原来 5 个方块两个一排，「隐私」「帮助」点开只有一项，「账号与安全」「偏好」里又混着不相干的东西。
          现在按用途分成几段整行列表：只有一项的直接放在页面上点了就到；真正同类、不止一项的才收进一组（安全、交易） */}
      <div className="page-gutter mt-4 space-y-5">
        <SettingGroup title={t('钱包')}>
          {/* 网页版钱包在 0x4 浏览器插件里：不做备份 / 导出 / 重置（插件永远不导出私钥，docs/EXTENSION_API.md） */}
          {!WEB_SURFACE && <SettingRow icon={<KeyRound size={16} />} tint="accent" tone={needBackup ? 'down' : undefined} label={t('备份与导出')} value={vault?.mnemonic ? (backedUp ? t('已备份') : t('未备份')) : undefined} onClick={() => setSub('backup')} />}
          {/* 网页版没有「资产」标签（手机 App 的首页就是资产）：「我」页里放一个入口（2026-10-07 goat 加底部「我」时） */}
          {WEB_SURFACE && <SettingRow icon={<Wallet size={16} />} tint="accent" label={t('我的资产')} onClick={() => nav('/portfolio')} />}
          <SettingRow icon={<ShieldCheck size={16} />} tint="up" label={t('安全')} onClick={() => setPanel('security')} />
          <SettingRow icon={<Bot size={16} />} tint="social" label={t('交易||settings')} value={fees.vip ? 'VIP' : undefined} onClick={() => setPanel('trade')} />
          {WEB_SURFACE ? <SettingRow icon={<Lock size={16} />} tint="muted" label={t('断开钱包')} chevron={false} onClick={() => { void disconnectWallet(); nav('/discover', { replace: true }) }} /> : <SettingRow icon={<Lock size={16} />} tint="muted" label={t('锁定钱包')} chevron={false} onClick={() => {
            lock()
            // 原生 App 锁定后照样能刷社交，只是动钱要重新验证；网页版锁定即回解锁页
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
        {/* 注销账号（2026-10-02 上架要求）：删的是 0x4 账号（服务器上的资料和内容），不是钱包 */}
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
        {/* 网页版不做自动锁定（钥匙在 0x4 插件里，插件自己锁），这一项不显示（2026-10-04 走查） */}
        {!WEB_SURFACE && <Row icon={<Timer size={18} />} label={t('自动锁定')} value={t(AUTO_LOCK_OPTIONS.find((o) => o.value === autoLockMs)?.label ?? '5 分钟')} onClick={() => setSub('autolock')} />}
        <Row icon={<Laptop size={18} />} label={t('已登录的电脑')} disabled={status !== 'ready'} onClick={() => setSub('meetSessions')} />
        <Row icon={<ShieldCheck size={18} />} label={t('管理授权')} onClick={() => nav('/approvals')} />
        </div>
      </Sheet>
      <Sheet open={panel === 'trade'} onClose={() => setPanel(null)} title={t('交易||settings')}>
        <div className="divide-y divide-line/60">
        {/* 全自动交易是账户级的：这里的入口不依赖任何小精灵，服务器不通时也能进去撤销链上权限（第六轮 #15） */}
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
          {/* TradingView Lightweight Charts 的许可（Apache 2.0 + NOTICE）要求在 App 里注明出处并链接 tradingview.com；图上的标志关掉了，出处放这里 */}
          <section>
            <h3 className="ui-label">{t('开源许可')}</h3>
            <p>{t('K 线图使用 TradingView Lightweight Charts™。')}</p>
            <p className="mt-1 text-xs text-muted">Copyright (c) 2025 TradingView, Inc. · Apache License 2.0</p>
            <p className="mt-1 break-all text-xs text-accent">https://www.tradingview.com/</p>
          </section>
          {/* 意外刷新记录：App 在前台被系统杀掉后自动重载时记一条（lib/reloadWatch），方便对照查原因；只在诊断构建里显示 */}
          {SHOW_RELOADS && reloads.length > 0 && (
            <section>
              <div className="flex items-center justify-between"><h3 className="ui-label mb-0">{t('意外刷新记录')}</h3><button onClick={() => { clearReloadEvents(); setReloads([]) }} className="text-xs text-accent">{t('清除')}</button></div>
              {reloads.slice(0, 5).map((r) => <div key={r.at} className="number mt-1 text-xs text-muted">{new Date(r.at).toLocaleString(locale())} · {r.route}</div>)}
            </section>
          )}
        </div>
      </Sheet>

      <Sheet open={sub === 'slippage'} onClose={() => setSub(null)} title={t('滑点上限')}>
        {/* 点预设只是选中并填进输入框，点「保存」才生效、才关闭（2026-09-26 goat：原来一点就自动保存并返回） */}
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

      {/* 语言选项用各自语言写（简体中文 / 繁體中文 / English），不翻译，谁都认得出自己的语言 */}
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
            {/* 所有 EVM 链共用一把，Solana 一把，比特币一把（算法 / 格式不同，没法合成一把）。
                用私钥导入的钱包（没有助记词）：比特币私钥就是 EVM 那把换成 WIF 格式，要说清楚，别写「只用于比特币」（GPT 审查低优先项） */}
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

/** 一把私钥：标题、适用的链、内容与复制按钮 */
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

/** 一段设置：小标题 + 圆角卡片，行之间细分隔线 */
function SettingGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      {title && <h2 className="mb-2 px-1 text-xs font-medium tracking-wide text-muted">{title}</h2>}
      <div className="overflow-hidden rounded-[20px] border border-line/60 bg-card divide-y divide-line/50">{children}</div>
    </section>
  )
}

/** 整行设置：左边带底色的小图标，右边当前值和箭头；sub 写这一组里有什么（只在分组入口用） */
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

/** 无额外底板的设置行；长值另占一行，窄屏保持完整触控区域。 */
function Row({ icon, label, value, onClick, tone, disabled }: { icon: React.ReactNode; label: string; value?: string; onClick: () => void; tone?: 'down'; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex min-h-15 w-full items-center gap-3 py-3 text-left text-[15px] active:bg-card disabled:opacity-50 ${tone === 'down' ? 'text-down' : ''}`}>
      <span className={`flex w-6 shrink-0 items-center justify-center ${tone === 'down' ? 'text-down' : 'text-muted'}`}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1"><span>{label}</span>{value && <span className="max-w-full break-all text-[13px] text-muted">{value}</span>}</span>
      <ChevronRight size={16} className="shrink-0 text-muted" />
    </button>
  )
}
