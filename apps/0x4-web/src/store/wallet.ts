// 钱包状态。
//
// App（iOS）：私钥在原生模块 native/Ox4Vault 里（模块名沿用旧品牌，不影响用户），这里只持有地址和「签名器」句柄，
//             内存中不存在任何私钥。金库密文仍存 localStorage，启动时交给原生装载。
// 网页版：没有原生层，沿用内存里的 Keypair / 私钥账户，行为与以前一致。
//
// 2026-09-25「打开即用，动钱才验证」（仅原生 App，persistentSession）：
//   wallet / evmAccount 只要有钱包就一直在，是带闸的外壳（lib/vault/gate.ts）：
//   地址随时可用，真签名时没解锁就弹验证面板。真正的签名器放在模块变量 realSol / realEvm 里，
//   锁定只清它们，外壳和私信密钥（dm）都留着，所以锁着也能刷社交、收发私信。
//   keysUnlocked 才是「钱包解没解锁」；网页版照旧，锁定即清空一切、整页挡回解锁页。
//   ★网页版连 0x4 插件（2026-10-06 goat「睡一觉起来要重新登录」）：插件锁定不再摘掉钱包，只把 keysUnlocked 置 false
//   （setExtensionLocked）。地址、余额、社交照常；要签名时 ensure 请插件弹解锁窗口；锁着时私信不解密（DmLocked）。
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
  /** Solana 签名器（App 里不含私钥） */
  wallet: SolanaWallet | null
  evmAccount: Account | null
  /** 私信加解密 */
  dm: DmCrypto | null
  address: string | null
  evmAddress: string | null
  /** 比特币收款地址 bc1q…（老钱包第一次解锁前为空） */
  btcAddress: string | null
  /** 比特币签名器（App 里带闸，不含私钥） */
  btc: BtcSigner | null
  /** 钱包私钥是否已解锁（能不能直接签名）。网页版等同于 wallet 非空 */
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
  /** 导出比特币私钥（WIF，主网压缩） */
  revealBtcWif: (password: string) => Promise<string>
  enableBiometric: (password: string) => Promise<void>
  disableBiometric: () => Promise<void>
  /**
   * 网页版（VITE_SURFACE=web）：连上 0x4 浏览器插件后挂上它的签名器（私钥在插件里，这里只有地址和句柄）。
   * ensure：签名前检查插件还连着、没锁（锁了就请插件弹解锁），见 desktop/walletGate.ts。
   * locked：插件现在锁着（打开网页时插件已锁）：照样挂上，keysUnlocked = false
   */
  attachExtension: (p: Ox4Provider, accounts: Ox4Accounts, ensure: () => Promise<void>, locked?: boolean) => void
  /** 插件断开 / 换号（外部钱包断开也走这里）：清掉签名器，网页版回到「没连钱包」 */
  detachExtension: () => void
  /** 网页版插件锁定 / 解锁：钱包留着，只改 keysUnlocked（锁定时顺带清合约交易密钥缓存）。连的不是插件时不动 */
  setExtensionLocked: (locked: boolean) => void
  /**
   * 网页版连的是哪种钱包（2026-09-30 goat：外部钱包也能连）：'ox4' = 0x4 浏览器插件（全部功能）；
   * 'external' = MetaMask、Phantom 等（登录、社区、现货能用；合约、私信、小精灵全自动、比特币是 0x4 Wallet 专属，desktop/Ox4Only.tsx）。
   * 手机 App 恒为 null（钱包就是 App 自己）
   */
  kind: 'ox4' | 'external' | null
  /** 外部钱包的名字和图标（顶栏显示用） */
  external: Pick<WalletInfo, 'name' | 'icon' | 'rdns'> | null
  /**
   * 挂上外部钱包：EVM 地址 + EIP-1193 签名器；Phantom 另外给 Solana（没有就不能买卖 Solana 上的币）。
   * 外部钱包没有私信密钥、没有比特币、没有合约交易密钥
   */
  attachExternal: (o: { provider: Eip1193Provider; info: Pick<WalletInfo, 'name' | 'icon' | 'rdns'>; evmAddress: string; solana?: { provider: PhantomSolana; address: string } | null }) => void
}

/** 网页版连着钱包没有（0x4 插件或外部钱包都算）；手机 App 看有没有签名器 */
export const isWalletConnected = (s: Pick<WalletState, 'wallet' | 'kind'>) => !!s.wallet || s.kind === 'external'
/** 网页版现在连的是外部钱包（0x4 Wallet 专属功能要换成提示卡） */
export const isExternalWallet = (s: Pick<WalletState, 'kind'>) => s.kind === 'external'

