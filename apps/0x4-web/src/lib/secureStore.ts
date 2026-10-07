// On-device secure storage: iOS Keychain / Android Keystore encrypted. Native app only — web has none (reads return empty, writes are ignored).
//
// Storable entries are limited by the native whitelist:
//   social-token  social login token (iOS / Android)
//   dm-key        DM private key (Android only; on iOS the DM key is managed inside the native module, the web layer never touches it)
//   chat-key      encryption key for on-device chat history ("this phone only" mode, see lib/localChat.ts)
import { registerPlugin } from '@capacitor/core'
import { isNative, platform } from '@/lib/native'
import { Vault } from '@/lib/vault/native'

type Key = 'social-token' | 'dm-key' | 'chat-key'

const Android = registerPlugin<{
  get(o: { key: Key }): Promise<{ value?: string }>
  set(o: { key: Key; value: string }): Promise<void>
  remove(o: { key: Key }): Promise<void>
}>('SecureStore')

/** Whether this runtime supports "stay logged in after closing and reopening the app" */
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
    try { await (platform === 'ios' ? Vault.secureSet({ key, value }) : Android.set({ key, value })) } catch { /* If it can't be saved, re-login next time */ }
  },
  async remove(key: Key): Promise<void> {
    if (!persistentSession) return
    try { await (platform === 'ios' ? Vault.secureRemove({ key }) : Android.remove({ key })) } catch { /* ignore */ }
  },
}
