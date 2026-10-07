// My-profile edit sheet: nickname, username, bio; avatar must be a chain-verified NFT (default pixel avatar otherwise)
import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Button from './Button'
import Avatar from './Avatar'
import NftPickerSheet from './NftPickerSheet'
import { Input, Label, Textarea } from './Field'
import { toast } from './Toast'
import { useSocial, displayName } from '@/store/social'
import { useWallet } from '@/store/wallet'
import { api } from '@/lib/social'
import { t } from '@/lib/i18n'
import { nameError } from '@/lib/names'
import { errorText } from '@/lib/errors'

/** Default nickname from old servers (EVM address first-5/last-3 with "…"): also treated as unnamed */
const isLegacyDefault = (p: { nickname?: string | null; evmAddress?: string | null } | null | undefined) =>
  !!p?.nickname && !!p.evmAddress && p.evmAddress.length === 42 && p.nickname === `${p.evmAddress.slice(0, 5)}…${p.evmAddress.slice(-3)}`

export default function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, updateProfile } = useSocial()
  const { address, evmAddress } = useWallet()
  // A still-default nickname (User + number) isn't prefilled into the input — placeholder only (2026-09-29 goat: prefilled defaults used to fail validation with "…", blocking even the username save).
  // Saving empty = keep the default nickname; format checked only when the user typed a nickname
  const ownNick = (p: typeof me) => (p?.nickname && p.nickname !== p.defaultNickname && !isLegacyDefault(p) ? p.nickname : '')
  const [nickname, setNickname] = useState(ownNick(me))
  const nickBad = nickname.trim() && nickname.trim() !== ownNick(me) ? nameError(nickname.trim(), true) : null
  const [handle, setHandle] = useState(me?.handle || '')
  const [bio, setBio] = useState(me?.bio || '')
  const [busy, setBusy] = useState(false)
  const [handleErr, setHandleErr] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  useEffect(() => { if (open) { setNickname(ownNick(me)); setHandle(me?.handle || ''); setBio(me?.bio || ''); setHandleErr(null) } }, [open, me]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (nickBad) return toast.error(nickBad)
    setBusy(true)
    try {
      // Save the username first (unique, may be taken), then nickname and bio (2026-10-02 goat: previously the nickname saved first and then "username taken" errored,
      // making it look like the nickname was taken when it had actually saved). If the username fails, nothing saves; the error shows under the username field
      if (handle.trim() && handle.trim().toLowerCase() !== me?.handle) {
        try { await api('/api/me/handle', { method: 'PUT', body: JSON.stringify({ handle: handle.trim() }) }) }
        catch (e) { setHandleErr(errorText(e, t('用户名没有保存'))); return }
      }
      await updateProfile({ nickname: nickname.trim(), bio })   // Empty = use the default nickname
      // Previously the local profile wasn't refreshed after saving the username — reopening showed the old value, looking "unsaved" (2026-09-25 goat feedback)
      await useSocial.getState().refreshMe()
      toast.success(t('已保存')); onClose()
    } catch (e) { toast.error(errorText(e, t('保存失败'))) } finally { setBusy(false) }
  }
  const clearNft = async () => { try { await api('/api/me/avatar-nft', { method: 'DELETE' }); await useSocial.getState().refreshMe(); toast.success(t('已恢复默认像素头像')) } catch (e) { toast.error(errorText(e, t('失败'))) } }

  return (
    <Sheet open={open} onClose={onClose} title={t('我的资料')}>
      <div className="flex items-center gap-3">
        <Avatar address={address || 'anon'} src={me?.avatar} name={nickname} size={64} chainId={me?.avatarNft?.chainId} />
        <div className="min-w-0 flex-1 text-xs text-muted">
          {me?.avatarNft && <div>{t('NFT 头像 · {name}', { name: me.avatarNft.name || me.avatarNft.contract.slice(0, 8) })}</div>}
          <div className="mt-1.5 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>{me?.avatarNft ? t('选择 NFT') : t('验证 NFT')}</Button>
            {me?.avatarNft && <Button size="sm" variant="ghost" onClick={clearNft}>{t('恢复默认')}</Button>}
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <div><Label>{t('昵称')}</Label><Input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={32} aria-invalid={!!nickBad} placeholder={me?.defaultNickname || displayName({ address: address || '', evmAddress: evmAddress || '' })} />
          <p className={`mt-1 text-xs ${nickBad ? 'text-down' : 'text-muted'}`}>{nickBad || t('最多 8 个汉字或 16 个字母数字，不能有空格和符号')}</p></div>
        <div><Label>{t('用户名（@handle，3~20 位字母数字下划线）')}</Label><Input value={handle} onChange={(e) => { setHandle(e.target.value.replace(/^@/, '')); setHandleErr(null) }} maxLength={20} spellCheck={false} autoCapitalize="off" aria-invalid={!!handleErr} />
          {handleErr && <p className="mt-1 text-xs text-down" role="alert">{handleErr}</p>}</div>
        <div><Label>{t('简介')}</Label><Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} placeholder={t('一句话介绍自己')} /></div>
        <Button size="lg" className="w-full" loading={busy} onClick={save}>{t('保存')}</Button>
      </div>
      <NftPickerSheet open={picking} onClose={() => setPicking(false)} onPicked={() => useSocial.getState().refreshMe()} />
    </Sheet>
  )
}
