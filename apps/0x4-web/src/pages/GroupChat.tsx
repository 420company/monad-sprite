// Group chat: realtime messages + server chat history (scroll up to load earlier), long-press menu (reply / copy / delete), member management, tips, admin DMs
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BALANCE_FEATURES } from '@/lib/features'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, AtSign, BarChart3, Megaphone, MicOff, Settings2, ChevronRight, Copy, Flag, Gift, Image as ImageIcon, Keyboard, Lock, MessageSquareLock, Plus, Reply, Send, Smile, Trash2, UserPlus, Users, Video, Wallet, X, Undo2 } from 'lucide-react'
import { useBlocks } from '@/lib/safety'
import EmojiPicker, { useEmojiInput } from '@/components/EmojiPicker'
import MessageMenu, { useLongPress, type MenuAnchor, type MenuItem } from '@/components/MessageMenu'
import { useChatScroll } from '@/lib/useChatScroll'
import { copyText } from '@/lib/native'
import { Pager, usePager } from '@/components/ListState'
import Button from '@/components/Button'
import Sheet from '@/components/Sheet'
import Avatar from '@/components/Avatar'
import TokenLogo from '@/components/TokenLogo'
import PriceChange from '@/components/PriceChange'
import TradeSheet, { type Side } from '@/components/TradeSheet'
import GiftSheet from '@/components/GiftSheet'
import RedPacketSheet from '@/components/RedPacketSheet'
import GateSheet from '@/components/GateSheet'
import OfficialBadge from '@/components/OfficialBadge'
import SendVoiceButton from '@/components/SendVoiceButton'
import TransferSheet from '@/components/TransferSheet'
import CreditPacketBubble from '@/components/CreditPacketBubble'
import { GroupMedia, GroupAlbum, groupAlbumOf } from '@/components/MediaBubble'
import { PendingMediaRow, UploadingToast } from '@/components/MediaGrid'
import { pickMediaFiles, MAX_PICK } from '@/lib/multiMedia'
import { usePendingMedia } from '@/lib/usePendingMedia'
import { compressForUpload } from '@/lib/imageCompress'
import { primeMediaUrl } from '@/lib/mediaCache'
import { absUrl } from '@/lib/postImage'
import PacketBubble, { type PacketInfo } from '@/components/PacketBubble'
import { PollBubble, PollSheet } from '@/components/PollBubble'
import { api, uploadFile, SOCIAL_API, type GroupMeeting } from '@/lib/social'
import { toast } from '@/components/Toast'
import { useSocial, displayName, type GroupAlbumItem } from '@/store/social'
import { chainById, chainName, sameAddr } from '@/lib/chains'
import { fmtAmount, fmtUsd, shortId } from '@/lib/format'
import { getTokens, marketKey, SOL_MINT } from '@/lib/market'
import { useMarket } from '@/store/market'
import { usePortfolio } from '@/store/portfolio'
import type { ChatMessage, Member, Profile } from '@/lib/social'
import { useStaffRole } from '@/lib/staff'
import XBadge from '@/components/XBadge'
import GroupRoleBadge from '@/components/GroupRoleBadge'
import { GiftIcon } from '@/components/gifts'
import { renderSysMessage } from '@/lib/sysText'
import { locale, t } from '@/lib/i18n'
import UserName from '@/components/UserName'
import { useBack } from '@/lib/useBack'
import { errorText } from '@/lib/errors'

/** Unsend window: within 2 minutes of sending */
const RECALL_MS = 2 * 60_000

