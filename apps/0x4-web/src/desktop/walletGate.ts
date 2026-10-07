// Web (VITE_SURFACE=web) wallet connection. Interface contract: docs/EXTENSION_API.md.
// · Market data, coin details, livestream lists, public community content, public sprite pages: viewable without a wallet.
// · "Connect wallet" or operations needing a signature / account: pop the connect panel (2026-09-30 goat: external wallets can also connect) —
//   First is 0x4 Wallet (recommended, full features); below list other wallets found in the browser (EIP-6963: MetaMask, Phantom, Rabby, OKX…); last is mobile-wallet QR scan.
//   0x4 Wallet: if the extension is installed, ask it to connect (it pops its own window); if not, prompt to get it.
//   External wallets: they pop their own window to confirm; after connecting, sign in to the same 0x4 account with the 0x address; perp trading, web quick-trade, DMs, sprite full-auto and Bitcoin are 0x4 Wallet exclusives (desktop/Ox4Only.tsx).
// The mobile app always "has a wallet" (guaranteed by the route guard), so needWallet() always returns false — behavior unchanged.
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
  /** Whether the connect panel (wallet picker) is open */
  open: boolean
  /** Whether the "Get 0x4 Wallet" card is open (says "coming soon" while the extension isn't listed yet) */
  getOx4: boolean
  /** Connecting (the wallet is popping a window waiting for user confirmation) */
  connecting: boolean
  /** Which wallet we're waiting on (panel shows "Please confirm in xx" + cancel) */
  connectingName: string
  /** Panel opens directly on the "Log in by scanning with the 0x4 App" page (2026-10-01, desktop web login without the extension installed) */
  appQr: boolean
  show: () => void
  /** Open the panel, showing the app QR-scan login directly */
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

/** The "Get 0x4 Wallet" URL (filled via build env VITE_EXTENSION_URL once the extension is listed); empty means not listed yet */
export const EXTENSION_URL = ((import.meta.env as Record<string, string | undefined>).VITE_EXTENSION_URL || '').trim()
/** "Get 0x4 Wallet": open the store URL if set, otherwise pop the "coming soon" card (never fabricate a link) */
export function getOx4Wallet(): void {
  if (EXTENSION_URL) { window.open(EXTENSION_URL, '_blank', 'noopener'); return }
  useWalletGate.setState({ getOx4: true })
}

/** Event listeners attach only once (same extension object) */
let listening: Ox4Provider | null = null
function listen(p: Ox4Provider) {
  if (listening === p) return
  listening = p
  // When an external wallet is currently connected, the 0x4 extension's own lock / disconnect / account-change events don't concern it — must not drop the external wallet
  const mine = () => useWallet.getState().kind !== 'external'
  const drop = () => { if (mine()) useWallet.getState().detachExtension() }
  // Extension disconnected (user disconnected this site inside the extension): also delete the locally stored web login token
  const dropAndForget = () => { if (!mine()) return; forgetWebSession(); drop() }
  // ★Extension locked: keep wallet and login, only record "locked" (2026-10-06 goat: "wake up and have to re-login everything" — goat decided to change the 9/29 behavior).
  //   Previously, locking deleted the login token and dropped the wallet (fear: same-origin scripts grabbing the token to impersonate the user while locked); the extension auto-locks after 15 min by default, so after a night's sleep you'd have to unlock + sign in again.
  //   Now: profile, balance, feed, sprite work as usual while locked; moving money (every tx needs the extension's signature) triggers ensureFor to ask the extension to unlock; DMs aren't decrypted while locked (store/wallet.ts).
  //   Trade-off: the token stays in the browser while locked, so a malicious script injected into the page could post and read profile as the user — but can't move money
  p.on('lock', () => { if (mine()) useWallet.getState().setExtensionLocked(true) })
  p.on('disconnect', dropAndForget)
  // Account switched inside the extension: re-attach the signer for the new address (already connected, no new popup).
  // ★The extension pushes this event on every connect and every unlock, even when the address didn't change. Previously it dropped and re-attached the wallet regardless:
  //   the social layer logged out and back in, interrupting the login in progress → login windows popped one after another (2026-09-29 goat verified on device). Now: address unchanged → leave it alone
  p.on('accountsChanged', (payload) => {
    if (!mine()) return
    const next = payload as { address?: string; evmAddress?: string } | null | undefined
    const cur = useWallet.getState()
    // Address unchanged: most likely the extension just unlocked (it pushes this event both on in-extension unlock and on website-requested connect), so clear the "locked" flag
    if (cur.wallet && next?.address && next.address === cur.address && (!next.evmAddress || next.evmAddress.toLowerCase() === (cur.evmAddress || '').toLowerCase())) { cur.setExtensionLocked(false); return }
    if (!cur.wallet && !next?.address) return
    drop(); void restoreOx4()
  })
}

