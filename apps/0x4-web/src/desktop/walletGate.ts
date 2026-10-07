// 网页版（VITE_SURFACE=web）的钱包连接。接口约定 docs/EXTENSION_API.md。
// · 行情、币详情、流媒体列表、社区公开内容、小精灵公开页：不用钱包直接看。
// · 「连接钱包」或要签名 / 要账号的操作：弹连接面板（2026-09-30 goat：外部钱包也能连进来用）——
//   第一个是 0x4 Wallet（推荐，全部功能）；下面列出浏览器里的其它钱包（EIP-6963：MetaMask、Phantom、Rabby、OKX……）；最后是手机钱包扫码。
//   0x4 Wallet：装了插件就请插件连接（插件自己弹窗）；没装就提示获取。
//   外部钱包：它自己弹窗确认连接，连上后用 0x 地址登录同一个 0x4 账号；合约交易、网页快捷交易、私信、小精灵全自动、比特币是 0x4 Wallet 专属（desktop/Ox4Only.tsx）。
// 手机 App 恒为「已有钱包」（路由守卫保证），needWallet() 一律返回 false，行为不变。
import { create } from 'zustand'
import { useTermsGate } from '@/lib/safety'
import { WEB_SURFACE } from '@/lib/surface'
import { setWalletRequiredHandler, setWriteGuard } from '@/lib/social'
import { isWalletConnected, useWallet } from '@/store/wallet'
import { forgetWebSession, useSocial } from '@/store/social'
import { getOx4, waitForOx4, Ox4Error, PERP_SESSION_REQUEST, type Ox4Provider } from '@/lib/vault/extension'
import { discoverWallets, findWallet, phantomSolana, safeIcon, walletRequest, type Eip1193Provider, type WalletDetail, type WalletInfo } from '@/lib/vault/external'
import { toast } from '@/components/Toast'
import { errorText } from '@/lib/errors'
import { t } from '@/lib/i18n'
import { userActing } from '@/lib/userActivation'

interface WalletGateState {
  /** 连接面板（选钱包）是否打开 */
  open: boolean
  /** 「获取 0x4 Wallet」卡片（插件还没上架时写「即将上线」）是否打开 */
  getOx4: boolean
  /** 正在连接（钱包在弹窗等用户确认） */
  connecting: boolean
  /** 正在等哪个钱包确认（面板上显示「请在 xx 中确认」+ 取消） */
  connectingName: string
  /** 面板直接打开在「用 0x4 App 扫码登录」那一页（2026-10-01，没装插件的电脑登录网页版） */
  appQr: boolean
  show: () => void
  /** 打开面板，直接显示 App 扫码登录 */
  showAppQr: () => void
  hide: () => void
}

export const useWalletGate = create<WalletGateState>()((set) => ({
  open: false,
  getOx4: false,
  connecting: false,
  connectingName: '',
  appQr: false,
  show: () => { discoverWallets(); set({ open: true, appQr: false }) },
  showAppQr: () => { discoverWallets(); set({ open: true, appQr: true }) },
  hide: () => set({ open: false, getOx4: false, appQr: false }),
}))

/** 「获取 0x4 Wallet」的地址（插件上架后在构建环境变量里填 VITE_EXTENSION_URL）；没填就是还没上架 */
export const EXTENSION_URL = ((import.meta.env as Record<string, string | undefined>).VITE_EXTENSION_URL || '').trim()
/** 「获取 0x4 Wallet」：有商店地址就打开，没有就弹「即将上线」小卡片（不编造链接） */
export function getOx4Wallet(): void {
  if (EXTENSION_URL) { window.open(EXTENSION_URL, '_blank', 'noopener'); return }
  useWalletGate.setState({ getOx4: true })
}

