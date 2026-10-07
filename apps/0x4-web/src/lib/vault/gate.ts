// The "verify only when moving money" gate (2026-09-25).
//
// Previously the whole app sat behind the unlock screen: nothing visible while locked, and every app restart required the password / face scan again.
// Now (native app only) split into two layers:
//   Reading — social login tokens and DM keys live in on-device secure storage; the feed and DMs work right after opening
//   Moving money — the signer is "gated": the unlock check happens only at actual signing time; if locked, pop the verification panel,
//            Verified → continue signing; user-cancelled → throw UnlockCancelled, and the caller treats it as an ordinary failure
//
// This module doesn't import the wallet store (avoids a circular dependency): whether it's unlocked is told to this module by the store via setUnlockedCheck,
// The verification panel (components/UnlockSheet) subscribes to useUnlockPrompt for display.
import { create } from 'zustand'

export class UnlockCancelled extends Error {
  constructor() { super('已取消') }
}

interface PromptState { open: boolean; reason: string }
export const useUnlockPrompt = create<PromptState>(() => ({ open: false, reason: '' }))

let isUnlocked: () => boolean = () => false
let waiters: { resolve: () => void; reject: (e: Error) => void }[] = []
const lockListeners = new Set<() => void>()

export function setUnlockedCheck(fn: () => boolean): void { isUnlocked = fn }

/**
 * On web with the 0x4 extension connected, unlocking is handed to the extension (ask it to pop its own unlock window) — the local verification panel isn't shown (web has no such panel;
 * since 2026-10-06 the extension locking no longer logs web out, "locked" became the normal state on web — without handing off to the extension this would wait forever).
 * Set when the wallet store mounts the extension, cleared when it's unmounted
 */
let externalUnlock: (() => Promise<void>) | null = null
export function setExternalUnlock(fn: (() => Promise<void>) | null): void { externalUnlock = fn }

/** Called before signing. Passes straight through when unlocked; otherwise pops the verification panel (web extension: ask the extension to unlock); concurrent requests share one verification */
export function ensureUnlocked(reason = '确认这笔操作'): Promise<void> {
  if (isUnlocked()) return Promise.resolve()
  if (externalUnlock) return externalUnlock()
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject })
    if (!useUnlockPrompt.getState().open) useUnlockPrompt.setState({ open: true, reason })
  })
}

/** Verification panel teardown: ok = unlocked, false = user cancelled */
export function finishUnlock(ok: boolean): void {
  const pending = waiters
  waiters = []
  useUnlockPrompt.setState({ open: false })
  pending.forEach((w) => (ok ? w.resolve() : w.reject(new UnlockCancelled())))
}

/** Notify on wallet lock (e.g. the perps trading agent-key cache must be cleared along) */
export function onLock(fn: () => void): () => void {
  lockListeners.add(fn)
  return () => lockListeners.delete(fn)
}
export function notifyLock(): void { lockListeners.forEach((fn) => fn()) }
