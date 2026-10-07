// 能量礼物的动画层 + 飘屏消息（网页版、会议、手机 App 共用）。
// 服务器确认扣好能量后才会广播 roomgift，这里收到才播：本机永远不先播、被拒的永远不播（goat：不能「送出去又收回」）。
// 手机 App 也挂这一层：只播别人送的礼物动画，不出现任何价格和按钮。
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { GiftFxStage, giftSound, type GiftFxHandle } from '@/components/giftFx'
import { energyFile, ENERGY_GIFTS, onEnergyMessage, useEnergy } from '@/lib/energy'
import { useLang } from '@/lib/i18n'
import { useSocial } from '@/store/social'

/** 服务器广播的一条送礼（server/src/giftEnergy.ts send 成功后的 roomgift） */
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
 * 订阅一个房间的送礼广播。roomId：直播间 id，或会议的 `meet:<会议码>`。
 * join = true 时顺带订阅这个频道（会议页用；直播间页面自己已经订阅了 roomjoin）
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
 * 网页版全局：能量余额实时同步（服务器推 energy_balance，这个钱包所有设备、所有标签页一起变）。
 * 登录后先读一次；手机 App 不挂（不显示余额）。
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