export default function GroupChat() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  // Back: go back if there is a previous page (its state / scroll get restored); push / deep-link opens go to /community
  const back = useBack('/community')
  const { status, me, details, messages, roomOnline, polls, groupHasMore, loadGroup, loadGroupHistory, deleteGroupMessage, enterRoom, exitRoom, sendMessage, sendImage, joinGroup, leaveGroup, setRole, kick, setPoll, setActiveGroup } = useSocial()
  const [requests, setRequests] = useState<{ address: string; evmAddress?: string | null; message: string | null; nickname: string | null; avatar: string | null }[]>([])
  const [requestsOpen, setRequestsOpen] = useState(false)
  const group = details[id]
  // Member sheet shows at most 30 per page
  const memberPager = usePager(group?.members, { reset: id })
  // Only group members see the chat history (2026-09-29 goat): not joined, or already left — even locally cached messages are hidden
  // Messages from people I blocked don't show on my side (2026-10-02 listing requirement; the server still forwards them, others can see)
  const blockedList = useBlocks((s) => s.list)
  const allList = group?.role ? (messages[id] || []) : []
  const list = useMemo(() => blockedList.length ? allList.filter((m) => !blockedList.some((b) => b.address === m.from)) : allList, [allList, blockedList])
  const [text, setText] = useState('')
  const emoji = useEmojiInput<HTMLTextAreaElement>(text, setText)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [showMembers, setShowMembers] = useState(false)
  const [tipTarget, setTipTarget] = useState<Member | null | 'any'>(null)
  const [memberAction, setMemberAction] = useState<Member | null>(null)
  // Platform staff (admins / support in the lord backend — what goat calls MOD): can toggle "block member DMs" and DM group members
  const staffRole = useStaffRole()
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [packetOpen, setPacketOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reports, setReports] = useState<{ id: number; reporter: string; target: string; reason: string; text: string; created_at: number }[]>([])
  const [uploading, setUploading] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [trade, setTrade] = useState<Side | null>(null)
  const [quoteFailed, setQuoteFailed] = useState(false)
  const { cache, put } = useMarket()
  const holdings = usePortfolio(s => s.holdings)
  const groupToken = group?.token
  const market = groupToken ? cache[marketKey(groupToken.chain, groupToken.address)] : undefined
  const tokenHolding = market && holdings.find(h => h.chainId === market.chainId && sameAddr(h.mint, market.address) && h.amount > 0)
  const fileInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  // Long-press bubble menu: step=delete is the second step (pick delete scope)
  const [menu, setMenu] = useState<{ m: ChatMessage; anchor: MenuAnchor; step: 'main' | 'delete' } | null>(null)
  const loadOlder = useCallback(() => loadGroupHistory(id, true), [id, loadGroupHistory])

  // Images / videos: appear at the bottom as "sending" right after picking, sent after upload, swapped for the real message once the server echo arrives
  const media = usePendingMedia<GroupAlbumItem>({
    upload: async (f, onProgress) => {
      const file = f.kind === 'image' ? await compressForUpload(f.file) : f.file
      const r = await uploadFile(file, file.name, onProgress)
      // Once the echo arrives, display this local copy — don't download again
      primeMediaUrl(absUrl(r.url, SOCIAL_API), f.local)
      if (r.thumb) primeMediaUrl(absUrl(r.thumb, SOCIAL_API), f.local)
      return r.kind === 'video' || f.kind === 'video' ? { url: r.url, kind: 'video' } : { url: r.url, ...(r.thumb ? { thumb: r.thumb } : {}), ...(r.width && r.height ? { w: r.width, h: r.height } : {}), kind: 'image' }
    },
    send: async (_album, results) => {
      const st = useSocial.getState()
      if (st.wsStatus !== 'open') throw new Error(t('网络未连接，发送失败'))
      if (results.length === 1) { const r = results[0]; if (r.kind === 'video') st.sendMedia(id, 'video', r.url); else sendImage(id, r.url) }
      else st.sendAlbum(id, results)
      return 'await'
    },
  })
  // Once the echo arrives (my message with the same file URL shows in the list), remove the "sending" entry
  useEffect(() => {
    for (const a of media.list) {
      const first = a.state !== 'uploading' ? a.results[0]?.url : undefined
      if (first && list.some((m) => m.from === me?.address && (m.meta?.url === first || (Array.isArray(m.meta?.images) && (m.meta.images as GroupAlbumItem[]).some((x) => x?.url === first))))) media.confirm(a.id)
    }
  }, [list, media.list, me?.address]) // eslint-disable-line react-hooks/exhaustive-deps
  // Scrolling counts "messages + sending" together: a newly added "sending" entry also scrolls to bottom
  const scrollList = useMemo(() => (media.list.length ? [...list, ...media.list.map((a) => ({ id: a.id, from: me?.address || '' }))] : list), [list, media.list, me?.address])
  const { box, onScroll, loadingOlder } = useChatScroll(scrollList, !!groupHasMore[id], loadOlder, me?.address)

  const isMember = !!group?.role
  const isAdmin = group?.role === 'owner' || group?.role === 'admin'
  const byAddr = useMemo(() => Object.fromEntries((group?.members || []).map((m) => [m.address, m])), [group])
  const myMute = me ? byAddr[me.address]?.mutedUntil : undefined
  const mutedText = isAdmin ? null : myMute && myMute > Date.now() ? (isForever(myMute) ? t('你已被永久禁言') : t('你已被禁言，到 {time} 解除', { time: muteEnd(myMute) })) : group?.mutedAll ? t('全体禁言中，只有群主和管理员可以发言') : null
  // Admins manage regular members; the owner also manages admins; nobody can manage the owner
  const canManage = (m: Member) => isAdmin && m.address !== me?.address && m.role !== 'owner' && (group?.role === 'owner' || m.role === 'member')
  const canDmLock = isAdmin || !!staffRole
  // Group meetings (2026-10-07 goat: "can we start a meeting right in the group… everyone in the group knows a meeting is on and can tap straight in"):
  // A "meeting in progress" banner sits at the top; start or join from "+" → "Group meeting"; whether a meeting is on is asked of the server every 20s (disappears on its own when done), and asked immediately when someone in the group starts one
  const [gMeeting, setGMeeting] = useState<GroupMeeting | null>(null)
  const [meetOpen, setMeetOpen] = useState(false)
  const [meetForm, setMeetForm] = useState({ title: '', password: '' })
  const [meetBusy, setMeetBusy] = useState(false)
  useEffect(() => { setGMeeting(group?.meeting ?? null) }, [group?.meeting?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const lastMeetingMsg = useMemo(() => [...list].reverse().find((m) => m.kind === 'system' && m.meta?.event === 'meeting')?.id, [list])
  useEffect(() => {
    if (!isMember) return
    let alive = true
    const check = () => {
      if (document.hidden) return
      api<{ meeting: GroupMeeting | null }>(`/api/groups/${id}/meeting`).then((r) => {
        if (!alive) return
        setGMeeting(r.meeting)
        // This group's "in meeting" badge in the message list follows along (disappears on its own when the meeting ends)
        useSocial.setState((st) => ({ myGroups: st.myGroups.map((x) => (x.id === id && (x.meeting?.id ?? null) !== (r.meeting?.id ?? null) ? { ...x, meeting: r.meeting } : x)) }))
      }).catch(() => {})
    }
    check()
    const timer = setInterval(check, 20_000)
    return () => { alive = false; clearInterval(timer) }
  }, [id, isMember, lastMeetingMsg])
  const openMeeting = () => {
    setToolsOpen(false)
    if (gMeeting) { nav(`/meet/${gMeeting.id}`); return }
    setMeetForm({ title: '', password: '' }); setMeetOpen(true)
  }
  const startMeeting = async () => {
    const password = meetForm.password.trim()
    if (password && (password.length < 4 || password.length > 32)) return toast.error(t('密码需要 4~32 位'))
    setMeetBusy(true)
    try {
      const r = await api<{ meeting: GroupMeeting; existing: boolean }>(`/api/groups/${id}/meeting`, { method: 'POST', body: JSON.stringify({ title: meetForm.title.trim(), password: password || null }) })
      if (r.existing) toast.success(t('群里已经在开会，直接进入'))
      setMeetOpen(false)
      nav(`/meet/${r.meeting.id}`)
    } catch (e) { toast.error(errorText(e, t('发起失败'))) } finally { setMeetBusy(false) }
  }
  // When the sender is no longer in the member list (left, removed), fetch their public profile — otherwise only a default avatar and Solana address can be shown
  const [outsiders, setOutsiders] = useState<Record<string, Profile>>({})
  const fetching = useRef(new Set<string>())
  useEffect(() => {
    if (!group) return
    const missing = [...new Set(list.map((m) => m.from))].filter((a) => a && a !== 'system' && !byAddr[a] && !fetching.current.has(a))
    for (const a of missing.slice(0, 20)) {
      fetching.current.add(a)
      api<Profile>(`/api/users/${a}`).then((p) => setOutsiders((o) => ({ ...o, [a]: { ...p, address: a } }))).catch(() => {})
    }
  }, [list, byAddr, group])

  useEffect(() => {
    if (status !== 'ready') return
    let alive = true
    setLoadErr(null)
    setActiveGroup(id)
    loadGroup(id).then((g) => {
      if (!alive) return
      if (!g.role) return   // Not joined: don't fetch chat history (the server only gives it to members anyway)
      enterRoom(id)
      loadGroupHistory(id).catch(() => {})
    }).catch((e) => { if (alive) setLoadErr(errorText(e, t('加载失败'))) })
    return () => { alive = false; setActiveGroup(null) }
  }, [id, status, loadGroup, loadGroupHistory, enterRoom, exitRoom])

  // The group's token address is the sole market-data key; regular groups don't request quotes or show a trade entry.
  useEffect(() => {
    setTrade(null); setQuoteFailed(false)
    if (!groupToken) return
    let alive = true
    const load = async () => {
      try {
        const tokens = await getTokens([groupToken.address], groupToken.chain)
        if (alive) { put(tokens); setQuoteFailed(!tokens.length) }
      } catch { if (alive) setQuoteFailed(true) }
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(timer) }
  }, [groupToken?.chain, groupToken?.address, put])


  const send = () => {
    const t = text.trim()
    if (!t) return
    sendMessage(id, t, replyTo?.id, undefined, group?.role === 'owner' && t.includes(AT_ALL))
    setText(''); setReplyTo(null); emoji.dismiss()
  }

  // Album multi-pick: at most 9, extras are dropped beyond the first 9
  const pickMedia = (files: FileList | null) => {
    const { files: picked, truncated } = pickMediaFiles(files)
    if (fileInput.current) fileInput.current.value = ''
    if (truncated) toast.error(t('最多选 {n} 张', { n: MAX_PICK }))
    if (picked.length) { setToolsOpen(false); media.start(picked) }
  }
  // Voice uploads right after recording (a small floating indicator mid-screen while uploading, doesn't occupy the input bar)
  const sendVoice = async (blob: Blob, seconds: number) => {
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', new File([blob], 'voice.' + (blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'), { type: blob.type }))
      const r = await api<{ url: string }>('/api/upload', { method: 'POST', body: fd })
      useSocial.getState().sendMedia(id, 'voice', r.url, Math.round(seconds))
    } catch (e) { toast.error(errorText(e, t('上传失败'))) } finally { setUploading(false) }
  }
  const report = async (m: Member) => {
    const reason = prompt(t('举报 {name} 的原因？', { name: displayName(m) }))
    if (reason === null) return
    try { await api(`/api/groups/${id}/reports`, { method: 'POST', body: JSON.stringify({ target: m.address, reason }) }); toast.success(t('已举报，管理员会处理')); setMemberAction(null) } catch (e) { toast.error(errorText(e, t('举报失败'))) }
  }
  const ban = async (m: Member) => {
    if (!confirm(t('封禁 {name}？对方将无法再进入本群。', { name: displayName(m) }))) return
    try { await api(`/api/groups/${id}/members/${m.address}/ban`, { method: 'POST' }); toast.success(t('已封禁')); setMemberAction(null); loadGroup(id) } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  const openRequests = async () => {
    try { setRequests(await api(`/api/groups/${id}/requests`)); setRequestsOpen(true) } catch (e) { toast.error(errorText(e, t('加载失败'))) }
  }
  // Pending join requests (2026-10-03 goat: "I applied to join a group — where does the user approve it?" — previously buried inside the member list):
  // Admins check once on entering the group; if any, a "N requests to join · handle" banner at the top; entering from the "join request" notification (?requests=1) opens the request list directly
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingN, setPendingN] = useState(0)
  const approval = isAdmin && group?.joinMode === 'approval'
  const pendingNotifs = useSocial((s) => s.pendingRequests)
  useEffect(() => {
    if (!approval) { setPendingN(0); return }
    let alive = true
    api<unknown[]>(`/api/groups/${id}/requests`).then((r) => { if (alive) setPendingN(Array.isArray(r) ? r.length : 0) }).catch(() => {})
    return () => { alive = false }
  }, [approval, id, pendingNotifs])
  useEffect(() => {
    if (!approval || searchParams.get('requests') !== '1') return
    void openRequests()
    searchParams.delete('requests'); setSearchParams(searchParams, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval, searchParams])
  // Approve / reject join requests; the sheet auto-closes after the last one is handled
  const decide = async (addr: string, action: 'approve' | 'reject') => {
    try { await api(`/api/groups/${id}/requests/${addr}/${action}`, { method: 'POST' }); setRequests((r) => { const left = r.filter((x) => x.address !== addr); if (!left.length) setRequestsOpen(false); return left }); setPendingN((n) => Math.max(0, n - 1)); loadGroup(id); useSocial.getState().loadGroups() } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  // Group management (2026-09-27 goat): rename group, group announcement, mute-all; muting a specific person lives in member actions
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [annOpen, setAnnOpen] = useState(false)
  const [form, setForm] = useState<{ name: string; announcement: string; avatar: string | null }>({ name: '', announcement: '', avatar: null })
  const [saving, setSaving] = useState(false)
  const openSettings = () => { if (!group) return; setForm({ name: group.name, announcement: group.announcement || '', avatar: group.avatar || null }); setShowMembers(false); setAnnOpen(false); setSettingsOpen(true) }
  // Group avatar (2026-10-07 goat: "name and avatar are both editable, the owner does it themselves" — same for official communities): pick → compress → upload, takes effect on "Save"
  const avatarInput = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const pickAvatar = async (f?: File | null) => {
    if (!f) return
    setAvatarBusy(true)
    try {
      const small = await compressForUpload(f, 640)
      const r = await uploadFile(small, small.name || f.name)
      setForm((x) => ({ ...x, avatar: r.url }))
    } catch (e) { toast.error(errorText(e, t('上传失败'))) } finally { setAvatarBusy(false); if (avatarInput.current) avatarInput.current.value = '' }
  }
  const saveSettings = async () => {
    if (!form.name.trim()) return toast.error(t('请填写群名'))
    setSaving(true)
    try {
      // Official community owners can also rename and change the avatar (2026-10-07 goat); empty avatar string = remove
      await api(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify({ name: form.name.trim(), avatar: form.avatar || '', announcement: form.announcement.trim() }) })
      toast.success(t('已保存')); setSettingsOpen(false); loadGroup(id); useSocial.getState().loadGroups()
    } catch (e) { toast.error(errorText(e, t('保存失败'))) } finally { setSaving(false) }
  }
  // Join requires approval (2026-10-07 goat: the group settings had no such switch, but the server has long supported joinMode): on = owner/admin approval needed after applying, off = join directly
  const setJoinMode = async (mode: 'open' | 'approval') => {
    try { await api(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify({ joinMode: mode }) }); loadGroup(id); useSocial.getState().loadGroups() } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  const setMuteAll = async (on: boolean) => {
    try { await api(`/api/groups/${id}/mute-all`, { method: 'POST', body: JSON.stringify({ on }) }); loadGroup(id) } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  // Block member DMs (2026-09-29 goat): owner / admins / platform staff can toggle anytime, the server verifies the same identity
  const setDmLock = async (on: boolean) => {
    try { await api(`/api/groups/${id}/dm-lock`, { method: 'POST', body: JSON.stringify({ on }) }); loadGroup(id) } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  const mute = async (m: Member, minutes: number) => {
    try { await api(`/api/groups/${id}/members/${m.address}/mute`, { method: 'POST', body: JSON.stringify({ minutes }) }); toast.success(minutes ? t('已禁言') : t('已解除禁言')); setMemberAction(null); loadGroup(id) } catch (e) { toast.error(errorText(e, t('操作失败'))) }
  }
  const [gateOpen, setGateOpen] = useState(false)
  const [transferTo, setTransferTo] = useState<Member | null>(null)
  const [rechecking, setRechecking] = useState(false)
  // Re-verify member holdings: regular members no longer meeting the threshold get removed
  const recheck = async () => {
    setRechecking(true)
    try { const r = await api<{ checked: number; removed: number; failed: number }>(`/api/groups/${id}/gate/recheck`, { method: 'POST' }); toast.success(r.failed ? t('复核 {checked} 人，移出 {removed} 人，{failed} 人暂时无法查询', { checked: r.checked, removed: r.removed, failed: r.failed }) : t('复核 {checked} 人，移出 {removed} 人', { checked: r.checked, removed: r.removed })); loadGroup(id) } catch (e) { toast.error(errorText(e, t('复核失败'))) } finally { setRechecking(false) }
  }
  const openReports = async () => {
    try { setReports(await api(`/api/groups/${id}/reports`)); setReportsOpen(true) } catch (e) { toast.error(errorText(e, t('加载失败'))) }
  }

  const closeMenu = useCallback(() => setMenu(null), [])
  const removeMsg = async (m: ChatMessage, scope: 'all' | 'me') => {
    setMenu(null)
    try { await deleteGroupMessage(id, m.id, scope) } catch (e) { toast.error(errorText(e, t('删除失败'))) }
  }
  const menuItems = (): MenuItem[] => {
    if (!menu) return []
    const { m } = menu
    if (menu.step === 'delete') {
      const canAll = m.from === me?.address || isAdmin
      return [
        ...(canAll ? [{ key: 'all', label: t('为所有人删除'), danger: true, onSelect: () => void removeMsg(m, 'all') }] : []),
        { key: 'me', label: t('只删除我这边'), danger: true, onSelect: () => void removeMsg(m, 'me') },
      ]
    }
    const isText = !m.kind || m.kind === 'text'
    // Unsend: own text / images / videos / voice, within 2 minutes, deleted for everyone with no trace. Money-related messages (red packets, gifts, transfers) can't be unsent
    const recallable = m.from === me?.address && Date.now() - m.ts < RECALL_MS && (!m.kind || ['text', 'image', 'video', 'voice'].includes(m.kind))
    return [
      ...(recallable ? [{ key: 'recall', label: t('撤回'), icon: <Undo2 size={17} />, onSelect: () => { setMenu(null); deleteGroupMessage(id, m.id, 'all').then(() => toast.success(t('已撤回'))).catch((e) => toast.error(errorText(e, t('撤回失败')))) } }] : []),
      ...(isMember ? [{ key: 'reply', label: t('回复'), icon: <Reply size={17} />, onSelect: () => { setReplyTo(m); setMenu(null) } }] : []),
      ...(isText ? [{ key: 'copy', label: t('复制'), icon: <Copy size={17} />, onSelect: () => { setMenu(null); copyText(m.text).then(() => toast.success(t('已复制'))).catch(() => toast.error(t('复制失败'))) } }] : []),
      { key: 'del', label: t('删除'), icon: <Trash2 size={17} />, danger: true, onSelect: () => setMenu({ ...menu, step: 'delete' }) },
    ]
  }

  // The "typing…" indicator was removed (2026-09-25 goat: took up space), so typing status is no longer reported either
  const onType = (v: string) => setText(v)

  if (loadErr) {
    return (
      <div className="safe-top px-4 pt-4">
        <button onClick={back} className="icon-button" aria-label={t('返回')}><ArrowLeft /></button>
        <div className="py-16 text-center text-sm text-down">{loadErr}</div>
      </div>
    )
  }
  if (!group) return <div className="safe-top space-y-3 px-4 pt-4"><div className="skeleton h-10 w-40" /><div className="skeleton h-64" /></div>

  return (
    <div className="safe-top flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2">
        <button onClick={back} className="icon-button" aria-label={t('返回')} title={t('返回')}><ArrowLeft size={21} /></button>
        <Avatar address={group.id} src={group.avatar} name={group.name} size={36} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1.5 text-base font-semibold"><span className="truncate">{group.name}</span>{group.official === true && <OfficialBadge size={16} />}{group.gate && <Lock size={12} className="shrink-0 text-muted" />}</h1>
          <div className="truncate text-xs text-muted">{t('{n} 人 · {online} 在线', { n: group.memberCount, online: (roomOnline[id] || []).length })}{group.gate ? (group.gate.kind === 'nft' ? ` · ${group.gate.symbol} NFT` : ` · ${fmtAmount(group.gate.min)} ${group.gate.symbol}`) : ''}</div>
        </div>
        {isAdmin && <button onClick={openSettings} className="icon-button" aria-label={t('群管理')} title={t('群管理')}><Settings2 size={20} /></button>}
        <button onClick={() => setShowMembers(true)} className="icon-button" aria-label={t('成员')} title={t('成员')}><Users size={20} /></button>
      </header>

      {/* Meeting in progress in this group: tap to join directly (the meeting page asks for the password if one is set) */}
      {isMember && gMeeting && (
        <button onClick={() => nav(`/meet/${gMeeting.id}`)} className="flex shrink-0 items-center gap-2 border-b border-line bg-up/10 px-4 py-2.5 text-left text-[13px] font-medium" data-testid="group-meeting-bar">
          <Video size={15} className="shrink-0 text-up" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{gMeeting.participants > 0 ? t('群里正在开会 · {n} 人', { n: gMeeting.participants }) : t('群里正在开会')}</span>
          {gMeeting.hasPassword && <Lock size={12} className="shrink-0 text-muted" aria-label={t('需要密码')} />}
          <span className="shrink-0 font-semibold text-up">{t('加入')}</span>
        </button>
      )}
      {/* Pending join requests (admins only) */}
      {approval && pendingN > 0 && (
        <button onClick={() => void openRequests()} className="flex shrink-0 items-center gap-2 border-b border-line bg-accent/15 px-4 py-2.5 text-left text-[13px] font-medium" data-testid="group-requests-bar">
          <UserPlus size={15} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t('{n} 人申请加入', { n: pendingN })}</span>
          <span className="shrink-0 text-accent">{t('去处理')}</span>
          <ChevronRight size={14} className="shrink-0 text-accent" />
        </button>
      )}
      {/* Group announcement: members only (the server only returns it to members), tap to read the full text */}
      {isMember && group.announcement && (
        <button onClick={() => setAnnOpen(true)} className="flex shrink-0 items-center gap-2 border-b border-line bg-accent/10 px-4 py-2 text-left text-[13px]">
          <Megaphone size={15} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{group.announcement}</span>
          <ChevronRight size={14} className="shrink-0 text-muted" />
        </button>
      )}

      {groupToken && <section className="shrink-0 border-b border-line px-4 py-3" aria-label={t('群代币行情')}>
        <div className="flex items-center gap-3">
          <button onClick={() => nav(`/token/${groupToken.chain}/${groupToken.address}`)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={t('查看代币详情')}>
            <TokenLogo src={market?.logo} symbol={market?.symbol || group.name} size={32} />
            <span className="min-w-0"><span className="block truncate text-sm font-semibold">{market?.symbol || group.name}</span><span className="block text-xs text-muted">{market ? chainById(market.chainId)?.name || market.chain : groupToken.chain}</span></span>
          </button>
          <div className="number min-w-0 text-right"><div className="break-all text-sm font-semibold">{fmtUsd(market && market.priceUsd > 0 ? market.priceUsd : undefined)}</div><PriceChange value={market?.priceUsd ? market.change24h : undefined} className="text-xs" /></div>
          <ChevronRight size={15} className="shrink-0 text-muted" />
        </div>
        {quoteFailed && <p className="mt-2 text-xs text-warning" role="status">{market ? t('报价更新失败，显示上次行情') : t('行情暂不可用')}</p>}
        {market && chainById(market.chainId) && <div className="mt-3 grid grid-cols-2 gap-2">
          {market.chain === 'solana' && market.address === SOL_MINT ? <Button size="sm" variant="secondary" className="col-span-2" onClick={() => nav('/swap')}>{t('兑换 SOL')}</Button> : <><Button size="sm" variant="up" onClick={() => setTrade('buy')}>{t('买入')}</Button><Button size="sm" variant="down" disabled={!tokenHolding} onClick={() => setTrade('sell')}>{t('卖出')}</Button></>}
        </div>}
      </section>}

      <div className="relative min-h-0 flex-1">
      {loadingOlder && <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center" role="status"><span className="toast-solid rounded-full border border-line px-3 py-1 text-[11px] text-muted">{t('加载中…')}</span></div>}
      <div ref={box} onScroll={onScroll} onClick={emoji.dismiss} className="h-full overflow-y-auto overscroll-contain px-4 py-3">
        {!isMember && (
          <div className="mx-auto max-w-xs py-6 text-center text-sm">
            <div className="text-muted">{group.description || t('加入后即可查看和参与聊天')}</div>
            <Button className="mt-3 w-full" onClick={() => joinGroup(id).then(() => { loadGroup(id); enterRoom(id) }).catch((e: Error & { pending?: boolean }) => (e.pending ? toast.success(e.message) : toast.error(errorText(e, t('加入失败')))))}>{group.gate ? t('持有 {token} 即可加入', { token: group.gate.symbol + (group.gate.kind === 'nft' ? ' NFT' : '') }) : group.joinMode === 'approval' ? t('申请加入') : t('加入群')}</Button>
          </div>
        )}
        {isMember && !list.length && <div className="py-10 text-center text-sm text-muted">{t('暂无消息')}</div>}
        {list.map((m, i) => {
          if (m.meta?.event === 'packet' && m.meta.packet) {
            const p = m.meta.packet as PacketInfo
            const creator = byAddr[p.creator]
            // Remaining count updates live from subsequent claim events
            const claims = list.filter((x) => x.meta?.event === 'packet_claim' && x.meta.packetId === p.id)
            const remaining = claims.length ? Math.min(...claims.map((c) => Number(c.meta?.remainingCount ?? p.remainingCount))) : p.remainingCount
            const live = { ...p, remainingCount: remaining, status: remaining <= 0 ? 'done' : p.status }
            return <div key={m.id} className={`flex ${p.creator === me?.address ? 'justify-end' : 'justify-start'}`}><PacketBubble packet={live} creatorName={displayName(creator || { address: p.creator })} me={me?.address || ''} /></div>
          }
          if (m.meta?.event === 'poll' && m.meta.poll) {
            const p = polls[(m.meta.poll as { id: string }).id] || (m.meta.poll as typeof polls[string])
            return <div key={m.id} className="flex justify-start"><PollBubble poll={p} onUpdate={setPoll} /></div>
          }
          return <Bubble key={m.id} m={m} prev={list[i - 1]} me={me?.address || ''} member={byAddr[m.from] || outsiders[m.from]} self={me} reply={m.replyTo ? list.find((x) => x.id === m.replyTo) : undefined} onReply={() => { if (isMember) setReplyTo(m) }} onMenu={(anchor) => setMenu({ m, anchor, step: 'main' })} onUser={() => byAddr[m.from] ? setMemberAction(byAddr[m.from]) : nav(`/u/${m.from}`)} liveMeeting={gMeeting?.id ?? null} />
        })}
        {media.list.map((a) => <PendingMediaRow key={a.id} album={a} self={me} onRetry={() => media.retry(a.id)} />)}
        <div ref={bottom} />
      </div>
      {uploading && <UploadingToast />}
      </div>
      <MessageMenu anchor={menu?.anchor ?? null} items={menuItems()} note={menu?.step === 'delete' ? t('删除后无法恢复') : undefined} onClose={closeMenu} label={t('消息操作')} />

      {isMember && mutedText && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-line bar-glass px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] text-sm text-muted" role="status"><MicOff size={16} aria-hidden="true" />{mutedText}</div>
      )}
      {isMember && !mutedText && (
        <div className="shrink-0 border-t border-line bar-glass px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
          {replyTo && (
            <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-card px-3 py-1.5 text-xs">
              <Reply size={12} className="text-accent" /><span className="text-muted">{t('回复 {name}：', { name: displayName(byAddr[replyTo.from] || { address: replyTo.from }) })}</span><span className="min-w-0 flex-1 truncate">{replyTo.text}</span>
              <button onClick={() => setReplyTo(null)} className="icon-button" aria-label={t('取消回复')}><X size={16} /></button>
            </div>
          )}
          {toolsOpen && <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2" role="group" aria-label={t('消息附件')}>
            {BALANCE_FEATURES && <button onClick={() => setTipTarget('any')} className="icon-button text-accent" aria-label={t('送礼物')} title={t('送礼物')}><Gift size={20} /></button>}
            <button onClick={() => setPacketOpen(true)} className="icon-button" aria-label={t('红包')} title={t('红包')}><Wallet size={20} /></button>
            <button onClick={() => fileInput.current?.click()} className="icon-button" aria-label={t('图片或视频')} title={t('图片或视频')}><ImageIcon size={20} /></button>
            <button onClick={openMeeting} className="icon-button" aria-label={gMeeting ? t('加入群会议') : t('群会议')} title={gMeeting ? t('加入群会议') : t('群会议')}><Video size={20} /></button>
            {isAdmin && <button onClick={() => setPollOpen(true)} className="icon-button" aria-label={t('投票')} title={t('投票')}><BarChart3 size={20} /></button>}
            {group.role === 'owner' && <button onClick={() => { setToolsOpen(false); setText((v) => (v.includes(AT_ALL) ? v : `${AT_ALL} ${v}`)) }} className="icon-button" aria-label={t('@所有人')} title={t('@所有人')}><AtSign size={20} /></button>}
          </div>}
          {/* 2026-09-26 goat: emoji panel moved above the input (input pinned at the very bottom) */}
          {emoji.open && <EmojiPicker className="-mx-3 mb-2" onPick={emoji.pick} onBackspace={emoji.backspace} />}
          <div className="flex items-end gap-1.5">
            <button onClick={() => { emoji.setOpen(false); setToolsOpen(value => !value) }} className="icon-button" aria-label={toolsOpen ? t('收起附件') : t('添加附件')} aria-expanded={toolsOpen} title={t('附件')}>{toolsOpen ? <X size={21} /> : <Plus size={21} />}</button>
            <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pickMedia(e.target.files)} />
            <textarea {...emoji.fieldProps} value={text} onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} rows={1} placeholder={t('消息')} aria-label={t('消息')} className="max-h-28 min-h-11 min-w-0 flex-1 resize-y rounded-lg border border-line bg-card px-3 py-2.5 text-base placeholder:text-muted" />
            <button onClick={() => { setToolsOpen(false); emoji.toggle() }} className="icon-button" aria-label={emoji.open ? t('键盘') : t('表情')} aria-expanded={emoji.open} title={emoji.open ? t('键盘') : t('表情')}>{emoji.open ? <Keyboard size={21} /> : <Smile size={21} />}</button>
            <SendVoiceButton canSend={!!text.trim()} onSend={send} onVoice={sendVoice} voiceDisabled={uploading} className="icon-button bg-accent text-bg"><Send size={19} /></SendVoiceButton>
          </div>
        </div>
      )}

      {/* Member list */}
      <Sheet open={showMembers} onClose={() => setShowMembers(false)} title={t('成员 · {n}', { n: group.memberCount })}>
        {group.num ? (
          <div className="mb-3 flex items-center justify-between rounded-xl bg-card2 px-3 py-2.5">
            <div><div className="text-[11px] text-muted">{t('群号')}</div><div className="text-base font-semibold tabular-nums">{group.num}</div></div>
            <button onClick={() => copyText(String(group.num)).then(() => toast.success(t('群号已复制'))).catch(() => toast.error(t('复制失败')))} className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-accent"><Copy size={15} />{t('复制')}</button>
          </div>
        ) : null}
        <div ref={memberPager.anchor} />
        {memberPager.pageItems.map((m) => (
          <button key={m.address} onClick={() => { setShowMembers(false); setMemberAction(m) }} className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left active:bg-card2">
            <Avatar address={m.address} src={m.avatar} name={m.nickname} size={36} chainId={m.avatarNft?.chainId} />
            <div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-sm font-semibold"><UserName address={m.address} name={displayName(m)} className="truncate" /><XBadge address={m.address} size={12} />{(roomOnline[id] || []).includes(m.address) && <span className="h-1.5 w-1.5 rounded-full bg-up" />}</div><div className="text-xs text-muted">{shortId(m.evmAddress || m.address)}</div></div>
            <GroupRoleBadge role={m.role} size="md" />
          </button>
        ))}
        <Pager p={memberPager} />
        {canDmLock && <DmLockSwitch on={!!group.dmLocked} onChange={setDmLock} className="mt-4" />}
        {group.role === 'member' && <Button variant="danger" size="sm" className="mt-4 w-full" onClick={() => leaveGroup(id).then(back)}>{t('退出群')}</Button>}
        {isAdmin && <Button variant="secondary" size="sm" className="mt-4 w-full" onClick={() => { setShowMembers(false); openReports() }}><Flag size={14} /> {t('查看举报')}</Button>}
        {isAdmin && group.joinMode === 'approval' && <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => { setShowMembers(false); openRequests() }}>{t('入群申请')}</Button>}
        {isAdmin && <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => { setShowMembers(false); setGateOpen(true) }}><Lock size={14} /> {group.gate ? t('修改进群门槛') : t('设置进群门槛')}</Button>}
        {isAdmin && group.gate && <Button variant="secondary" size="sm" className="mt-2 w-full" loading={rechecking} onClick={recheck}>{t('复核成员持仓')}</Button>}
      </Sheet>
      <GateSheet open={gateOpen} onClose={() => setGateOpen(false)} groupId={id} gate={group.gate} onSaved={() => { loadGroup(id); useSocial.getState().loadGroups() }} />

      {/* Join requests (admins) */}
      <Sheet open={requestsOpen} onClose={() => setRequestsOpen(false)} title={t('入群申请')}>
        {!requests.length && <div className="py-8 text-center text-sm text-muted">{t('没有待处理的申请')}</div>}
        {requests.map((r) => (
          <div key={r.address} className="flex items-center gap-3 border-b border-line py-3">
            <Avatar address={r.address} src={r.avatar} name={r.nickname} size={40} />
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold"><UserName address={r.address} name={displayName(r)} /></div>{r.message && <div className="truncate text-xs text-muted">{r.message}</div>}</div>
            <Button size="sm" onClick={() => decide(r.address, 'approve')}>{t('通过')}</Button>
            <Button size="sm" variant="secondary" onClick={() => decide(r.address, 'reject')}>{t('拒绝')}</Button>
          </div>
        ))}
      </Sheet>

      {/* Report list (admins) */}
      <Sheet open={reportsOpen} onClose={() => setReportsOpen(false)} title={t('举报')}>
        {!reports.length && <div className="py-8 text-center text-sm text-muted">{t('没有待处理的举报')}</div>}
        {reports.map((r) => (
          <div key={r.id} className="border-b border-line py-3 text-sm">
            <div className="font-semibold">{t('被举报：{name}', { name: displayName(byAddr[r.target] || { address: r.target }) })}</div>
            <div className="text-xs text-muted">{t('来自 {name}', { name: displayName(byAddr[r.reporter] || { address: r.reporter }) })} · {r.reason || t('未填写原因')}</div>
            {byAddr[r.target] && byAddr[r.target].role === 'member' && <Button variant="danger" size="sm" className="mt-2" onClick={() => ban(byAddr[r.target]).then(openReports)}>{t('封禁')}</Button>}
          </div>
        ))}
      </Sheet>

      <RedPacketSheet open={packetOpen} onClose={() => setPacketOpen(false)} groupId={id} />
      {/* Start a group meeting: name optional (defaults to "<group name> group meeting"), password optional; anyone with the link can join, password required if set */}
      <Sheet open={meetOpen} onClose={() => setMeetOpen(false)} title={t('群会议')} dismissible={!meetBusy}>
        <label className="block text-xs text-muted">{t('会议名称')}
          <input value={meetForm.title} maxLength={60} onChange={(e) => setMeetForm((f) => ({ ...f, title: e.target.value }))} placeholder={`${group.name} ${t('群会议')}`} className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-base text-fg placeholder:text-muted" />
        </label>
        <label className="mt-4 block text-xs text-muted">{t('会议密码（可不填）')}
          <input value={meetForm.password} maxLength={32} onChange={(e) => setMeetForm((f) => ({ ...f, password: e.target.value }))} placeholder={t('4~32 位')} autoComplete="off" className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-base text-fg placeholder:text-muted" />
        </label>
        <Button className="mt-4 w-full" loading={meetBusy} onClick={() => void startMeeting()}><Video size={16} />{t('发起会议')}</Button>
      </Sheet>
      <PollSheet open={pollOpen} onClose={() => setPollOpen(false)} groupId={id} />

      {/* Group management */}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t('群管理')}>
        <div className="mb-4 flex items-center gap-3">
          <Avatar address={group.id} src={form.avatar} name={form.name || group.name} size={56} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" loading={avatarBusy} disabled={avatarBusy} onClick={() => avatarInput.current?.click()}>{t('更换头像')}</Button>
            {form.avatar && !avatarBusy && <Button size="sm" variant="secondary" onClick={() => setForm((f) => ({ ...f, avatar: null }))}>{t('去掉头像')}</Button>}
          </div>
          <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => void pickAvatar(e.target.files?.[0])} />
        </div>
        <label className="block text-xs text-muted">{t('群名')}
          <input value={form.name} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-base text-fg disabled:opacity-60" />
        </label>
        <label className="mt-4 block text-xs text-muted">{t('群公告')}
          <textarea value={form.announcement} maxLength={1000} rows={5} onChange={(e) => setForm((f) => ({ ...f, announcement: e.target.value }))} placeholder={t('只有群成员看得到，留空即删除公告')} className="mt-1 w-full resize-y rounded-xl border border-line bg-card px-3 py-2.5 text-base text-fg placeholder:text-muted" />
        </label>
        <Button className="mt-3 w-full" loading={saving} onClick={saveSettings}>{t('保存')}</Button>
        <div className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-3">
          <div className="min-w-0"><div className="text-sm font-semibold">{t('全体禁言')}</div><div className="mt-0.5 text-xs text-muted">{t('开启后只有群主和管理员可以发言')}</div></div>
          <button role="switch" aria-checked={!!group.mutedAll} aria-label={t('全体禁言')} onClick={() => setMuteAll(!group.mutedAll)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${group.mutedAll ? 'bg-accent' : 'bg-line'}`}><span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${group.mutedAll ? 'left-[22px]' : 'left-0.5'}`} /></button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-3">
          <div className="min-w-0"><div className="text-sm font-semibold">{t('进群需要验证')}</div><div className="mt-0.5 text-xs text-muted">{t('开启后新成员要管理员同意才能进群')}</div></div>
          <button role="switch" aria-checked={group.joinMode === 'approval'} aria-label={t('进群需要验证')} onClick={() => setJoinMode(group.joinMode === 'approval' ? 'open' : 'approval')} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${group.joinMode === 'approval' ? 'bg-accent' : 'bg-line'}`}><span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${group.joinMode === 'approval' ? 'left-[22px]' : 'left-0.5'}`} /></button>
        </div>
        <DmLockSwitch on={!!group.dmLocked} onChange={setDmLock} className="mt-3" />
        <Button variant="secondary" className="mt-3 w-full" onClick={() => { setSettingsOpen(false); setShowMembers(true) }}><Users size={16} /> {t('成员管理')}</Button>
        <p className="mt-2 text-xs leading-relaxed text-muted">{group.role === 'owner' ? t('在成员列表里点某个人，可以设为管理员、禁言、移出群或封禁。') : t('在成员列表里点某个人，可以禁言、移出群或封禁。')}</p>
      </Sheet>

      <Sheet open={annOpen} onClose={() => setAnnOpen(false)} title={t('群公告')}>
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{group.announcement}</p>
        {group.announcementAt ? <p className="mt-3 text-xs text-muted">{t('更新于 {time}', { time: new Date(group.announcementAt).toLocaleString(locale()) })}</p> : null}
        {isAdmin && <Button variant="secondary" className="mt-4 w-full" onClick={openSettings}>{t('编辑公告')}</Button>}
      </Sheet>

      {/* Member actions */}
      <Sheet open={!!memberAction} onClose={() => setMemberAction(null)} title={memberAction ? displayName(memberAction) : ''}>
        {memberAction && (
          <div className="space-y-2">
            <button onClick={() => nav(`/u/${memberAction.address}`, { state: { profile: memberAction } })} className="mb-3 flex w-full items-center gap-3 text-left"><Avatar address={memberAction.address} src={memberAction.avatar} name={memberAction.nickname} size={48} /><div className="min-w-0 text-xs text-muted"><div className="truncate">{memberAction.evmAddress || memberAction.address}</div>{memberAction.bio && <div className="mt-1 text-fg">{memberAction.bio}</div>}<div className="mt-1 text-accent">{t('查看主页')} ›</div></div></button>
            {BALANCE_FEATURES && memberAction.address !== me?.address && <Button variant="secondary" className="w-full" onClick={() => { setTipTarget(memberAction); setMemberAction(null) }}><Gift size={16} /> {t('送礼物')}</Button>}
            {BALANCE_FEATURES && memberAction.address !== me?.address && <Button variant="secondary" className="w-full" onClick={() => { setTransferTo(memberAction); setMemberAction(null) }}><Wallet size={16} /> {t('转账（余额即时到账）')}</Button>}
            {/* DM (2026-09-29 goat: the button just says "DM"). Owner / admins / platform staff as usual; regular members can't DM other regular members in groups with "block member DMs" on */}
            {memberAction.address !== me?.address && (isAdmin || staffRole
              ? <Button variant="secondary" className="w-full" onClick={() => nav(`/dm/${memberAction.address}`)}><MessageSquareLock size={16} /> {t('发私信')}</Button>
              : group.dmLocked && memberAction.role === 'member'
                ? <p className="rounded-xl bg-card2 px-3 py-2.5 text-center text-xs text-muted">{t('群管理员已关闭群成员私信')}</p>
                : <Button variant="secondary" className="w-full" onClick={() => nav(`/dm/${memberAction.address}`)}><MessageSquareLock size={16} /> {t('私信（需互相关注）')}</Button>)}
            {memberAction.address !== me?.address && <Button variant="ghost" className="w-full" onClick={() => report(memberAction)}><Flag size={14} /> {t('举报')}</Button>}
            {/* Manage (2026-09-29 goat: tapping a person in member management needs a dedicated manage menu). Shown per role: the owner can appoint/remove admins, and mute, remove, ban admins; admins can only manage regular members */}
            {isAdmin && memberAction.address !== me?.address && (
              <div className="mt-2 rounded-xl bg-card2 p-3">
                <div className="mb-2 text-xs font-semibold text-muted">{t('管理此成员')}</div>
                {canManage(memberAction) || (group.role === 'owner' && memberAction.role !== 'owner') ? (
                  <div className="space-y-2">
                    {group.role === 'owner' && memberAction.role !== 'owner' && (
                      <Button variant="secondary" className="w-full" onClick={() => setRole(id, memberAction.address, memberAction.role === 'admin' ? 'member' : 'admin').then(() => { toast.success(t('已更新')); setMemberAction(null) })}>{memberAction.role === 'admin' ? t('取消管理员') : t('设为管理员')}</Button>
                    )}
                    {canManage(memberAction) && (
                      <div className="rounded-xl bg-card p-3">
                        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted"><MicOff size={13} aria-hidden="true" />{memberAction.mutedUntil ? (isForever(memberAction.mutedUntil) ? t('永久禁言中') : t('禁言中，到 {time} 解除', { time: muteEnd(memberAction.mutedUntil) })) : t('禁言')}</div>
                        <div className="grid grid-cols-3 gap-2">
                          {MUTE_OPTIONS.map(([min, label]) => <Button key={min} size="sm" variant="secondary" onClick={() => mute(memberAction, min)}>{t(label)}</Button>)}
                          {memberAction.mutedUntil ? <Button size="sm" variant="secondary" className="text-accent" onClick={() => mute(memberAction, 0)}>{t('解除禁言')}</Button> : null}
                        </div>
                      </div>
                    )}
                    {canManage(memberAction) && <Button variant="danger" className="w-full" onClick={() => kick(id, memberAction.address).then(() => { toast.success(t('已移出')); setMemberAction(null) }).catch((e) => toast.error(errorText(e, t('操作失败'))))}>{t('移出群')}</Button>}
                    {canManage(memberAction) && <Button variant="danger" className="w-full" onClick={() => ban(memberAction)}>{t('封禁（永久禁止进入）')}</Button>}
                  </div>
                ) : <p className="text-xs leading-relaxed text-muted">{memberAction.role === 'owner' ? t('群主不能被管理') : t('管理员之间不能互相管理，只有群主可以管理管理员')}</p>}
              </div>
            )}
          </div>
        )}
      </Sheet>

      {tipTarget && <GiftSheet open onClose={() => setTipTarget(null)} groupId={id} recipients={group.members} initial={tipTarget === 'any' ? null : tipTarget} />}
      {transferTo && <TransferSheet open onClose={() => setTransferTo(null)} to={transferTo} context={`group:${id}`} />}
      {market && trade && <TradeSheet key={`${market.chain}:${market.address}:${trade}`} open side={trade} token={market} onClose={() => setTrade(null)} />}
    </div>
  )
}