/** Pre-sign gate: pass only if the extension is still connected and unlocked; if locked, ask the extension to unlock (connect pops while locked); user cancel throws 4001 */
function ensureFor(p: Ox4Provider) {
  return async () => {
    const s = await p.status()
    if (!s.connected) { useWallet.getState().detachExtension(); throw new Ox4Error(4100, t('钱包已断开，请重新连接 0x4 Wallet')) }
    // Locking ends web quick-trade; when unlocking (the connect window) ask once whether to enable it
    if (!s.unlocked) await p.connect({ perpSession: PERP_SESSION_REQUEST })
    // The extension is definitely unlocked by this point (the event may not have arrived, or the page missed the unlock event)
    useWallet.getState().setExtensionLocked(false)
  }
}

/**
 * Connection attempt counter (2026-09-30 goat: clicked a wallet, then neither confirmed nor rejected in its popup — clicking other wallets in the panel afterwards did nothing).
 * Some wallets don't tell the page "cancelled" when their popup is closed, so the page waits forever. Now each click starts a new attempt, results arriving for old attempts are dropped,
 * the button no longer stays stuck; the panel shows "Please confirm in xx" and "Cancel".
 */
let attempt = 0
const beginAttempt = (name: string) => { useWalletGate.setState({ connecting: true, connectingName: name }); return ++attempt }
const endAttempt = (id: number) => { if (id === attempt) useWalletGate.setState({ connecting: false, connectingName: '' }) }
/** The panel's "Cancel": voids the current attempt (the wallet-side popup can stay open — its eventual result will be dropped) */
export function cancelConnect(): void { attempt++; useWalletGate.setState({ connecting: false, connectingName: '' }) }
/** The wallet still has a pending request from last time (MetaMask's -32002) */
const pendingInWallet = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: number }).code === -32002

/**
 * Ask the extension to connect and attach the signer. Opens the explainer panel if the extension isn't installed. Returns whether connected.
 * User cancel in the extension (4001) is not an error — no toast.
 */