/** 事件监听只挂一次（同一个插件对象） */
let listening: Ox4Provider | null = null
function listen(p: Ox4Provider) {
  if (listening === p) return
  listening = p
  // 现在连的是外部钱包时，0x4 插件自己的锁定 / 断开 / 换号事件跟它无关，不能把外部钱包摘掉
  const mine = () => useWallet.getState().kind !== 'external'
  const drop = () => { if (mine()) useWallet.getState().detachExtension() }
  // 插件断开（用户在插件里断开这个网站）：连本机存的网页版登录令牌一起删
  const dropAndForget = () => { if (!mine()) return; forgetWebSession(); drop() }
  // ★插件锁定：钱包和登录都留着，只记下「锁着」（2026-10-06 goat「睡一觉起来钱包那些就要重新登录」，goat 拍板改掉 9/29 的做法）。
  //   以前锁定就删登录令牌、摘掉钱包（担心插件锁着时同源脚本拿令牌冒充用户），插件默认 15 分钟自动锁，睡一觉回来就要解锁 + 再签一次登录。
  //   现在：看资料、余额、动态、小精灵照常；动钱（每一笔都要插件签名）时 ensureFor 请插件弹解锁；私信锁着时不解密（store/wallet.ts）。
  //   代价：插件锁着时令牌仍在浏览器里，页面混进恶意脚本能冒充用户发动态、看资料，但动不了钱
  p.on('lock', () => { if (mine()) useWallet.getState().setExtensionLocked(true) })
  p.on('disconnect', dropAndForget)
  // 插件里换了账号：按新地址重新挂签名器（已连接，不会再弹窗）。
  // ★插件每次 connect、每次解锁都会推这个事件，地址其实没变。以前不管变没变都先摘掉钱包再挂上：
  //   社交层跟着登出、再登录，正在进行的那次登录也被打断 → 登录窗口一个接一个弹（2026-09-29 goat 实测）。现在地址没变就不动
  p.on('accountsChanged', (payload) => {
    if (!mine()) return
    const next = payload as { address?: string; evmAddress?: string } | null | undefined
    const cur = useWallet.getState()
    // 地址没变：多半是插件刚解锁（在插件弹窗里解锁、或网站请求连接时解锁，插件都会推这个事件），把「锁着」去掉
    if (cur.wallet && next?.address && next.address === cur.address && (!next.evmAddress || next.evmAddress.toLowerCase() === (cur.evmAddress || '').toLowerCase())) { cur.setExtensionLocked(false); return }
    if (!cur.wallet && !next?.address) return
    drop(); void restoreOx4()
  })
}

/** 签名前的闸：插件还连着、没锁才放行；锁了就请插件弹解锁（connect 在锁着时会弹），用户取消抛 4001 */
function ensureFor(p: Ox4Provider) {
  return async () => {
    const s = await p.status()
    if (!s.connected) { useWallet.getState().detachExtension(); throw new Ox4Error(4100, t('钱包已断开，请重新连接 0x4 Wallet')) }
    // 锁定会结束网页快捷交易，解锁（连接窗口）时顺带问一次要不要开启
    if (!s.unlocked) await p.connect({ perpSession: PERP_SESSION_REQUEST })
    // 到这里插件一定是解锁的（事件可能还没到，或者网页漏了解锁事件）
    useWallet.getState().setExtensionLocked(false)
  }
}

/**
 * 连接尝试编号（2026-09-30 goat：点了某个钱包又没在它弹窗里确认 / 拒绝，回到面板点别的钱包都没反应）。
 * 有些钱包关掉弹窗后不会告诉网页「取消了」，网页一直等。现在每点一次算一次新的尝试，旧尝试之后才回来的结果直接丢掉，
 * 按钮不再被锁住；面板上显示「请在 xx 中确认」和「取消」。
 */
let attempt = 0
const beginAttempt = (name: string) => { useWalletGate.setState({ connecting: true, connectingName: name }); return ++attempt }
const endAttempt = (id: number) => { if (id === attempt) useWalletGate.setState({ connecting: false, connectingName: '' }) }
/** 面板上的「取消」：作废当前尝试（钱包那边的弹窗留着也没关系，回来的结果会被丢掉） */
export function cancelConnect(): void { attempt++; useWalletGate.setState({ connecting: false, connectingName: '' }) }
/** 钱包里还挂着上一次没处理的请求（MetaMask 的 -32002） */
const pendingInWallet = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: number }).code === -32002

/**
 * 请插件连接并挂上签名器。没装插件就打开说明面板。返回是否连上。
 * 用户在插件里取消（4001）不算错误，不弹提示。
 */
