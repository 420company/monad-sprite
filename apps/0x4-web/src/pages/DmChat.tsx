// DMs: end-to-end encrypted; the server only stores ciphertext (two copies per message: one for them, one for me); history is pulled and decrypted on-device when opened; mutual-follow friends and group admins→members can initiate
import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { BALANCE_FEATURES } from '@/lib/features'
import { useNavigate, useParams } from 'react-router-dom'
import { useRef as useRef2 } from 'react'
import { ArrowLeft, Copy, Image as ImageIcon, Keyboard, Lock, MoreHorizontal, Phone, Send, Smile, Trash2, Video, Wallet, Undo2 } from 'lucide-react'
import { useUserSafetyItems } from '@/components/UserMore'
import EmojiPicker, { useEmojiInput } from '@/components/EmojiPicker'
import MessageMenu, { useLongPress, type MenuAnchor, type MenuItem } from '@/components/MessageMenu'
import { useChatScroll } from '@/lib/useChatScroll'
import { copyText } from '@/lib/native'
import SendVoiceButton from '@/components/SendVoiceButton'
import TransferSheet from '@/components/TransferSheet'
import { DmMediaBubble } from '@/components/MediaBubble'
import { albumText, encryptAndUpload, encryptMedia, parseDmMedia, type DmMedia } from '@/lib/dmMedia'
import { PendingMediaRow, UploadingToast } from '@/components/MediaGrid'
import { pickMediaFiles, MAX_PICK } from '@/lib/multiMedia'
import { usePendingMedia } from '@/lib/usePendingMedia'
import Avatar from '@/components/Avatar'
import { toast } from '@/components/Toast'
import { api, type DmMessage, type Profile } from '@/lib/social'
import { useSocial, displayName } from '@/store/social'
import { useCall } from '@/store/call'
import { shortId } from '@/lib/format'
import XBadge from '@/components/XBadge'
import { locale, t } from '@/lib/i18n'
import { cleanDmText } from '@/lib/sysText'
import UserName from '@/components/UserName'
import { useBack } from '@/lib/useBack'
import { errorText } from '@/lib/errors'
import { ensureUnlocked } from '@/lib/vault/gate'

/** Unsend window: within 2 minutes of sending */
const RECALL_MS = 2 * 60_000