const AT_ALL = '@所有人'
const MUTE_OPTIONS: [number, string][] = [[10, '10 分钟'], [60, '1 小时'], [1440, '1 天'], [10080, '7 天'], [-1, '永久']]
/** A permanent mute is stored on the server as a far-future timestamp */
const isForever = (ms: number) => ms > Date.now() + 3650 * 86400_000
const muteEnd = (ms: number) => new Date(ms).toLocaleString(locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function Bubble({ m, prev, me, member, self, reply, onReply, onMenu, onUser, liveMeeting }: { m: ChatMessage; prev?: ChatMessage; me: string; member?: Profile & { role?: Member['role'] }; self?: Profile | null; reply?: ChatMessage; onReply: () => void; onMenu: (a: MenuAnchor) => void; onUser: () => void; liveMeeting?: string | null }) {
  // Long-press / right-click = action menu (reply, copy, delete), double-tap = reply. Hooks go first so call order stays consistent across renders
  const press = useLongPress(onMenu, onReply)
  const nav = useNavigate()
  // The mobile app has no balance features: system messages for gifts, balance red packets, claiming, and red-packet refunds are hidden (web unchanged)
  const ev = m.kind === 'system' ? String(m.meta?.event || '') : ''
  if (!BALANCE_FEATURES && (ev === 'gift' || ev.startsWith('cpacket'))) return null
  if (m.kind === 'system' && m.meta?.event === 'cpacket') {
    return <CreditPacketBubble packetId={String(m.meta.packetId)} creator={String(m.meta.creator)} creatorName={typeof (m.meta.params as { name?: unknown } | undefined)?.name === 'string' ? String((m.meta.params as { name: string }).name) : m.text.split(' 发了')[0]} total={Number(m.meta.total)} message={String(m.meta.message || '')} me={me} />
  }
  // "XX started a group meeting": shows "Join" while the meeting is still on, "Ended" once it's over (2026-10-07 group meetings)
  if (m.kind === 'system' && m.meta?.event === 'meeting') {
    const mt = m.meta.meeting as { id?: string; title?: string; hasPassword?: boolean } | undefined
    const live = !!mt?.id && mt.id === liveMeeting
    return (
      <div className="my-2 flex justify-center">
        <span className="flex max-w-[90%] items-center gap-2 rounded-2xl bg-card px-3 py-2 text-[12px]">
          <Video size={16} className={`shrink-0 ${live ? 'text-up' : 'text-muted'}`} aria-hidden="true" />
          <span className="min-w-0"><span className="block text-muted">{renderSysMessage(m)}</span>{mt?.title && <span className="block truncate font-semibold text-fg">{mt.title}{mt.hasPassword ? <Lock size={11} className="ml-1 inline-block align-[-1px] text-muted" aria-label={t('需要密码')} /> : null}</span>}</span>
          {live ? <button type="button" onClick={() => nav(`/meet/${mt!.id}`)} className="shrink-0 rounded-full bg-up/15 px-3 py-1 text-[12px] font-semibold text-up">{t('加入')}</button> : <span className="shrink-0 text-[11px] text-muted">{t('已结束')}</span>}
        </span>
      </div>
    )
  }
  if (m.kind === 'system' && m.meta?.event === 'gift') {
    return (
      <div className="my-2 flex justify-center">
        <span className="flex max-w-[90%] items-center gap-2 rounded-2xl bg-gradient-to-r from-[#ff7a59]/20 to-[#ffd166]/20 px-3 py-1.5 text-center text-[12px] text-fg">
          <span className="flex shrink-0 items-center"><GiftIcon id={String(m.meta.giftId || '')} size={36} />{Number(m.meta.qty) > 1 ? <span className="ml-0.5 text-xs font-bold">×{String(m.meta.qty)}</span> : null}</span>
          <span>{renderSysMessage(m)}</span>
        </span>
      </div>
    )
  }
  if (m.kind === 'system') {
    const isTip = m.meta?.event === 'tip'
    return (
      <div className="my-2 flex justify-center">
        <span className={`max-w-[85%] rounded-full px-3 py-1 text-center text-[11px] ${isTip ? 'bg-accent/15 text-accent' : 'bg-card text-muted'}`}>{isTip && <Gift size={12} className="mr-1 inline-block align-[-2px]" aria-hidden="true" />}{renderSysMessage(m)}{isTip && m.meta?.chainId ? ` · ${chainName(Number(m.meta.chainId))}` : ''}</span>
      </div>
    )
  }
  const mine = m.from === me
  // 2026-09-25 goat: a message row was "too heavy". Removed the per-message timestamp and reply button; timestamps now appear as a centered divider only when the gap exceeds 5 minutes (WeChat-style),
  // reply moved to double-tap the bubble or the long-press menu
  const grouped = prev && prev.from === m.from && prev.kind !== 'system' && m.ts - prev.ts < 60_000
  const showTime = !prev || m.ts - prev.ts > 5 * 60_000
  const name = displayName(member || { address: m.from })
  const album = groupAlbumOf(m.meta)
  return (
    <>
    {showTime && <div className="mb-1 mt-4 text-center text-[11px] text-muted">{chatTime(m.ts)}</div>}
    <div className={`flex items-start gap-2 ${mine ? 'flex-row-reverse' : ''} ${grouped || showTime ? 'mt-1' : 'mt-3'}`}>
      {/* Avatars: others' on the left, mine on the right; consecutive messages leave the space blank to align */}
      {grouped ? <div className="w-8 shrink-0" /> : mine
        ? <Avatar address={m.from} src={self?.avatar} name={self?.nickname} size={32} chainId={self?.avatarNft?.chainId} />
        : <button onClick={onUser} className="shrink-0"><Avatar address={m.from} src={member?.avatar} name={member?.nickname} size={32} chainId={member?.avatarNft?.chainId} /></button>}
      <div className={`flex min-w-0 max-w-[75%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {!mine && !grouped && <button onClick={onUser} className="mb-0.5 flex max-w-full items-center gap-1 px-1 text-[11px] leading-4 text-muted"><UserName address={m.from} name={name} className="truncate" /><XBadge address={m.from} size={10} /><GroupRoleBadge role={member?.role} /></button>}
        <div {...press}
          className={`select-none rounded-2xl px-3 py-1.5 text-[15px] leading-snug [-webkit-touch-callout:none] ${mine ? 'rounded-tr-md bg-accent text-bg' : 'rounded-tl-md bg-card'} ${member?.role === 'owner' ? 'bubble-owner' : member?.role === 'admin' ? 'bubble-mod' : ''}`}>
          {reply && <div className={`mb-1 border-l-2 pl-2 text-xs ${mine ? 'border-bg/40 text-bg/70' : 'border-accent text-muted'}`}>{reply.text.slice(0, 60)}</div>}
          {album
            ? <GroupAlbum images={album} />
            : (m.kind === 'image' || m.kind === 'video' || m.kind === 'voice') && typeof m.meta?.url === 'string'
            ? <GroupMedia kind={m.kind} url={m.meta.url} duration={Number(m.meta.duration) || undefined} mine={mine} />
            : <span className="whitespace-pre-wrap break-words">{m.text}</span>}
        </div>
      </div>
    </div>
    </>
  )
}

/** Chat time dividers: today shows HH:mm only, other days include month/day */
function chatTime(ts: number) {
  const d = new Date(ts), now = new Date()
  const hm = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === now.toDateString() ? hm : `${d.toLocaleDateString(locale(), { month: 'numeric', day: 'numeric' })} ${hm}`
}

/** The "block member DMs" switch (2026-09-29 goat): one in group settings and one in member management, styled like "mute all" */
function DmLockSwitch({ on, onChange, className = '' }: { on: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl bg-card2 px-3 py-3 ${className}`}>
      <div className="min-w-0"><div className="text-sm font-semibold">{t('禁止群成员私信')}</div><div className="mt-0.5 text-xs text-muted">{t('开启后普通成员不能私信群里的其他成员，群主和管理员可以私信成员')}</div></div>
      <button role="switch" aria-checked={on} aria-label={t('禁止群成员私信')} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-line'}`}><span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></button>
    </div>
  )
}
