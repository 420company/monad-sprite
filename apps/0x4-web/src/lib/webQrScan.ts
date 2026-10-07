// 网页版扫码（2026-09-27 goat：App 里要有扫码）。原生 App 用 @capacitor/barcode-scanner；
// 网页版（手机浏览器打开 app.420.meme）用摄像头：浏览器自带 BarcodeDetector 优先，没有就用 jsQR（点扫码时才加载）。
// 纯 DOM 实现，返回 Promise：扫到返回内容，用户点取消返回 null，没有摄像头权限抛错。
import { t } from './i18n'

type Detect = (v: HTMLVideoElement, c: HTMLCanvasElement) => Promise<string | null>

async function makeDetector(): Promise<Detect> {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
  if (BD) {
    try {
      const d = new BD({ formats: ['qr_code'] })
      return async (v) => { const r = await d.detect(v); return r[0]?.rawValue || null }
    } catch { /* 不支持 qr_code，退回 jsQR */ }
  }
  const { default: jsQR } = await import('jsqr')
  return async (v, c) => {
    const w = v.videoWidth, h = v.videoHeight
    if (!w || !h) return null
    // 缩到 640 宽以内再识别，手机上够快
    const s = Math.min(1, 640 / w)
    c.width = Math.round(w * s); c.height = Math.round(h * s)
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return null
    g.drawImage(v, 0, 0, c.width, c.height)
    const img = g.getImageData(0, 0, c.width, c.height)
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null
  }
}

/** 这个浏览器能不能扫码：有摄像头接口就显示入口（2026-09-27 goat：电脑上也要看得到，原来只在触屏设备上显示） */
export const canWebScan = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export function webScanQr(hint = t('对准电脑上的二维码')): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const root = document.createElement('div')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', t('扫码'))
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center'
    root.innerHTML = `
      <video playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
      <div style="position:relative;width:min(70vw,280px);aspect-ratio:1;border-radius:24px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.9)"></div>
      <p style="position:relative;margin-top:22px;color:#fff;font:500 15px -apple-system,system-ui,sans-serif;text-align:center;padding:0 24px"></p>
      <button type="button" style="position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 32px);min-height:48px;padding:0 28px;border-radius:999px;border:0;background:rgba(255,255,255,.18);color:#fff;font:600 16px -apple-system,system-ui,sans-serif;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)"></button>`
    const video = root.querySelector('video')!, tip = root.querySelector('p')!, cancel = root.querySelector('button')!
    tip.textContent = hint
    cancel.textContent = t('取消')
    const canvas = document.createElement('canvas')
    let stream: MediaStream | null = null, done = false, timer = 0
    const finish = (v: string | null, err?: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
      root.remove()
      if (err) reject(err); else resolve(v)
    }
    cancel.onclick = () => finish(null)
    document.body.appendChild(root)
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (done) { stream.getTracks().forEach((tr) => tr.stop()); return }
        video.srcObject = stream
        await video.play().catch(() => {})
        const detect = await makeDetector()
        const loop = async () => {
          if (done) return
          try { const v = await detect(video, canvas); if (v) return finish(v) } catch { /* 这一帧失败，下一帧再试 */ }
          timer = window.setTimeout(loop, 200)
        }
        loop()
      } catch (e) {
        finish(null, Object.assign(new Error(t('无法打开摄像头，请在浏览器设置里允许使用摄像头')), { cause: e }))
      }
    })()
  })
}
