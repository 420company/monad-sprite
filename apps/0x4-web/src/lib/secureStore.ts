// 本机安全存储：iOS 钥匙串 / Android Keystore 加密。只给原生 App 用，网页版没有（返回空、写入忽略）。
//
// 能存的条目由原生白名单限定：
//   social-token  社交登录令牌（iOS / Android）
//   dm-key        私信私钥（仅 Android；iOS 的私信密钥在原生模块里自己管，网页层碰不到）
//   chat-key      本机聊天记录的加密密钥（「只存在这台手机」模式，见 lib/localChat.ts）
import { registerPlugin } from '@capacitor/core'
import { isNative, platform } from '@/lib/native'
import { Vault } from '@/lib/vault/native'

type Key = 'social-token' | 'dm-key' | 'chat-key'

const Android = registerPlugin<{
  get(o: { key: Key }): Promise<{ value?: string }>
  set(o: { key: Key; value: string }): Promise<void>
  remove(o: { key: Key }): Promise<void>
}>('SecureStore')

/** 这个运行环境能不能「关了 App 再开还保持登录」 */
export const persistentSession = isNative && (platform === 'ios' || platform === 'android')

export const secureStore = {
  async get(key: Key): Promise<string | null> {
    if (!persistentSession) return null
    try {
      const r = platform === 'ios' ? await Vault.secureGet({ key }) : await Android.get({ key })
      return r.value ?? null
    } catch { return null }
  },
  async set(key: Key, value: string): Promise<void> {
    if (!persistentSession) return
    try { await (platform === 'ios' ? Vault.secureSet({ key, value }) : Android.set({ key, value })) } catch { /* 存不上就下次重新登录 */ }
  },
  async remove(key: Key): Promise<void> {
    if (!persistentSession) return
    try { await (platform === 'ios' ? Vault.secureRemove({ key }) : Android.remove({ key })) } catch { /* ignore */ }
  },
}