export default function DmChat() {
  const { address = '' } = useParams()
  const nav = useNavigate()
  // Back: go back if there is a previous page (its state / scroll get restored); push / deep-link opens go to /community
  const back = useBack('/community')
  const { me, dms, dmHasMore, sendDm, markDmRead, loadDmHistory, deleteDm, clearDm, status, chatMode } = useSocial()
  const [peer, setPeer] = useState<Profile | null>(null)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  // Can't DM because the group has "block member DMs" on (2026-09-29, the server's /api/dm/can locked)
  const [dmLocked, setDmLocked] = useState(false)
  const [text, setText] = useState('')
  const emoji = useEmojiInput<HTMLTextAreaElement>(text, setText)
  const bottom = useRef<HTMLDivElement>(null)
  const fileInput = useRef2<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [transfer, setTransfer] = useState(false)
  // Voice: encrypted on-device → ciphertext uploaded → the key travels to the other side inside an encrypted DM (a small floating indicator mid-screen while uploading)
  const sendVoice = async (file: Blob, duration: number) => {
    if (!peer?.encPub) return toast.error(t('对方还没有登录过，无法建立加密通道'))
    setUploading(true)
    try { const text = await encryptAndUpload(file, 'voice', duration); await sendDm(address, peer.encPub, text) } catch (e) { toast.error(errorText(e, t('发送失败'))) } finally { setUploading(false) }
  }
  // Images / videos: appear at the bottom as "sending" right after picking; each encrypted and uploaded separately (max 3 at a time), then combined into one encrypted DM once all finish
  const media = usePendingMedia<DmMedia>({
    upload: (f, onProgress) => encryptMedia(f.file, f.kind, { onProgress }),
    send: async (_album, results) => {
      if (!peer?.encPub) throw new Error(t('对方还没有登录过，无法建立加密通道'))
      await sendDm(address, peer.encPub, albumText(results))
      return 'done'
    },
  })
  const pickMedia = (files: FileList | null) => {
    const { files: picked, truncated } = pickMediaFiles(files)
    if (fileInput.current) fileInput.current.value = ''
    if (!picked.length) return
    if (!peer?.encPub) { toast.error(t('对方还没有登录过，无法建立加密通道')); return }
    if (truncated) toast.error(t('最多选 {n} 张', { n: MAX_PICK }))
    media.start(picked)
  }
  const list = dms[address] || []
  const loadOlder = useCallback(() => loadDmHistory(address, true), [address, loadDmHistory])
  const scrollList = useMemo(() => (media.list.length ? [...list, ...media.list.map((a) => ({ id: a.id, from: me?.address || '' }))] : list), [list, media.list, me?.address])
  const { box, onScroll, loadingOlder } = useChatScroll(scrollList, !!dmHasMore[address], loadOlder, me?.address)
  // Long-press bubble / top-right more: step=delete picks the delete scope; target=all means clear the whole conversation
  const [menu, setMenu] = useState<{ m: DmMessage | 'all'; anchor: MenuAnchor; step: 'main' | 'delete' } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (status !== 'ready') return
    api<{ allowed: boolean; locked?: boolean; peer: Profile }>(`/api/dm/can/${address}`).then((r) => { setAllowed(r.allowed); setDmLocked(!!r.locked); setPeer(r.peer) }).catch((e) => toast.error(errorText(e, t('加载失败'))))
    // Ciphertext records on the server, decrypted on-device
    loadDmHistory(address).catch(() => {})
    markDmRead(address)
  }, [address, status, markDmRead, loadDmHistory])

  useEffect(() => { markDmRead(address) }, [list.length, address, markDmRead])

  const remove = async (target: DmMessage | 'all', scope: 'all' | 'me') => {
    setMenu(null)
    try {
      if (target === 'all') { await clearDm(address, scope); toast.success(t('已清空')) }
      else await deleteDm(address, target.id, scope)
    } catch (e) { toast.error(errorText(e, t('删除失败'))) }
  }
  // Top-right menu's "Report" and "Block / Unblock" (DMs are encrypted — the user describes the situation themselves when reporting)
  const safetyItems = useUserSafetyItems(address, peer ? displayName(peer) : undefined, () => setMenu(null), 'dm')
  const menuItems = (): MenuItem[] => {
    if (!menu) return []
    const target = menu.m
    if (menu.step === 'delete') return [
      { key: 'me', label: t('只删除我这边'), danger: true, onSelect: () => void remove(target, 'me') },
      { key: 'all', label: t('为双方删除'), danger: true, onSelect: () => void remove(target, 'all') },
    ]
    if (target === 'all') return [...safetyItems, { key: 'clear', label: t('清空聊天记录'), icon: <Trash2 size={17} />, danger: true, onSelect: () => setMenu({ ...menu, step: 'delete' }) }]
    const plain = !target.legacy && !target.undecryptable && !parseDmMedia(target.text)
    // Unsend: own messages, within 2 minutes, deleted on both sides with no "unsent" trace (2026-09-25 goat: traceless unsend)
    const recallable = target.from === me?.address && Date.now() - target.ts < RECALL_MS
    return [
      ...(recallable ? [{ key: 'recall', label: t('撤回'), icon: <Undo2 size={17} />, onSelect: () => { setMenu(null); deleteDm(address, target.id, 'all').then(() => toast.success(t('已撤回'))).catch((e) => toast.error(errorText(e, t('撤回失败')))) } }] : []),
      ...(plain ? [{ key: 'copy', label: t('复制'), icon: <Copy size={17} />, onSelect: () => { setMenu(null); copyText(target.text).then(() => toast.success(t('已复制'))).catch(() => toast.error(t('复制失败'))) } }] : []),
      { key: 'del', label: t('删除'), icon: <Trash2 size={17} />, danger: true, onSelect: () => setMenu({ ...menu, step: 'delete' }) },
    ]
  }
  const openMore = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ m: 'all', anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, step: 'main' })
  }

  const send = async () => {
    const msg = text.trim()
    if (!msg || !peer) return
    if (!peer.encPub) return toast.error(t('对方还没有登录过，无法建立加密通道'))
    try { await sendDm(address, peer.encPub, msg); setText(''); emoji.dismiss() } catch (e) { toast.error(errorText(e, t('发送失败'))) }
  }

  return (
    <div className="safe-top flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button onClick={back} className="rounded-full p-2 text-muted"><ArrowLeft size={22} /></button>
        <Avatar address={address} src={peer?.avatar} name={peer?.nickname} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1"><UserName address={address} name={peer ? displayName(peer) : shortId(address)} className="truncate font-bold" /><XBadge address={address} /></div>
          <div className="flex items-center gap-1 text-[11px] text-muted"><Lock size={10} /> {t('端到端加密')}</div>
        </div>
        {/* Voice / video calls: same access rule as DMs — shown for friends only */}
        {allowed && <>
          <button onClick={() => void useCall.getState().startCall({ address, nickname: peer?.nickname, avatar: peer?.avatar }, false)} className="icon-button" aria-label={t('语音通话')}><Phone size={21} /></button>
          <button onClick={() => void useCall.getState().startCall({ address, nickname: peer?.nickname, avatar: peer?.avatar }, true)} className="icon-button" aria-label={t('视频通话')}><Video size={22} /></button>
        </>}
        <button onClick={openMore} className="icon-button" aria-label={t('更多')} aria-haspopup="menu"><MoreHorizontal size={21} /></button>
      </header>
      <div className="relative min-h-0 flex-1">
      {loadingOlder && <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center" role="status"><span className="toast-solid rounded-full border border-line px-3 py-1 text-[11px] text-muted">{t('加载中…')}</span></div>}
      <div ref={box} onScroll={onScroll} onClick={emoji.dismiss} className="h-full overflow-y-auto px-3 py-3">
        {/* Web 0x4 extension locked: DMs aren't decrypted yet (decryption needs the extension unlocked); tapping "Unlock" asks the extension to pop the unlock window, and history is re-pulled automatically after unlocking (store/social.ts) */}
        {list.some((m) => m.locked) && <div className="mx-auto mb-2 flex max-w-xs items-center justify-center gap-2 rounded-2xl bg-card px-4 py-2.5 text-center text-xs text-muted" role="status">{t('0x4 Wallet 已锁定，解锁后查看私信')}<button type="button" onClick={() => void ensureUnlocked(t('查看私信')).catch(() => {})} className="shrink-0 font-semibold text-accent">{t('解锁')}</button></div>}
        {allowed === false && (dmLocked
          ? <div className="mx-auto max-w-xs rounded-2xl bg-card p-4 text-center text-sm text-muted">{t('群管理员已关闭群成员私信')}<br />{t('互相关注成为好友后仍可以私聊。')}</div>
          : <div className="mx-auto max-w-xs rounded-2xl bg-card p-4 text-center text-sm text-muted">{t('互相关注成为好友后才能私聊。')}<br />{t('先关注对方，对方回关就可以聊了；群管理员可以直接私信群成员。')}</div>)}
        {allowed && !list.length && <div className="py-10 text-center text-xs text-muted">{chatMode === 'device' ? t('消息端到端加密，记录只存在这台手机。') : chatMode === 'daily' ? t('消息端到端加密，每天 00:00 自动清空。') : t('消息端到端加密，云端只保存加密内容。换手机后导入同一个钱包即可恢复。')}</div>}
        {list.map((m, i) => {
          const mine = m.from === me?.address
          // Consecutive messages (same person within 1 minute): avatar and nickname only on the first, blank space left to align afterwards
          const prev = list[i - 1]
          const grouped = !!prev && prev.from === m.from && m.ts - prev.ts < 60_000
          // Timestamps no longer sit in every bubble — a centered divider only when the gap exceeds 5 minutes (same as group chat)
          const showTime = !prev || m.ts - prev.ts > 5 * 60_000
          return (
            <Fragment key={m.id}>
            {showTime && <div className="mb-1 mt-4 text-center text-[11px] text-muted">{chatTime(m.ts)}</div>}
            <div className={`flex items-start gap-2 ${mine ? 'flex-row-reverse' : ''} ${grouped || showTime ? 'mt-1' : 'mt-3'}`}>
              {grouped ? <div className="w-8 shrink-0" /> : mine
                ? <Avatar address={m.from} src={me?.avatar} name={me?.nickname} size={32} chainId={me?.avatarNft?.chainId} />
                : <button onClick={() => nav(`/u/${address}`)} className="shrink-0"><Avatar address={address} src={peer?.avatar} name={peer?.nickname} size={32} chainId={peer?.avatarNft?.chainId} /></button>}
              <div className={`flex max-w-[75%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
              {!mine && !grouped && <div className="mb-0.5 px-1 text-[11px] text-muted"><UserName address={address} name={peer ? displayName(peer) : shortId(address)} /></div>}
              <DmBubble m={m} mine={mine} onMenu={(anchor) => setMenu({ m, anchor, step: 'main' })} />
              </div>
            </div>
            </Fragment>
          )
        })}
        {media.list.map((a) => <PendingMediaRow key={a.id} album={a} self={me} onRetry={() => media.retry(a.id)} />)}
        <div ref={bottom} />
      </div>
      {uploading && <UploadingToast />}
      </div>
      <MessageMenu anchor={menu?.anchor ?? null} items={menuItems()} note={menu?.step === 'delete' ? (menu.m === 'all' ? t('清空后无法恢复') : t('删除后无法恢复')) : undefined} onClose={closeMenu} label={t('消息操作')} />
      {allowed && (
        <div className="safe-bottom border-t border-line bar-glass px-3 pt-2 pb-2">
        {/* 2026-09-26 goat: emoji panel moved above the input (input pinned at the very bottom), no longer pushing up from under the input like a keyboard */}
        {emoji.open && <EmojiPicker className="-mx-3 mb-2" onPick={emoji.pick} onBackspace={emoji.backspace} />}
        <div className="flex items-end gap-2">
          <button onClick={() => fileInput.current?.click()} className="rounded-full bg-card p-2.5 text-muted" aria-label={t('图片或视频')}><ImageIcon size={20} /></button>
          <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pickMedia(e.target.files)} />
          {BALANCE_FEATURES && <button onClick={() => setTransfer(true)} className="rounded-full bg-card p-2.5 text-accent" aria-label={t('转账')}><Wallet size={20} /></button>}
          <textarea {...emoji.fieldProps} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} rows={1} placeholder={t('加密消息…')} className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl bg-card px-4 py-2.5 text-[15px] outline-none placeholder:text-muted" />
          <button onClick={emoji.toggle} className="rounded-full bg-card p-2.5 text-muted" aria-label={emoji.open ? t('键盘') : t('表情')} aria-expanded={emoji.open}>{emoji.open ? <Keyboard size={20} /> : <Smile size={20} />}</button>
          <SendVoiceButton canSend={!!text.trim()} onSend={send} onVoice={(b, sec) => sendVoice(b, Math.round(sec))} voiceDisabled={uploading} className="rounded-full bg-accent p-2.5 text-bg"><Send size={20} /></SendVoiceButton>
        </div>
        </div>
      )}
      {peer && <TransferSheet open={transfer} onClose={() => setTransfer(false)} to={peer} context={`dm:${address}`} onDone={(usd, note) => { if (peer.encPub) sendDm(address, peer.encPub, `转账 $${usd.toFixed(2)}${note ? '：' + note : ''}`) }} />}
    </div>
  )
}

/** DM bubbles: long-press / right-click for the menu. Undecryptable or old-version messages show in gray */
function DmBubble({ m, mine, onMenu }: { m: DmMessage; mine: boolean; onMenu: (a: MenuAnchor) => void }) {
  const press = useLongPress(onMenu)
  const flagged = m.legacy || m.undecryptable
  return (
    <div {...press} className={`max-w-full select-none rounded-2xl px-3 py-1.5 text-[15px] leading-snug [-webkit-touch-callout:none] ${mine ? 'rounded-tr-md' : 'rounded-tl-md'} ${flagged ? 'bg-card text-muted' : mine ? 'bg-accent text-bg' : 'bg-card'}`}>
      {m.locked ? <span className="text-[13px] italic">{t('解锁后查看')}</span>
        : m.undecryptable ? <span className="text-[13px] italic">{t('无法解密')}</span>
        : m.legacy ? <span className="text-[13px] italic">{t('这条消息在旧版本发送')}</span>
        : parseDmMedia(m.text) ? <DmMediaBubble text={m.text} mine={mine} /> : <span className="whitespace-pre-wrap break-words">{cleanDmText(m.text)}</span>}
    </div>
  )
}

/** Chat time dividers: today shows HH:mm only, other days include month/day */
function chatTime(ts: number) {
  const d = new Date(ts), now = new Date()
  const hm = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === now.toDateString() ? hm : `${d.toLocaleDateString(locale(), { month: 'numeric', day: 'numeric' })} ${hm}`
}