export async function connectOx4(): Promise<boolean> {
  if (!WEB_SURFACE) return false
  const p = getOx4() ?? await waitForOx4(600)
  if (!p) { getOx4Wallet(); return false }
  const id = beginAttempt('0x4 Wallet')
  try {
    // The connect window carries an "enable web quick-trade" switch (the login right after connecting no longer pops, so the switch can only live in the connect window)
    const acc = await p.connect({ perpSession: PERP_SESSION_REQUEST })
    if (id !== attempt) return false   // User already cancelled or switched to another wallet
    if (!acc?.address || !acc?.evmAddress) throw new Ox4Error(5000, t('插件没有返回地址，请更新插件后再试'))
    listen(p)
    // Previously connected an external wallet: disconnect it first (login tokens are stored per address, switching wallets needs a fresh login)
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
 * On page open: if the extension already connected to this site, attach directly (no popup). Attach even while locked, flagged as locked (2026-10-06: a locked extension no longer logs web out),
 * and log in with the locally stored token; ask the extension to unlock only when a signature is needed.
 * Extension not connected: delete the locally stored login token (it was disconnected while the page was closed, so the page never got the event)
 */
export async function restoreOx4(): Promise<void> {
  if (!WEB_SURFACE) return
  const p = await waitForOx4(1500)
  if (!p) return
  listen(p)
  try {
    const s = await p.status()
    if (s.connected && s.address && s.evmAddress) useWallet.getState().attachExtension(p, { address: s.address, evmAddress: s.evmAddress, btcAddress: s.btcAddress }, ensureFor(p), !s.unlocked)
    // Extension not connected: only delete the token if the extension was last used (if an external wallet was last, the token is that wallet's — leave it for restoreExternal)
    else if (!readLast()) forgetWebSession()
  } catch { /* Extension not responding: treat as not connected, retry when the user clicks connect */ }
}

/** "Unlock" button (perp page, asset page, DMs when the extension is locked): ask the extension to pop the unlock window; user closing the window is not an error */
export async function unlockOx4(): Promise<boolean> {
  const p = getOx4()
  if (!p || useWallet.getState().kind !== 'ox4') return false
  try { await ensureFor(p)(); return true } catch (e) {
    const msg = errorText(e, t('解锁失败'))
    if (msg) toast.error(msg)
    return false
  }
}

/** Settings "Disconnect 0x4 Wallet": ask the extension to disconnect this site, locally clear the signer and stored login token (social layer logs out along) */
export async function disconnectOx4(): Promise<void> {
  const p = getOx4()
  forgetWebSession()
  useWallet.getState().detachExtension()
  try { await p?.disconnect() } catch { /* Extension not responding: locally already disconnected */ }
}

// ---------- External wallets (MetaMask, Phantom, etc., 2026-09-30) ----------

/** Last connected external wallet (rdns; mobile-wallet scan is walletconnect), restored without a popup after refresh */
const LAST_EXTERNAL_KEY = '0x4.lastExternal'
const WALLETCONNECT_RDNS = 'walletconnect'
const readLast = () => { try { return localStorage.getItem(LAST_EXTERNAL_KEY) } catch { return null } }
const writeLast = (v: string | null) => { try { if (v) localStorage.setItem(LAST_EXTERNAL_KEY, v); else localStorage.removeItem(LAST_EXTERNAL_KEY) } catch { /* Incognito mode */ } }

/** External wallet events: account switched → re-attach for the new address (needs fresh login); all disconnected → back to no-wallet */
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

/** Attach an external wallet (after successful connect, or restore after refresh). Phantom also connects Solana (EVM unaffected if that fails) */
async function attachExternal(provider: Eip1193Provider, info: Pick<WalletInfo, 'name' | 'icon' | 'rdns'>, evmAddress: string, silent: boolean) {
  const sol = phantomSolana(info.rdns)
  let solana: { provider: NonNullable<typeof sol>; address: string } | null = null
  if (sol) {
    try { const r = await sol.connect(silent ? { onlyIfTrusted: true } : undefined); solana = { provider: sol, address: r.publicKey.toString() } } catch { /* User rejected Solana or it's unavailable: EVM only */ }
  }
  // Previously connected the 0x4 extension: detach locally (the extension-side connection stays, so switching back needs no re-authorization)
  if (useWallet.getState().kind === 'ox4') { forgetWebSession(); useWallet.getState().detachExtension() }
  useWallet.getState().attachExternal({ provider, info, evmAddress, solana })
  listenExternal(provider, info)
  writeLast(info.rdns)
}

/** Connect an external wallet found in the browser (EIP-6963 discovery): it pops its own confirmation; user cancel is not an error */
export async function connectExternal(w: WalletDetail): Promise<boolean> {
  const id = beginAttempt(w.info.name)
  try {
    const accounts = await walletRequest<string[]>(w.provider, 'eth_requestAccounts')
    if (id !== attempt) return false   // User already cancelled or switched to another wallet
    const evmAddress = Array.isArray(accounts) ? accounts[0] : null
    if (!evmAddress || !/^0x[0-9a-fA-F]{40}$/.test(evmAddress)) throw new Error(t('这个钱包没有返回地址'))
    await attachExternal(w.provider, { name: w.info.name, icon: safeIcon(w.info.icon) ?? '', rdns: w.info.rdns }, evmAddress, false)
    useWalletGate.setState({ open: false })
    return true
  } catch (e) {
    if (id !== attempt) return false
    // The wallet still has an unhandled request from last time: tell the user to handle it in the wallet
    if (pendingInWallet(e)) { toast.error(t('请先在 {name} 中完成或关闭之前的请求', { name: w.info.name })); return false }
    const msg = errorText(e, t('连接失败'))
    if (msg) toast.error(msg)
    return false
  } finally { endAttempt(id) }
}

/** Attach after a mobile wallet connects via QR scan (UI shows the QR in desktop/ConnectWallet.tsx) */
export async function attachWalletConnect(c: { provider: Eip1193Provider; address: string; name: string }): Promise<void> {
  await attachExternal(c.provider, { name: c.name, icon: '', rdns: WALLETCONNECT_RDNS }, c.address, false)
  useWalletGate.setState({ open: false })
}

/** Disconnect an external wallet: locally clear the signer and login token; revoke the site's authorization too if supported (MetaMask etc.), disconnect the session for mobile wallets */
export async function disconnectExternal(): Promise<void> {
  const provider = externalListening?.provider
  unlistenExternal()
  forgetWebSession()
  useWallet.getState().detachExtension()
  const last = readLast()
  writeLast(null)
  if (last === WALLETCONNECT_RDNS) { void import('@/lib/walletConnectLogin').then((m) => m.endWalletConnect()).catch(() => {}); return }
  if (provider) void walletRequest(provider, 'wallet_revokePermissions', [{ eth_accounts: {} }]).catch(() => { /* If not supported, so be it: locally already disconnected */ })
}

/** After refresh: if the last wallet was external and still authorizes this site, re-attach without a popup */
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
  } catch { /* Wallet not responding: treat as not connected, let the user pick again on connect */ }
}