/** 真正的签名器。锁定即清空；外壳（带闸的 wallet / evmAccount）每次签名时来这里现取 */
let realSol: SolanaWallet | null = null
let realEvm: Account | null = null
let realBtc: BtcSigner | null = null

/** 带闸外壳按地址缓存：同一个钱包始终是同一个对象，页面和合约代理密钥缓存都靠它认人 */
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
 * 按「真签名器现在是什么」算出对外的字段。
 * 原生 App：有钱包就给外壳；网页版：解锁了才给真签名器。
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

/** 原生（iOS）返回的状态 → store 字段 */
function fromNative(info: VaultInfo, prev: VaultData | null): Partial<WalletState> {
  const vault = info.vault ? (JSON.parse(info.vault) as VaultData) : prev
  const address = info.address || vault?.publicKey || null
  const evmAddress = info.evmAddress || vault?.evmAddress || null
  const btcAddress = info.btcAddress || vault?.btcAddress || null
  realSol = info.unlocked && address ? nativeSolanaWallet(address) : null
  realEvm = info.unlocked && evmAddress ? nativeEvmAccount(evmAddress) : null
  realBtc = info.unlocked && btcAddress ? nativeBtcSigner(btcAddress) : null
  // 私信在原生里做；钱包锁着但钥匙串里的私信密钥装回来了也能用（没装回来时调用会报「已锁定」）
  return { vault, ...exposed(address, evmAddress, btcAddress, vault ? nativeDm() : null) }
}