export async function connectOx4(): Promise<boolean> {
  if (!WEB_SURFACE) return false
  const p = getOx4() ?? await waitForOx4(600)
  if (!p) { getOx4Wallet(); return false }
  const id = beginAttempt('0x4 Wallet')
  try {
    // 连接窗口里带「开启网页快捷交易」开关（连接后紧跟的那次登录不再弹窗，开关只能放在连接窗口里）
    const acc = await p.connect({ perpSession: PERP_SESSION_REQUEST })
    if (id !== attempt) return false   // 用户已经取消或换了别的钱包
    if (!acc?.address || !acc?.evmAddress) throw new Ox4Error(5000, t('插件没有返回地址，请更新插件后再试'))
    listen(p)
    // 之前连的是外部钱包：先断开它（登录令牌按地址存，换钱包要重新登录）
    if (useWallet.getState().kind === 'external') await disconnectExternal()
    useWallet.getState().attachExtension(p, acc, ensureFor(p))
    useWalletGate.setState({ open: false })
    return true
  } catch (e) {
    if (id !== attempt) return false
    const msg = errorText(e, t('连接失败'))
    if (msg) toast.error(msg)
    return false
  } finally { endAttempt(id) }
}

/**
 * 打开网页时：插件已经对这个网站连过，直接挂上（不弹窗）。插件锁着也挂上、标成锁着（2026-10-06：插件锁了网页不登出），
 * 登录用本机存的令牌，要签名时再请插件解锁。
 * 插件没连着：本机存的登录令牌删掉（插件是在网页关着的时候断开的，网页没收到事件）
 */
export async function restoreOx4(): Promise<void> {
  if (!WEB_SURFACE) return
  const p = await waitForOx4(1500)
  if (!p) return
  listen(p)
  try {
    const s = await p.status()
    if (s.connected && s.address && s.evmAddress) useWallet.getState().attachExtension(p, { address: s.address, evmAddress: s.evmAddress, btcAddress: s.btcAddress }, ensureFor(p), !s.unlocked)
    // 插件没连：上次用的是插件才删令牌（上次用外部钱包的话，令牌是那个钱包的，留给 restoreExternal）
    else if (!readLast()) forgetWebSession()
  } catch { /* 插件没响应：当作没连，用户点连接时再试 */ }
}

/** 「解锁」按钮（合约页、资产页、私信里插件锁着时）：请插件弹解锁窗口；用户关掉窗口不算错误 */
export async function unlockOx4(): Promise<boolean> {
  const p = getOx4()
  if (!p || useWallet.getState().kind !== 'ox4') return false
  try { await ensureFor(p)(); return true } catch (e) {
    const msg = errorText(e, t('解锁失败'))
    if (msg) toast.error(msg)
    return false
  }
}

/** 设置里「断开 0x4 Wallet」：请插件断开这个网站，本地清掉签名器和存着的登录令牌（社交层随之登出） */
export async function disconnectOx4(): Promise<void> {
  const p = getOx4()
  forgetWebSession()
  useWallet.getState().detachExtension()
  try { await p?.disconnect() } catch { /* 插件没响应：本地已经断开了 */ }
}

// ---------- 外部钱包（MetaMask、Phantom 等，2026-09-30） ----------

/** 上次连的外部钱包（rdns；手机钱包扫码是 walletconnect），刷新页面后不弹窗地恢复 */
const LAST_EXTERNAL_KEY = '0x4.lastExternal'
const WALLETCONNECT_RDNS = 'walletconnect'
const readLast = () => { try { return localStorage.getItem(LAST_EXTERNAL_KEY) } catch { return null } }
const writeLast = (v: string | null) => { try { if (v) localStorage.setItem(LAST_EXTERNAL_KEY, v); else localStorage.removeItem(LAST_EXTERNAL_KEY) } catch { /* 无痕模式 */ } }

/** 外部钱包的事件：换了账号 → 按新地址重新挂（要重新登录）；全部断开 → 回到没连钱包 */
let externalListening: { provider: Eip1193Provider; onAccounts: (...a: unknown[]) => void; onDisconnect: () => void } | null = null
function listenExternal(provider: Eip1193Provider, info: Pick<WalletInfo, 'name' | 'icon' | 'rdns'>) {
  unlistenExternal()
  const onAccounts = (...a: unknown[]) => {
    const list = Array.isArray(a[0]) ? (a[0] as string[]) : []
    const cur = useWallet.getState()
    if (cur.kind !== 'external') return
    if (!list.length) { void disconnectExternal(); return }
    if (list[0].toLowerCase() === (cur.evmAddress || '').toLowerCase()) return
    forgetWebSession()
    useWallet.getState().detachExtension()
    useWallet.getState().attachExternal({ provider, info, evmAddress: list[0] })
  }
  const onDisconnect = () => { if (useWallet.getState().kind === 'external') void disconnectExternal() }
  provider.on?.('accountsChanged', onAccounts)
  provider.on?.('disconnect', onDisconnect)
  externalListening = { provider, onAccounts, onDisconnect }
}
function unlistenExternal() {
  if (!externalListening) return
  externalListening.provider.removeListener?.('accountsChanged', externalListening.onAccounts)
  externalListening.provider.removeListener?.('disconnect', externalListening.onDisconnect)
  externalListening = null
}

