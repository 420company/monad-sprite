// Animation layer + floating-screen messages for energy gifts (shared by web, meetings, and the mobile app).
// The server only broadcasts roomgift after confirming the energy deduction; playback starts on receipt here: never play locally first, never play on rejection (goat: no "sent then taken back").
// The mobile app mounts this layer too: it only plays others' gift animations, showing no prices or buttons.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { GiftFxStage, giftSound, type GiftFxHandle } from '@/components/giftFx'
import { energyFile, ENERGY_GIFTS, onEnergyMessage, useEnergy } from '@/lib/energy'
import { useLang } from '@/lib/i18n'
import { useSocial } from '@/store/social'

/** One gifted broadcast from the server (roomgift after server/src/giftEnergy.ts's send succeeds) */
export interface RoomGift {
  roomId: string; room: string; id: string; from: string; nickname: string | null; avatar: string | null; to: string
  gift: { id: string; nameZh: string; nameEn: string; icon: string | null; anim: string | null; fx: string | null; sound: string | null; price?: number }
  count: number; ts: number
}
export const giftDisplayName = (g: RoomGift['gift'], lang: string) => (lang === 'en' ? g.nameEn : g.nameZh)

export interface GiftFxLayerHandle { play(g: RoomGift): void }

export const GiftFxLayer = forwardRef<GiftFxLayerHandle, { className?: string }>(function GiftFxLayer({ className }, ref) {
  const stage = useRef<GiftFxHandle>(null)
  const lang = useLang((s) => s.lang)
  useImperativeHandle(ref, () => ({
    play: (g) => stage.current?.play({ gift: g.gift, from: { id: g.from, nickname: g.nickname, avatar: energyFile(g.avatar) }, count: g.count || 1 }),
  }), [])
  return <GiftFxStage ref={stage} className={className} lang={lang === 'en' ? 'en' : 'zh'} resolve={(u) => energyFile(u) || u} fallbackIcon={energyFile('/files/gift-giftbox.webp')!} sound={giftSound()} />
})

/**
 * Subscribe to a room's gifting broadcasts. roomId: the live room id, or a meeting's `meet:<code>`.
 * With join = true, also subscribe to this channel (used by the meeting page; the live room page already subscribed to roomjoin itself)
 */
export function useRoomGifts(roomId: string | null, onGift: (g: RoomGift) => void, join = false) {
  const socket = useSocial((s) => s.socket)
  const wsStatus = useSocial((s) => s.wsStatus)
  const cb = useRef(onGift)
  cb.current = onGift
  useEffect(() => {
    if (!socket || wsStatus !== 'open' || !roomId) return
    if (join) socket.send({ type: 'roomjoin', roomId })
    const off = socket.on((d) => { if (d.type === 'roomgift' && d.roomId === roomId && d.gift) cb.current(d as unknown as RoomGift) })
    return () => { off(); if (join) socket.send({ type: 'leave', groupId: `room:${roomId}` }) }
  }, [socket, wsStatus, roomId, join])
}

/**
 * Web global: realtime energy-balance sync (the server pushes energy_balance; all devices and tabs of this wallet change together).
 * Read once after login; the mobile app doesn't mount it (no balance shown).
 */
export function useEnergySync() {
  const socket = useSocial((s) => s.socket)
  const status = useSocial((s) => s.status)
  useEffect(() => {
    if (!ENERGY_GIFTS || status !== 'ready') return
    void useEnergy.getState().refresh()
  }, [status])
  useEffect(() => {
    if (!ENERGY_GIFTS || !socket) return
    const off = socket.on((d) => onEnergyMessage(d, useEnergy.getState().me?.wallet))
    return () => { off() }
  }, [socket])
}
