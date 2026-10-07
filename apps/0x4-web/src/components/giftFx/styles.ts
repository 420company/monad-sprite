// 礼物动画的样式：一段 CSS 字符串，第一次用到时插进 <head>（不依赖 Tailwind，会议工程 meet/ 也能直接引用）。
// 只动 transform / opacity（礼花用一块 canvas），不用 filter 动画、不用 box-shadow 动画，省显卡。
export const GIFT_FX_CSS = `
.gfx-stage { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 60; contain: strict; }
.gfx-stage * { box-sizing: border-box; }
.gfx-stage img { user-select: none; -webkit-user-drag: none; }
.gfx-layer { position: absolute; inset: 0; }
.gfx-center { position: absolute; left: 50%; top: 42%; width: var(--s, 180px); height: var(--s, 180px); margin: calc(var(--s, 180px) / -2) 0 0 calc(var(--s, 180px) / -2); will-change: transform, opacity; }
.gfx-center img { width: 100%; height: 100%; object-fit: contain; }

/* 底部说明条：谁送了什么 ×N（数字不是 emoji） */
.gfx-cap { position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; max-width: calc(100% - 32px);
  padding: 6px 14px 6px 6px; border-radius: 999px; background: rgba(12, 12, 16, .62); color: #fff; font: 600 14px/1.2 system-ui, -apple-system, sans-serif;
  white-space: nowrap; animation: gfxCap var(--d, 2.6s) ease both; }
.gfx-cap img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex: none; }
.gfx-cap .gfx-gi { border-radius: 0; object-fit: contain; }
.gfx-cap span { overflow: hidden; text-overflow: ellipsis; }
.gfx-cap b { font-weight: 800; color: #ffd66b; font-variant-numeric: tabular-nums; }
@keyframes gfxCap { 0% { opacity: 0; transform: translate(-50%, 12px); } 12%, 85% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -6px); } }

/* 通用入场：弹入 → 轻飘 → 淡出 */
.gfx-pop { animation: gfxPop var(--d, 2.2s) cubic-bezier(.2, .9, .3, 1) both; }
@keyframes gfxPop { 0% { opacity: 0; transform: scale(.2); } 18% { opacity: 1; transform: scale(1.12); } 28% { transform: scale(.96); } 36% { transform: scale(1); }
  80% { opacity: 1; transform: translateY(-18px) scale(1); } 100% { opacity: 0; transform: translateY(-40px) scale(.9); } }

/* 爱心飘升：同一张图复用 */
.gfx-float { position: absolute; bottom: -80px; left: var(--x); width: var(--w); height: var(--w); opacity: 0; will-change: transform, opacity;
  animation: gfxFloat var(--t) ease-out var(--dl) both; }
.gfx-float img { width: 100%; height: 100%; object-fit: contain; }
@keyframes gfxFloat { 0% { opacity: 0; transform: translate(0, 0) scale(.6) rotate(var(--r0)); } 15% { opacity: 1; }
  50% { transform: translate(var(--dx), -38vh) scale(1) rotate(0deg); } 85% { opacity: .9; } 100% { opacity: 0; transform: translate(calc(var(--dx) * -.5), -78vh) scale(.9) rotate(var(--r1)); } }

/* 猫咪币雨（和官网「不仅如此」那屏同一套：近大远小、只动 transform / opacity） */
.gfx-coin { position: absolute; top: -14vh; left: var(--x); width: var(--w); height: auto; opacity: 0; will-change: transform, opacity;
  animation: gfxCoin var(--t) linear var(--dl) both; }
@keyframes gfxCoin { 0% { opacity: 0; transform: translate(0, 0) rotate(var(--r0)); } 8% { opacity: var(--o); } 86% { opacity: var(--o); }
  100% { opacity: 0; transform: translate(var(--dx), 130vh) rotate(var(--r1)); } }
.gfx-combo { position: absolute; z-index: 2; right: 6%; top: 18%; color: #fff; font: 900 38px/1 system-ui, -apple-system, sans-serif; font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 0 rgba(0, 0, 0, .35); animation: gfxBump .35s cubic-bezier(.2, 1.4, .4, 1) both; }
.gfx-combo small { display: block; font-size: 14px; font-weight: 700; opacity: .85; margin-bottom: 4px; text-align: right; }
@keyframes gfxBump { 0% { transform: scale(1.5); } 100% { transform: scale(1); } }

/* 暴涨 K 线：一根根绿柱往上冲出屏幕 + 数字跳 */
.gfx-candle { position: absolute; bottom: -180px; left: var(--x); width: var(--w); height: var(--h); will-change: transform, opacity;
  animation: gfxCandle var(--t) cubic-bezier(.45, 0, .7, 1) var(--dl) both; }
.gfx-candle::before { content: ''; position: absolute; left: 50%; top: -18%; bottom: -18%; width: 2px; margin-left: -1px; background: #3dff9a; opacity: .8; }
.gfx-candle::after { content: ''; position: absolute; inset: 0; border-radius: 3px; background: linear-gradient(#5dffb0, #13c46b); }
@keyframes gfxCandle { 0% { opacity: 0; transform: translateY(0); } 8% { opacity: 1; } 100% { opacity: 1; transform: translateY(calc(-100vh - 360px)); } }
.gfx-pct { position: absolute; left: 50%; top: 20%; transform: translateX(-50%); color: #3dff9a; font: 900 56px/1 system-ui, -apple-system, sans-serif;
  font-variant-numeric: tabular-nums; text-shadow: 0 3px 0 rgba(0, 0, 0, .35); animation: gfxPct var(--d, 2.8s) ease both; }
@keyframes gfxPct { 0% { opacity: 0; transform: translate(-50%, 20px) scale(.8); } 15%, 85% { opacity: 1; transform: translate(-50%, 0) scale(1); } 100% { opacity: 0; transform: translate(-50%, -20px) scale(1.05); } }

/* 玫瑰：花在中间，花瓣飘落（花瓣是手写 SVG） */
.gfx-petal { position: absolute; top: -8vh; left: var(--x); width: var(--w); height: var(--w); opacity: 0; will-change: transform, opacity;
  animation: gfxPetal var(--t) ease-in var(--dl) both; }
@keyframes gfxPetal { 0% { opacity: 0; transform: translate(0, 0) rotate(var(--r0)); } 12% { opacity: .95; } 80% { opacity: .9; }
  100% { opacity: 0; transform: translate(var(--dx), 90vh) rotate(var(--r1)); } }

/* 火箭：左下斜飞到右上，带抖动；烟团只缩放 + 淡出 */
.gfx-fly { position: absolute; width: var(--s); height: var(--s); will-change: transform, opacity; }
.gfx-fly img { width: 100%; height: 100%; object-fit: contain; }
.gfx-rocket { left: 8%; bottom: -30%; animation: gfxRocket var(--d, 2.8s) cubic-bezier(.55, 0, .7, .4) both; }
@keyframes gfxRocket { 0% { opacity: 0; transform: translate(0, 0) scale(.8); } 8% { opacity: 1; } 20% { transform: translate(2vw, -12vh) scale(.95); }
  22% { transform: translate(calc(2vw + 3px), calc(-12vh - 2px)) scale(.95); } 24% { transform: translate(calc(2vw - 3px), -12vh) scale(.95); }
  100% { opacity: 1; transform: translate(80vw, -150vh) scale(1.1); } }
.gfx-puff { position: absolute; left: var(--x); bottom: var(--y); width: var(--w); height: var(--w); border-radius: 50%; background: radial-gradient(rgba(255, 255, 255, .9), rgba(210, 214, 228, 0) 70%);
  opacity: 0; will-change: transform, opacity; animation: gfxPuff 1.4s ease-out var(--dl) both; }
@keyframes gfxPuff { 0% { opacity: 0; transform: scale(.3); } 20% { opacity: .85; } 100% { opacity: 0; transform: scale(2.2) translateY(10px); } }

/* 跑车：从左边冲过屏幕，身后几道速度线 */
.gfx-car { left: -40%; top: 52%; animation: gfxCar var(--d, 2.4s) cubic-bezier(.5, 0, .3, 1) both; }
@keyframes gfxCar { 0% { opacity: 0; transform: translateX(0); } 10% { opacity: 1; } 45% { transform: translateX(78vw); } 60% { transform: translateX(84vw); }
  100% { opacity: 1; transform: translateX(185vw); } }
.gfx-streak { position: absolute; left: 0; top: var(--y); width: 30vw; height: 3px; border-radius: 3px; background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, .85));
  opacity: 0; will-change: transform, opacity; animation: gfxStreak .9s ease-out var(--dl) both; }
@keyframes gfxStreak { 0% { opacity: 0; transform: translateX(-30vw); } 30% { opacity: .9; } 100% { opacity: 0; transform: translateX(110vw); } }

/* 游艇：右边缓缓驶入、上下轻晃、驶出；水波是手写 SVG */
.gfx-yacht { right: -45%; top: 40%; animation: gfxYacht var(--d, 3s) cubic-bezier(.3, .2, .4, 1) both; }
.gfx-yacht img { animation: gfxBob 1s ease-in-out infinite alternate; }
@keyframes gfxYacht { 0% { opacity: 0; transform: translateX(0); } 12% { opacity: 1; } 55% { transform: translateX(-72vw); } 88% { opacity: 1; } 100% { opacity: 0; transform: translateX(-150vw); } }
@keyframes gfxBob { 0% { transform: translateY(0) rotate(-1.5deg); } 100% { transform: translateY(-8px) rotate(1.5deg); } }
.gfx-wave { position: absolute; left: -10%; width: 120%; height: 36px; opacity: 0; will-change: transform, opacity; animation: gfxWave var(--d, 3s) linear both; }
@keyframes gfxWave { 0% { opacity: 0; transform: translateX(0); } 15%, 85% { opacity: .7; } 100% { opacity: 0; transform: translateX(-8%); } }

/* 礼花：一块 canvas，播完移除 */
.gfx-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

/* 中本聪：暗场一闪，头像带故障抖动放大出现，几颗橙色火花 */
.gfx-dim { position: absolute; inset: 0; background: radial-gradient(circle at 50% 42%, rgba(0, 0, 0, 0) 20%, rgba(0, 0, 0, .55) 75%); animation: gfxDim var(--d, 2.6s) ease both; }
@keyframes gfxDim { 0% { opacity: 0; } 15%, 80% { opacity: 1; } 100% { opacity: 0; } }
.gfx-glitch { animation: gfxGlitch var(--d, 2.6s) steps(1, end) both; }
@keyframes gfxGlitch { 0% { opacity: 0; transform: scale(.6); } 6% { opacity: 1; transform: translate(-6px, 0) scale(1.05); } 9% { transform: translate(5px, 2px) scale(1.05); }
  12% { transform: translate(0, 0) scale(1); } 60% { opacity: 1; transform: scale(1.04); } 63% { transform: translate(4px, -2px) scale(1.04); } 66% { transform: scale(1.04); }
  88% { opacity: 1; } 100% { opacity: 0; transform: scale(1.12); } }
.gfx-spark { position: absolute; left: 50%; top: 42%; width: var(--w); height: var(--w); margin: calc(var(--w) / -2) 0 0 calc(var(--w) / -2); border-radius: 50%;
  background: radial-gradient(#ffd08a, #ff8a1f 55%, rgba(255, 138, 31, 0) 72%); opacity: 0; will-change: transform, opacity; animation: gfxSpark 1.2s ease-out var(--dl) both; }
@keyframes gfxSpark { 0% { opacity: 0; transform: translate(0, 0) scale(.4); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); } }

/* 上传的动画文件（动图 / 视频） */
.gfx-media { position: absolute; left: 50%; top: 45%; width: min(70vw, 420px); max-height: 70%; transform: translate(-50%, -50%); object-fit: contain; animation: gfxMedia var(--d, 4s) ease both; }
@keyframes gfxMedia { 0% { opacity: 0; } 8%, 92% { opacity: 1; } 100% { opacity: 0; } }

/* 减少动态效果：只显示静态图 + 说明，淡入淡出 */
.gfx-still { animation: gfxStill var(--d, 1.6s) ease both; }
@keyframes gfxStill { 0% { opacity: 0; } 15%, 85% { opacity: 1; } 100% { opacity: 0; } }
`

let injected = false
/** 第一次用到时把样式插进页面（服务端渲染 / 测试环境没有 document 就跳过） */
export function injectGiftFxCss() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const el = document.createElement('style')
  el.setAttribute('data-gift-fx', '')
  el.textContent = GIFT_FX_CSS
  document.head.appendChild(el)
}
