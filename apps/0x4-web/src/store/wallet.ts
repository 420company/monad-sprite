// Wallet state.
//
// App (iOS): the private key lives in the native module native/Ox4Vault (the module name keeps the old brand — users never see it); here we only hold the address and the "signer" handle,
//             No private key ever exists in memory. The vault ciphertext still lives in localStorage, handed to native for loading at startup.
// Web: no native layer — keep using the in-memory Keypair / private-key account, same behavior as before.
//
// 2026-09-25 "ready on open, verify only when moving money" (native app only, persistentSession):
//   wallet / evmAccount persist whenever there's a wallet — they're the gated shell (lib/vault/gate.ts):
//   The address is always available; if not unlocked at real-sign time, pop the verification panel. The real signers live in the module variables realSol / realEvm,
//   Locking only clears those; the shell and the DM key (dm) stay — so social still browses and DMs still send/receive while locked.
//   keysUnlocked is the real "is the wallet unlocked" flag; web behavior unchanged: locking wipes everything and blocks the whole page back to the unlock screen.
//   Web connected to the 0x4 extension (2026-10-06 goat: "woke up having to log in again"): extension locking no longer unmounts the wallet — it only sets keysUnlocked to false
//   (setExtensionLocked). Address, balances, and social as usual; when a signature is needed, ensure asks the extension to pop its unlock window; DMs aren't decrypted while locked (DmLocked).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Account } from 'viem'
import type { Vault as VaultData } from '@/lib/types'
import {
  buildVault, keypairFromMnemonic, keypairFromSecret, newMnemonic, unlockVault, decryptText, exportSecretBase58,
  evmKeyFromMnemonic, evmAccountFromKey, classifySecret, normalizeEvmKey, keypairFromEvmKey, evmKeyFromKeypair,
} from '@/lib/wallet'
import { Vault, nativeVault, type VaultInfo } from '@/lib/vault/native'
import { localSolanaWallet, nativeSolanaWallet, nativeEvmAccount, nativeBtcSigner, gatedBtcSigner, type SolanaWallet } from '@/lib/vault/signers'
import { localBtcSigner, btcWif, type BtcSigner } from '@/lib/btc'
import { nativeDm, type DmCrypto } from '@/lib/vault/dm'
import { androidBiometric, biometricAndroid, BiometricInvalidated } from '@/lib/biometric'
import { unregisterPush } from '@/lib/push'
import { gatedSolanaWallet, gatedEvmAccount } from '@/lib/vault/signers'
import { dmPrivateKey, localDmFromKey, dmKeyToB64, dmKeyFromB64 } from '@/lib/vault/dm'
import { ensureUnlocked, notifyLock, setExternalUnlock, setUnlockedCheck } from '@/lib/vault/gate'
import { DmLocked } from '@/lib/chatHistory'
import { persistentSession, secureStore } from '@/lib/secureStore'
import { Keypair } from '@solana/web3.js'
import { WEB_SURFACE } from '@/lib/surface'
import { extensionSolanaWallet, extensionEvmAccount, extensionBtcSigner, extensionDm, type Ox4Provider, type Ox4Accounts } from '@/lib/vault/extension'
import { eip1193Account, phantomSolanaWallet, type Eip1193Provider, type PhantomSolana, type WalletInfo } from '@/lib/vault/external'
import { t } from '@/lib/i18n'