/** 网页层持有私钥（网页版、Android）：解锁后装上真签名器；Android 顺手把私信私钥存进本机加密存储 */
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
        // 外部钱包：签名都在它自己那里弹窗确认，网页没有「锁定」的概念，不套带闸外壳
        realSol = solana ? phantomSolanaWallet(solana.provider, solana.address) : null
        realEvm = eip1193Account(provider, evmAddress, info.name)
        realBtc = null
        set({ vault: null, wallet: realSol, evmAccount: realEvm, btc: null, dm: null, address: solana?.address ?? null, evmAddress, btcAddress: null, keysUnlocked: true, kind: 'external', external: { name: info.name, icon: info.icon, rdns: info.rdns } })
      },

      attachExtension(p, acc, ensure, locked = false) {
        // 真签名器 = 插件适配层；对外给带闸外壳（签名前先过 ensure），外壳上补上登录签名和合约交易密钥两个插件专用能力
        const sol = extensionSolanaWallet(p, acc.address)
        const evm = extensionEvmAccount(p, acc.evmAddress)
        realSol = sol
        realEvm = evm
        realBtc = acc.btcAddress ? extensionBtcSigner(p, acc.btcAddress) : null
        const wallet = Object.assign(gatedSolanaWallet(acc.address, () => realSol, ensure), { signLogin: async (m: string, evmLink?: string) => { await ensure(); return sol.signLogin(m, evmLink) } })
        // ox4PerpRead（合约只读查询，插件代办）不过 ensure：那是页面定时刷新，插件锁着就回 4900，不能因此弹解锁窗口。
        // ox4PerpWrite（合约写操作，插件代办）是用户操作，先过 ensure（锁着先请插件解锁）；快捷交易状态查询不过 ensure
        const evmAccount = Object.assign(gatedEvmAccount(acc.evmAddress, () => realEvm, ensure), {
          ox4Agent: async () => { await ensure(); return evm.ox4Agent() },
          ox4PerpRead: evm.ox4PerpRead,
          ox4PerpWrite: async (...a: Parameters<typeof evm.ox4PerpWrite>) => { await ensure(); return evm.ox4PerpWrite(...a) },
          ox4PerpSession: { status: evm.ox4PerpSession.status, end: evm.ox4PerpSession.end, start: async () => { await ensure(); return evm.ox4PerpSession.start() } },
        })
        const btc = acc.btcAddress ? gatedBtcSigner(acc.btcAddress, () => realBtc, ensure) : null
        // 私信：插件锁着时不去解密（会弹解锁窗口），抛 DmLocked，界面写「解锁后查看」；加密 / 公钥是用户发私信时才用，照常请插件（锁着会弹解锁）
        const xdm = extensionDm(p)
        const dm: DmCrypto = { publicKey: xdm.publicKey, encrypt: xdm.encrypt, decrypt: (x) => (get().keysUnlocked ? xdm.decrypt(x) : Promise.reject(new DmLocked())) }
        // 别处的 ensureUnlocked（合约、燃料费、比特币……）也交给插件解锁
        setExternalUnlock(ensure)
        set({ vault: null, wallet, evmAccount, btc, dm, address: acc.address, evmAddress: acc.evmAddress, btcAddress: acc.btcAddress || null, keysUnlocked: !locked, kind: 'ox4', external: null })
      },

      setExtensionLocked(locked) {
        if (get().kind !== 'ox4' || get().keysUnlocked === !locked) return
        if (locked) notifyLock()   // 合约交易密钥缓存跟着清（lib/aster.ts onLock）
        set({ keysUnlocked: !locked })
      },

      detachExtension() {
        realSol = null
        realEvm = null
        realBtc = null
        setExternalUnlock(null)
        notifyLock()   // 合约交易密钥缓存跟着清（lib/aster.ts onLock）
        // 0x4 插件和外部钱包断开都走这里
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
        // 只有一种私钥时，另一侧由这把私钥固定算出（lib/wallet.ts「私钥导入」，和原生 Keyring 同一规则）：
        //   同一把私钥在任何设备导入多少次都是同一个 0x4 账号。以前随机生成，每导入一次就是一个新账号，
        //   小精灵、好友、聊天全丢（2026-09-29 goat 踩到，「这个不行」）。
        //   2026-09-25 起支持 EVM 私钥，以前只认 Solana，粘 0x 开头的 EVM 私钥会报英文「Non-base58 character」
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
        const v = u.upgraded ?? vault // 旧版金库自动升级后回写
        set(fromLocal(v, u.keypair, u.evm, u.btcKey))
      },

      /** iOS：密码从钥匙串到金库全程在原生，网页层碰不到。Android：原生验过指纹交回密码，这里照常解锁 */
      async unlockWithBiometric(reason) {
        if (nativeVault) {
          set(fromNative(await Vault.unlockWithBiometric({ reason }), get().vault))
          return
        }
        if (!biometricAndroid) throw new Error(t('当前设备不支持'))
        const password = await androidBiometric.retrieve(reason)
        try { await get().unlock(password) } catch {
          // 存的密码解不开金库（钱包被重置后换了密码等），作废让用户重开
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
        // 原生 App：只收回签名能力，外壳和私信密钥留着；网页版：全清
        const { address, evmAddress, btcAddress, dm } = get()
        set(exposed(address, evmAddress, btcAddress, dm))
      },

      reset() {
        unregisterPush() // 要趁社交层登录令牌还在时发出去
        if (nativeVault) void Vault.reset()
        if (biometricAndroid) void androidBiometric.clear()
        void secureStore.remove('social-token')
        void secureStore.remove('dm-key')
        // 本机聊天记录和媒体缓存一起删掉，本机聊天密钥作废
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
        await unlockVault(vault, password) // 先验证密码
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
        await unlockVault(vault, password) // 先验证密码，错的密码不能存
        await androidBiometric.store(password)
      },

      async disableBiometric() {
        if (nativeVault) { await Vault.disableBiometric(); return }
        if (biometricAndroid) await androidBiometric.clear()
      },
    }),
    {
      name: '0x4.wallet', // 2026-09-25 品牌改名后的键名，老数据由 lib/storageMigrate 启动时搬过来
      // 只持久化金库，私钥永远不落盘
      partialize: (s) => ({ vault: s.vault }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // 网页版不用浏览器内金库（钱包只连 0x4 浏览器插件，2026-09-29 goat）：本机存着的旧金库不认
        if (WEB_SURFACE) { state.vault = null; state.address = null; state.evmAddress = null; state.btcAddress = null; return }
        state.address = state.vault?.publicKey ?? null
        state.evmAddress = state.vault?.evmAddress ?? null
        state.btcAddress = state.vault?.btcAddress ?? null
        const vault = state.vault
        if (!vault) return
        // 注水在 create() 内同步发生，那时 useWallet 还没赋值，所以放到微任务里再 setState
        if (nativeVault) {
          // 把金库密文交给原生保管，之后解锁、签名都在那边做；原生顺便从钥匙串装回私信密钥
          void Vault.load({ vault: JSON.stringify(vault) }).then((info) => useWallet.setState(fromNative(info, vault)))
          return
        }
        if (!persistentSession) return
        // Android：外壳先挂上，私信私钥从本机加密存储里读回来（是这个钱包的才用）
        queueMicrotask(() => useWallet.setState(exposed(vault.publicKey, vault.evmAddress ?? null, vault.btcAddress ?? null, null)))
        void secureStore.get('dm-key').then((raw) => {
          if (!raw) return
          try {
            const saved = JSON.parse(raw) as { address: string; key: string }
            if (saved.address !== vault.publicKey) return
            const { address, evmAddress, btcAddress } = useWallet.getState()
            useWallet.setState(exposed(address, evmAddress, btcAddress, localDmFromKey(dmKeyFromB64(saved.key))))
          } catch { /* 坏数据：当作没有，下次解锁会重写 */ }
        })
      },
    },
  ),
)

setUnlockedCheck(() => useWallet.getState().keysUnlocked)