/** Restore wallet on page open: use the 0x4 extension if connected; otherwise look at the last external wallet */
export async function restoreWallet(): Promise<void> {
  if (!WEB_SURFACE) return
  discoverWallets()
  await restoreOx4()
  if (!useWallet.getState().wallet) await restoreExternal()
}

/** Top bar / settings "Disconnect wallet": 0x4 extension and external wallets each take their own path */
export async function disconnectWallet(): Promise<void> {
  if (useWallet.getState().kind === 'external') await disconnectExternal()
  else await disconnectOx4()
}

/** "Connect wallet" button: open the connect panel (0x4 Wallet recommended first) */
export function connectWallet(): void { if (WEB_SURFACE) useWalletGate.getState().show() }

/** Web: if no wallet is connected, open the connect panel and return true — the caller just returns (user taps again after connecting); returns false if already connected or on the mobile app */
export function needWallet(): boolean {
  if (!WEB_SURFACE || isWalletConnected(useWallet.getState())) return false
  connectWallet()
  return true
}

/**
 * Web: operations like meetings and livestreams that need "an account, no signature" (2026-10-01): pass if a wallet is connected or the user logged in via mobile-app scan;
 * otherwise open the connect panel (which has "Log in by scanning with the 0x4 App") and return true.
 */
export function needLogin(): boolean {
  if (!WEB_SURFACE || isWalletConnected(useWallet.getState())) return false
  const s = useSocial.getState()
  if (s.qrMode && s.status === 'ready') return false
  connectWallet()
  return true
}

/**
 * Web: when the wallet is connected but the social layer failed to log in (user cancelled the login signature, token expired, network failed), and the user does something needing login → only then ask the extension to log in (user action, one window).
 * Returns true = skip this operation for now (user taps again after login). If a login is already in flight, just block without starting another.
 * No auto-retry after web login failure (store/social.ts); this and the page's "re-login" are the two re-login entry points.
 */
export function needSocialLogin(): boolean {
  if (!WEB_SURFACE || !isWalletConnected(useWallet.getState())) return false
  const s = useSocial.getState()
  if (s.status === 'ready') return false
  // Terms not yet accepted: user does something needing login → show the terms (even if they tapped "later" before)
  if (s.needTerms) { useTermsGate.getState().show(true); return true }
  // Only start login while the user just clicked / pressed a key (the browser's "user activation" is still live): background write requests from the page must not pop the login window (especially not after the user rejected once)
  if (s.status !== 'logging' && userActing()) void s.login()
  return true
}
/**
 * Web guest tapping things that need a community account (like, comment, follow, read announcements…): open the connect panel if no wallet is connected, ask the extension to log in if connected but the community login didn't go through.
 * Returns true = skip this time (2026-10-04 walkthrough: these spots previously either did nothing or showed a bare "connect social to…" with no button). Always false on the mobile app
 */
export function needAccount(): boolean { return needWallet() || needSocialLogin() }


// Social API write ops (post, like, follow, join group, start meeting…) with no wallet connected are blocked here: go connect the wallet, don't send the request; if connected but not logged in, log in first
if (WEB_SURFACE) setWriteGuard(() => needWallet() || needSocialLogin())
// A scan-logged-in desktop doing something that needs a wallet (server returns WALLET_REQUIRED): pop the connect wallet panel
if (WEB_SURFACE) setWalletRequiredHandler(() => connectWallet())
