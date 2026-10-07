// Live-rework images (2026-09-30): BytePlus-generated, cut out to transparent WebP (goat: real images everywhere an image is wanted, never emoji).
// Simple geometry like locks and LIVE badges is hand-written SVG in components.
import streak from './img/streak.webp'
import v1 from './img/viewer-1.webp'
import v2 from './img/viewer-2.webp'
import v3 from './img/viewer-3.webp'
import v4 from './img/viewer-4.webp'
import v5 from './img/viewer-5.webp'
import v6 from './img/viewer-6.webp'
import s1 from './img/streamer-1.webp'
import s2 from './img/streamer-2.webp'
import s3 from './img/streamer-3.webp'
import s4 from './img/streamer-4.webp'
import s5 from './img/streamer-5.webp'
import s6 from './img/streamer-6.webp'
import e10 from './img/enter-10.webp'
import e25 from './img/enter-25.webp'
import e40 from './img/enter-40.webp'
import win from './img/pk-win.webp'
import lose from './img/pk-lose.webp'
import draw from './img/pk-draw.webp'
import r1 from './img/rank-1.webp'
import r2 from './img/rank-2.webp'
import r3 from './img/rank-3.webp'
import golive from './img/golive.webp'

export const LIVE_IMG = {
  streak, golive, win, lose, draw,
  viewer: [v1, v1, v2, v3, v4, v5, v6], // Index = badge tier 1–6 (0 is a placeholder)
  streamer: [s1, s1, s2, s3, s4, s5, s6],
  enter: { 10: e10, 25: e25, 40: e40 } as Record<number, string>,
  rank: [r1, r1, r2, r3], // Index = rank 1–3
}

/** Badge tiers 1–6: 1–9 / 10–19 / 20–29 / 30–39 / 40–49 / 50 (matches server liveXp.ts) */
export const badgeTier = (level: number) => (level >= 50 ? 6 : Math.min(5, Math.floor(level / 10) + 1))
/** Entry-effect tiers: viewers at level 10 / 25 / 40+ */
export const enterTier = (level: number) => (level >= 40 ? 40 : level >= 25 ? 25 : level >= 10 ? 10 : 0)