interface WalletState {
  vault: VaultData | null
  /** Solana signer (no private key in the app) */
  wallet: SolanaWallet | null
  evmAccount: Account | null
  /** DM encrypt/decrypt */
  dm: DmCrypto | null
  address: string | null
  evmAddress: string | null
  /** Bitcoin receiving address bc1q… (empty for old wallets before first unlock) */
  btcAddress: string | null
  /** Bitcoin signer (gated in the app, no private key) */
  btc: BtcSigner | null
  /** Whether the wallet's private key is unlocked (can sign directly). On web this is equivalent to wallet being non-null */
  keysUnlocked: boolean
  createWallet: (password: string) => Promise<string>
  importMnemonic: (mnemonic: string, password: string) => Promise<void>
  importSecret: (secret: string, password: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  unlockWithBiometric: (reason: string) => Promise<void>
  lock: () => void
  reset: () => void
  revealMnemonic: (password: string) => Promise<string | null>
  revealSecret: (password: string) => Promise<string>
  revealEvmKey: (password: string) => Promise<string>
  /** Export the Bitcoin private key (WIF, mainnet compressed) */
  revealBtcWif: (password: string) => Promise<string>
  enableBiometric: (password: string) => Promise<void>
  disableBiometric: () => Promise<void>
  /**
   * Web (VITE_SURFACE=web): after connecting the 0x4 browser extension, mount its signer (the private key lives in the extension; here we only hold the address and a handle).
   * ensure: before signing, check the extension is still connected and unlocked (if locked, ask the extension to pop its unlock) — see desktop/walletGate.ts.
   * locked: the extension is currently locked (it was already locked when the page opened): mount it anyway, keysUnlocked = false
   */
  attachExtension: (p: Ox4Provider, accounts: Ox4Accounts, ensure: () => Promise<void>, locked?: boolean) => void
  /** Plugin disconnected / account switched (external wallet disconnects also come here): drop the signer, web goes back to "no wallet connected" */
  detachExtension: () => void
  /** Web extension lock / unlock: keep the wallet, only flip keysUnlocked (locking also clears the perps trading-key cache). No-op when not connected via the extension */
  setExtensionLocked: (locked: boolean) => void
  /**
   * Which wallet the web build is connected to (2026-09-30 goat: external wallets can connect too): 'ox4' = the 0x4 browser extension (full features);
   * 'external' = MetaMask, Phantom, etc. (login, community, spot work; perps, DMs, sprite autopilot, and Bitcoin are 0x4 Wallet exclusives — desktop/Ox4Only.tsx).
   * The phone app is always null (the wallet is the app itself)
   */
  kind: 'ox4' | 'external' | null
  /** The external wallet's name and icon (for top-bar display) */
  external: Pick<WalletInfo, 'name' | 'icon' | 'rdns'> | null
  /**
   * Mount an external wallet: EVM address + EIP-1193 signer; Phantom additionally provides Solana (without it, coins on Solana can't be traded).
   * External wallets have no DM keys, no Bitcoin, no perps trading keys
   */
  attachExternal: (o: { provider: Eip1193Provider; info: Pick<WalletInfo, 'name' | 'icon' | 'rdns'>; evmAddress: string; solana?: { provider: PhantomSolana; address: string } | null }) => void
}

/** Whether web has a wallet connected (0x4 plugin or external wallets count); the mobile app checks for a signer instead */
export const isWalletConnected = (s: Pick<WalletState, 'wallet' | 'kind'>) => !!s.wallet || s.kind === 'external'
/** Web is currently connected to an external wallet (0x4 Wallet exclusives must swap to hint cards) */
export const isExternalWallet = (s: Pick<WalletState, 'kind'>) => s.kind === 'external'

/** The real signer. Cleared on lock; the shell (gated wallet / evmAccount) fetches it fresh here on every signature */
let realSol: SolanaWallet | null = null
let realEvm: Account | null = null
let realBtc: BtcSigner | null = null

/** Gated shell cached by address: the same wallet is always the same object; pages and the contract-agent key cache both rely on it for identity */
let shells: { address: string; evmAddress: string; sol: SolanaWallet; evm: Account } | null = null
let btcShell: BtcSigner | null = null
const ensure = () => ensureUnlocked()
function shellsFor(address: string, evmAddress: string) {
  if (!shells || shells.address !== address || shells.evmAddress !== evmAddress) {
    shells = {
      address, evmAddress,
      sol: gatedSolanaWallet(address, () => realSol, ensure),
      evm: gatedEvmAccount(evmAddress, () => realEvm, ensure),
    }
  }
  return shells
}
function btcShellFor(btcAddress: string) {
  if (!btcShell || btcShell.address !== btcAddress) btcShell = gatedBtcSigner(btcAddress, () => realBtc, ensure)
  return btcShell
}

/**
 * Derive the outward-facing fields from "what the real signer is right now".
 * Native app: hand out the gated shell whenever there's a wallet; web: hand out the real signer only once unlocked.
 */
function exposed(address: string | null, evmAddress: string | null, btcAddress: string | null, dm: DmCrypto | null): Partial<WalletState> {
  const keysUnlocked = !!realSol && !!realEvm
  if (persistentSession && address && evmAddress) {
    const sh = shellsFor(address, evmAddress)
    const btc = btcAddress ? btcShellFor(btcAddress) : null
    return { wallet: sh.sol, evmAccount: sh.evm, btc, dm, address, evmAddress, btcAddress, keysUnlocked }
  }
  return { wallet: realSol, evmAccount: realEvm, btc: realBtc, dm: keysUnlocked ? dm : null, address, evmAddress, btcAddress, keysUnlocked }
}

/** Native (iOS) returned status → store fields */
function fromNative(info: VaultInfo, prev: VaultData | null): Partial<WalletState> {
  const vault = info.vault ? (JSON.parse(info.vault) as VaultData) : prev
  const address = info.address || vault?.publicKey || null
  const evmAddress = info.evmAddress || vault?.evmAddress || null
  const btcAddress = info.btcAddress || vault?.btcAddress || null
  realSol = info.unlocked && address ? nativeSolanaWallet(address) : null
  realEvm = info.unlocked && evmAddress ? nativeEvmAccount(evmAddress) : null
  realBtc = info.unlocked && btcAddress ? nativeBtcSigner(btcAddress) : null
  // DMs live in native; they still work while the wallet is locked if the DM key was restored from the keychain (calls report "locked" when it wasn't)
  return { vault, ...exposed(address, evmAddress, btcAddress, vault ? nativeDm() : null) }
}

/** The web layer holds private keys (web, Android): mount the real signer after unlock; Android also stashes the DM private key into on-device encrypted storage */
function fromLocal(vault: VaultData, keypair: Keypair, evm: ReturnType<typeof evmAccountFromKey>, btcKey: Uint8Array | null): Partial<WalletState> {
  realSol = localSolanaWallet(keypair)
  realEvm = evm
  realBtc = btcKey ? localBtcSigner(btcKey) : null
  const dmKey = dmPrivateKey(keypair)
  if (persistentSession) void secureStore.set('dm-key', JSON.stringify({ address: vault.publicKey, key: dmKeyToB64(dmKey) }))
  return { vault, ...exposed(vault.publicKey, vault.evmAddress ?? evm.address, vault.btcAddress ?? realBtc?.address ?? null, localDmFromKey(dmKey)) }
}

export const useWallet = create<WalletState>()(
  persist(
    (set, get) => ({
      vault: null,
      wallet: null,
      evmAccount: null,
      dm: null,
      address: null,
      evmAddress: null,
      btcAddress: null,
      btc: null,
      keysUnlocked: false,
      kind: null,
      external: null,

      attachExternal({ provider, info, evmAddress, solana }) {
        // External wallets: signatures are confirmed in their own popups — the web has no "locked" concept, so no gated shell is applied
        realSol = solana ? phantomSolanaWallet(solana.provider, solana.address) : null
        realEvm = eip1193Account(provider, evmAddress, info.name)
        realBtc = null
        set({ vault: null, wallet: realSol, evmAccount: realEvm, btc: null, dm: null, address: solana?.address ?? null, evmAddress, btcAddress: null, keysUnlocked: true, kind: 'external', external: { name: info.name, icon: info.icon, rdns: info.rdns } })
      },

      attachExtension(p, acc, ensure, locked = false) {
        // The real signer = the extension adapter layer; outwardly a gated shell (passes ensure before signing), with the login signature and perps trading key — two extension-only capabilities — added on the shell
        const sol = extensionSolanaWallet(p, acc.address)
        const evm = extensionEvmAccount(p, acc.evmAddress)
        realSol = sol
        realEvm = evm
        realBtc = acc.btcAddress ? extensionBtcSigner(p, acc.btcAddress) : null
        const wallet = Object.assign(gatedSolanaWallet(acc.address, () => realSol, ensure), { signLogin: async (m: string, evmLink?: string) => { await ensure(); return sol.signLogin(m, evmLink) } })
        // ox4PerpRead (perps read-only queries, handled by the extension) skips ensure: that's the page's periodic refresh — a locked extension just returns 4900, which must not pop the unlock window.
        // ox4PerpWrite (contract writes, handled by the extension) is a user action — passes ensure first (locked → ask the extension to unlock); the quick-trade status query skips ensure
        const evmAccount = Object.assign(gatedEvmAccount(acc.evmAddress, () => realEvm, ensure), {
          ox4Agent: async () => { await ensure(); return evm.ox4Agent() },
          ox4PerpRead: evm.ox4PerpRead,
          ox4PerpWrite: async (...a: Parameters<typeof evm.ox4PerpWrite>) => { await ensure(); return evm.ox4PerpWrite(...a) },
          ox4PerpSession: { status: evm.ox4PerpSession.status, end: evm.ox4PerpSession.end, start: async () => { await ensure(); return evm.ox4PerpSession.start() } },
        })
        const btc = acc.btcAddress ? gatedBtcSigner(acc.btcAddress, () => realBtc, ensure) : null
        // DMs: don't decrypt while the extension is locked (it would pop the unlock window) — throw DmLocked, and the UI says "view after unlocking"; encryption / public keys are only used when the user sends a DM, asking the extension as usual (locked pops unlock)
        const xdm = extensionDm(p)
        const dm: DmCrypto = { publicKey: xdm.publicKey, encrypt: xdm.encrypt, decrypt: (x) => (get().keysUnlocked ? xdm.decrypt(x) : Promise.reject(new DmLocked())) }
        // ensureUnlocked elsewhere (perps, gas, Bitcoin, …) also defers to the extension for unlocking
        setExternalUnlock(ensure)
        set({ vault: null, wallet, evmAccount, btc, dm, address: acc.address, evmAddress: acc.evmAddress, btcAddress: acc.btcAddress || null, keysUnlocked: !locked, kind: 'ox4', external: null })
      },

      setExtensionLocked(locked) {
        if (get().kind !== 'ox4' || get().keysUnlocked === !locked) return
        if (locked) notifyLock()   // The perps trading-key cache is cleared along with it (lib/aster.ts onLock)
        set({ keysUnlocked: !locked })
      },

      detachExtension() {
        realSol = null
        realEvm = null
        realBtc = null
        setExternalUnlock(null)
        notifyLock()   // The perps trading-key cache is cleared along with it (lib/aster.ts onLock)
        // Both 0x4 extension and external wallet disconnects come through here
        set({ vault: null, wallet: null, evmAccount: null, btc: null, dm: null, address: null, evmAddress: null, btcAddress: null, keysUnlocked: false, kind: null, external: null })
      },

      async createWallet(password) {
        if (nativeVault) {
          const info = await Vault.create({ password })
          set(fromNative(info, null))
          return info.mnemonic || ''
        }
        const mnemonic = newMnemonic()
        const vault = await buildVault(keypairFromMnemonic(mnemonic), evmKeyFromMnemonic(mnemonic), password, mnemonic)
        const u = await unlockVault(vault, password)
        set(fromLocal(u.upgraded ?? vault, u.keypair, u.evm, u.btcKey))
        return mnemonic
      },

      async importMnemonic(mnemonic, password) {
        if (nativeVault) {
          set(fromNative(await Vault.importMnemonic({ mnemonic, password }), null))
          return
        }
        const vault = await buildVault(keypairFromMnemonic(mnemonic), evmKeyFromMnemonic(mnemonic), password, mnemonic)
        const u = await unlockVault(vault, password)
        set(fromLocal(u.upgraded ?? vault, u.keypair, u.evm, u.btcKey))
      },

      async importSecret(secret, password) {
        if (nativeVault) {
          set(fromNative(await Vault.importSecret({ secret, password }), null))
          return
        }
        // With only one private key, the other side is deterministically derived from it (lib/wallet.ts "import private key", same rule as the native Keyring):
        //   The same private key imported on any number of devices is always the same 0x4 account. It used to be randomly generated — every import was a new account,
        //   Sprites, friends, and chats would all be lost (2026-09-29 goat hit this: "not acceptable").
        //   EVM private keys supported since 2026-09-25; previously only Solana was accepted, and pasting a 0x EVM private key reported the English "Non-base58 character"
        const kind = classifySecret(secret)
        if (!kind) throw new Error(t('私钥格式不对。请粘贴 EVM 私钥（0x 开头）或 Solana 私钥'))
        let vault: VaultData
        if (kind === 'evm') {
          const evmKey = normalizeEvmKey(secret)
          vault = await buildVault(keypairFromEvmKey(evmKey), evmKey, password)
        } else {
          const kp = keypairFromSecret(secret)
          vault = await buildVault(kp, evmKeyFromKeypair(kp), password)
        }
        const u = await unlockVault(vault, password)
        set(fromLocal(u.upgraded ?? vault, u.keypair, u.evm, u.btcKey))
      },

      async unlock(password) {
        const { vault } = get()
        if (!vault) throw new Error(t('没有钱包'))
        if (nativeVault) {
          set(fromNative(await Vault.unlock({ password }), vault))
          return
        }
        const u = await unlockVault(vault, password)
        const v = u.upgraded ?? vault // Legacy vault writes back after auto-upgrade
        set(fromLocal(v, u.keypair, u.evm, u.btcKey))
      },

      /** iOS: the password travels from Keychain to vault entirely in native code — the web layer never touches it. Android: native verifies the fingerprint and hands the password back; unlock proceeds here as usual */
      async unlockWithBiometric(reason) {
        if (nativeVault) {
          set(fromNative(await Vault.unlockWithBiometric({ reason }), get().vault))
          return
        }
        if (!biometricAndroid) throw new Error(t('当前设备不支持'))
        const password = await androidBiometric.retrieve(reason)
        try { await get().unlock(password) } catch {
          // The stored password can't unlock the vault (wallet was reset and the password changed, etc.) — void it and have the user start over
          await androidBiometric.clear()
          throw new BiometricInvalidated(t('生物识别已失效'))
        }
      },

      lock() {
        if (nativeVault) void Vault.lock()
        realSol = null
        realEvm = null
        realBtc = null
        notifyLock()
        // Native app: only take back signing ability, keep the shell and DM key; web: clear everything
        const { address, evmAddress, btcAddress, dm } = get()
        set(exposed(address, evmAddress, btcAddress, dm))
      },

      reset() {
        unregisterPush() // Send it while the social login token is still valid
        if (nativeVault) void Vault.reset()
        if (biometricAndroid) void androidBiometric.clear()
        void secureStore.remove('social-token')
        void secureStore.remove('dm-key')
        // Delete on-device chat history together with the media cache; the on-device chat key is voided
        void secureStore.remove('chat-key')
        void import('@/lib/localChat').then((m) => m.forgetChatKey())
        void import('@/lib/idb').then((m) => m.dropDb())
        realSol = null
        realEvm = null
        realBtc = null
        shells = null
        btcShell = null
        notifyLock()
        set({ vault: null, wallet: null, evmAccount: null, btc: null, dm: null, address: null, evmAddress: null, btcAddress: null, keysUnlocked: false })
      },

      async revealMnemonic(password) {
        const { vault } = get()
        if (!vault?.mnemonic) return null
        if (nativeVault) return (await Vault.exportMnemonic({ password })).mnemonic || null
        await unlockVault(vault, password) // Verify the password first
        return decryptText(vault.mnemonic, password)
      },

      async revealSecret(password) {
        const { vault } = get()
        if (!vault) throw new Error(t('没有钱包'))
        if (nativeVault) return (await Vault.exportSolanaSecret({ password })).secret
        return exportSecretBase58((await unlockVault(vault, password)).keypair)
      },

      async revealEvmKey(password) {
        const { vault } = get()
        if (!vault?.evmSecret) throw new Error(t('没有 EVM 私钥'))
        if (nativeVault) return (await Vault.exportEvmKey({ password })).secret
        await unlockVault(vault, password)
        return decryptText(vault.evmSecret, password)
      },

      async revealBtcWif(password) {
        const { vault } = get()
        if (!vault) throw new Error(t('没有钱包'))
        if (nativeVault) return (await Vault.exportBtcWif({ password })).secret
        const u = await unlockVault(vault, password)
        if (!u.btcKey) throw new Error(t('比特币密钥不可用'))
        return btcWif(u.btcKey)
      },

      async enableBiometric(password) {
        if (nativeVault) { await Vault.enableBiometric({ password }); return }
        if (!biometricAndroid) throw new Error(t('当前设备不支持'))
        const { vault } = get()
        if (!vault) throw new Error(t('没有钱包'))
        await unlockVault(vault, password) // Verify the password first — a wrong password can't be stored
        await androidBiometric.store(password)
      },

      async disableBiometric() {
        if (nativeVault) { await Vault.disableBiometric(); return }
        if (biometricAndroid) await androidBiometric.clear()
      },
    }),
    {
      name: '0x4.wallet', // Key names after the 2026-09-25 brand rename; old data is migrated over by lib/storageMigrate at startup
      // Only the vault is persisted; private keys never touch disk
      partialize: (s) => ({ vault: s.vault }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Web doesn't use the in-browser vault (wallets only connect via the 0x4 browser extension, 2026-09-29 goat): old vaults stored locally are not recognized
        if (WEB_SURFACE) { state.vault = null; state.address = null; state.evmAddress = null; state.btcAddress = null; return }
        state.address = state.vault?.publicKey ?? null
        state.evmAddress = state.vault?.evmAddress ?? null
        state.btcAddress = state.vault?.btcAddress ?? null
        const vault = state.vault
        if (!vault) return
        // Hydration happens synchronously inside create(), when useWallet isn't assigned yet — so defer the setState into a microtask
        if (nativeVault) {
          // Hand the vault ciphertext to native for safekeeping; unlocking and signing happen over there from then on; native also restores the DM key from the Keychain on the way
          void Vault.load({ vault: JSON.stringify(vault) }).then((info) => useWallet.setState(fromNative(info, vault)))
          return
        }
        if (!persistentSession) return
        // Android: mount the shell first, then read the DM private key back from on-device encrypted storage (only use it if it's this wallet's)
        queueMicrotask(() => useWallet.setState(exposed(vault.publicKey, vault.evmAddress ?? null, vault.btcAddress ?? null, null)))
        void secureStore.get('dm-key').then((raw) => {
          if (!raw) return
          try {
            const saved = JSON.parse(raw) as { address: string; key: string }
            if (saved.address !== vault.publicKey) return
            const { address, evmAddress, btcAddress } = useWallet.getState()
            useWallet.setState(exposed(address, evmAddress, btcAddress, localDmFromKey(dmKeyFromB64(saved.key))))
          } catch { /* Bad data: treat as absent; the next unlock rewrites it */ }
        })
      },
    },
  ),
)

setUnlockedCheck(() => useWallet.getState().keysUnlocked)