/** 挂上外部钱包（连接成功、或刷新后恢复）。Phantom 另外把 Solana 接上（接不上不影响 EVM） */
async function attachExternal(provider: Eip1193Provider, info: Pick<WalletInfo, 'name' | 'icon' | 'rdns'>, evmAddress: string, silent: boolean) {
  const sol = phantomSolana(info.rdns)
  let solana: { provider: NonNullable<typeof sol>; address: string } | null = null
  if (sol) {
    try { const r = await sol.connect(silent ? { onlyIfTrusted: true } : undefined); solana = { provider: sol, address: r.publicKey.toString() } } catch { /* 用户拒绝了 Solana 或没开：只用 EVM */ }
  }
  // 之前连的是 0x4 插件：本地摘掉（插件那边的连接不动，换回来时不用重新授权）
  if (useWallet.getState().kind === 'ox4') { forgetWebSession(); useWallet.getState().detachExtension() }
  useWallet.getState().attachExternal({ provider, info, evmAddress, solana })
  listenExternal(provider, info)
  writeLast(info.rdns)
}

/** 连接浏览器里的某个外部钱包（EIP-6963 发现的）：它自己弹窗确认，用户取消不算错误 */
export async function connectExternal(w: WalletDetail): Promise<boolean> {
  const id = beginAttempt(w.info.name)
  try {
    const accounts = await walletRequest<string[]>(w.provider, 'eth_requestAccounts')
    if (id !== attempt) return false   // 用户已经取消或换了别的钱包
    const evmAddress = Array.isArray(accounts) ? accounts[0] : null
    if (!evmAddress || !/^0x[0-9a-fA-F]{40}$/.test(evmAddress)) throw new Error(t('这个钱包没有返回地址'))
    await attachExternal(w.provider, { name: w.info.name, icon: safeIcon(w.info.icon) ?? '', rdns: w.info.rdns }, evmAddress, false)
    useWalletGate.setState({ open: false })
    return true
  } catch (e) {
    if (id !== attempt) return false
    // 钱包里还挂着上一次没处理的请求：告诉用户去钱包里处理
    if (pendingInWallet(e)) { toast.error(t('请先在 {name} 中完成或关闭之前的请求', { name: w.info.name })); return false }
    const msg = errorText(e, t('连接失败'))
    if (msg) toast.error(msg)
    return false
  } finally { endAttempt(id) }
}

/** 手机钱包扫码连上之后（界面在 desktop/ConnectWallet.tsx 出二维码）挂上 */
export async function attachWalletConnect(c: { provider: Eip1193Provider; address: string; name: string }): Promise<void> {
  await attachExternal(c.provider, { name: c.name, icon: '', rdns: WALLETCONNECT_RDNS }, c.address, false)
  useWalletGate.setState({ open: false })
}

/** 断开外部钱包：本地清掉签名器和登录令牌；MetaMask 等支持的话顺带撤掉网站授权，手机钱包断开会话 */
export async function disconnectExternal(): Promise<void> {
  const provider = externalListening?.provider
  unlistenExternal()
  forgetWebSession()
  useWallet.getState().detachExtension()
  const last = readLast()
  writeLast(null)
  if (last === WALLETCONNECT_RDNS) { void import('@/lib/walletConnectLogin').then((m) => m.endWalletConnect()).catch(() => {}); return }
  if (provider) void walletRequest(provider, 'wallet_revokePermissions', [{ eth_accounts: {} }]).catch(() => { /* 不支持就算了：本地已经断开 */ })
}

/** 刷新页面后：上次连的是外部钱包、它还授权着这个网站，就不弹窗地挂回来 */
async function restoreExternal(): Promise<void> {
  const last = readLast()
  if (!last) return
  try {
    if (last === WALLETCONNECT_RDNS) {
      const c = await (await import('@/lib/walletConnectLogin')).restoreWalletConnect()
      if (c) await attachExternal(c.provider, { name: c.name, icon: '', rdns: WALLETCONNECT_RDNS }, c.address, true)
      else writeLast(null)
      return
    }
    const w = await findWallet(last)
    if (!w) return
    const accounts = await walletRequest<string[]>(w.provider, 'eth_accounts')
    if (Array.isArray(accounts) && accounts[0]) await attachExternal(w.provider, { name: w.info.name, icon: safeIcon(w.info.icon) ?? '', rdns: w.info.rdns }, accounts[0], true)
    else { writeLast(null); forgetWebSession() }
  } catch { /* 钱包没响应：当作没连，用户点连接时再选 */ }
}

/** 打开网页时恢复钱包：0x4 插件连着就用它；否则看上次连的外部钱包 */
export async function restoreWallet(): Promise<void> {
  if (!WEB_SURFACE) return
  discoverWallets()
  await restoreOx4()
  if (!useWallet.getState().wallet) await restoreExternal()
}

/** 顶栏 / 设置里「断开钱包」：0x4 插件和外部钱包各走各的 */
export async function disconnectWallet(): Promise<void> {
  if (useWallet.getState().kind === 'external') await disconnectExternal()
  else await disconnectOx4()
}

/** 「连接钱包」按钮：打开连接面板（0x4 Wallet 推荐放第一个） */
export function connectWallet(): void { if (WEB_SURFACE) useWalletGate.getState().show() }

/** 网页版：钱包没连就打开连接面板并返回 true，调用方直接 return（连上后用户再点一次）；已连或手机 App 返回 false */
export function needWallet(): boolean {
  if (!WEB_SURFACE || isWalletConnected(useWallet.getState())) return false
  connectWallet()
  return true
}

/**
 * 网页版：会议、直播这类「有账号就行、不用签名」的操作（2026-10-01）：钱包连着，或者用手机 App 扫码登录着，都放行；
 * 都没有就打开连接面板（里面有「用 0x4 App 扫码登录」）并返回 true。
 */
export function needLogin(): boolean {
  if (!WEB_SURFACE || isWalletConnected(useWallet.getState())) return false
  const s = useSocial.getState()
  if (s.qrMode && s.status === 'ready') return false
  connectWallet()
  return true
}

/**
 * 网页版：钱包连着但社交层没登录上（用户取消过登录签名、令牌过期、网络失败）时，用户做了要登录的操作 → 这时才请插件登录（用户操作，一个窗口）。
 * 返回 true = 这次操作先不做（登录好后用户再点一次）。正在登录中就只拦下，不重复发起。
 * 网页版登录失败后不自动重试（store/social.ts），这里和页面上的「重新登录」是重新登录的两个入口。
 */
export function needSocialLogin(): boolean {
  if (!WEB_SURFACE || !isWalletConnected(useWallet.getState())) return false
  const s = useSocial.getState()
  if (s.status === 'ready') return false
  // 还没同意条款：用户做了要登录的事 → 把条款拿出来（点过「以后再说」也拿）
  if (s.needTerms) { useTermsGate.getState().show(true); return true }
  // 只有用户刚点过 / 按过键（浏览器的「用户激活」还在）才发起登录：页面自己在后台发的写请求不许把登录窗口弹出来（用户拒绝过就更不能）
  if (s.status !== 'logging' && userActing()) void s.login()
  return true
}
/**
 * 网页版访客点了要社区账号的东西（点赞、评论、关注、看公告…）：没连钱包就开连接面板，连着但社区没登录上就请插件登录。
 * 返回 true = 这次先不做（2026-10-04 走查：以前这些地方要么没反应、要么只有一句「连接社交服务后可以…」，没有按钮）。手机 App 恒为 false
 */
export function needAccount(): boolean { return needWallet() || needSocialLogin() }


// 社交接口的写操作（发帖、点赞、关注、进群、开会议……）没连钱包时在这里拦下：去连钱包，不发请求；连着但没登录上就先登录
if (WEB_SURFACE) setWriteGuard(() => needWallet() || needSocialLogin())
// 扫码登录的电脑做了要连钱包的事（服务器回 WALLET_REQUIRED）：弹出连接钱包
if (WEB_SURFACE) setWalletRequiredHandler(() => connectWallet())
