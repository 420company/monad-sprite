// 扫码登录电脑端：入口按钮 + 确认弹层。2026-09-28 起只放首页右上角（goat：「我」页和直播页的入口去掉，只留一个）。
// 认两种码：ox4meet = 0x4 Meet（会议和直播）；ox4admin = 管理后台 lord.420.meme（只有工作人员能登录，服务器扫码时就校验）。
// 扫到码先调 scan（电脑上会显示「请在手机上确认」），确认弹层里点「登录」才发令牌；关掉弹层 = 拒绝。
import { useEffect, useRef, useState } from 'react'
import { Laptop, ScanLine, ShieldCheck } from 'lucide-react'
import Button from '@/components/Button'
import Sheet from '@/components/Sheet'
import { toast } from '@/components/Toast'
import { meetApprove, meetDeny, meetScan, parseLoginQr, scanQrCode, type LoginQr } from '@/lib/meetLogin'
import { ensureStaffProof } from '@/lib/staff'
import { useSocial } from '@/store/social'
import { t } from '@/lib/i18n'
import { isNative } from '@/lib/native'
import { canWebScan } from '@/lib/webQrScan'
import { errorText } from '@/lib/errors'
import { regionName } from '@/components/MeetSessionsSheet'

/** 手机 App 用系统扫码插件；网页版在手机浏览器里用摄像头扫（lib/webQrScan，2026-09-27）。电脑浏览器上不显示入口 */
export default function MeetScan(props: { variant?: 'icon' | 'button' | 'row' }) {
  return isNative || canWebScan() ? <MeetScanNative {...props} /> : null
}

/** initialRaw：手机相机扫码打开的网址里带的码（/pc-login 页用），有它就不再调摄像头，直接进确认；onDone：确认或拒绝之后回调 */
export function MeetScanNative({ variant = 'icon', initialRaw, onDone }: { variant?: 'icon' | 'button' | 'row' | 'none'; initialRaw?: string; onDone?: () => void }) {
  const status = useSocial((s) => s.status)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ qr: LoginQr; device: string; app?: 'meet' | 'game' | 'web'; region?: string | null } | null>(null)
  const [deciding, setDeciding] = useState<'approve' | 'trust' | 'deny' | null>(null)

  const start = async (given?: string) => {
    if (busy) return
    setBusy(true)
    try {
      const raw = given ?? await scanQrCode()
      if (!raw) return
      const qr = parseLoginQr(raw)
      if (!qr) { toast.error(t('这不是 0x4 的电脑端登录码')); return }
      // 管理后台：钱包绑定的 EVM 地址第一次用来登录时，要用它签一次名证明归属（不花 gas）
      if (qr.kind === 'admin') await ensureStaffProof()
      const r = await meetScan(qr)
      setPending({ qr, device: r.device, app: r.app, region: r.region ?? null })
    } catch (e) { toast.error(errorText(e, t('扫码失败'))) } finally { setBusy(false) }
  }
  // 从网址打开：社交登录好了就直接进确认（只跑一次）
  const fired = useRef(false)
  useEffect(() => {
    if (!initialRaw || fired.current || status !== 'ready') return
    fired.current = true
    void start(initialRaw).then(() => { if (!parseLoginQr(initialRaw)) onDone?.() })
  }, [initialRaw, status]) // eslint-disable-line react-hooks/exhaustive-deps
  // trust：网页版才有「信任此设备」（2026-10-01 goat），别的电脑端照旧
  const decide = async (ok: boolean, trust?: boolean) => {
    if (!pending || deciding) return
    setDeciding(ok ? (trust ? 'trust' : 'approve') : 'deny')
    try {
      if (ok) { await meetApprove(pending.qr, pending.app === 'web' && pending.qr.kind !== 'admin' ? !!trust : undefined); toast.success(pending.qr.kind === 'admin' ? t('管理后台已登录') : t('电脑已登录')) } else await meetDeny(pending.qr)
    } catch (e) { if (ok) toast.error(errorText(e, t('登录失败'))) } finally { setDeciding(null); setPending(null); onDone?.() }
  }
  const admin = pending?.qr.kind === 'admin'
  const game = !admin && pending?.app === 'game'
  // 0x4 网页版扫码登录（2026-10-01，meet.420.meme 下线后电脑开会都在网页版）
  const web = !admin && pending?.app === 'web'

  return <>
    {variant === 'none' ? null : variant === 'row'
      ? <button onClick={() => void start()} disabled={status !== 'ready' || busy} className="glass-lite flex w-full items-center gap-4 rounded-[24px] px-5 py-4 text-left disabled:opacity-60"><ScanLine size={22} className="shrink-0 text-accent" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{t('扫码')}</span><span className="mt-0.5 block text-xs text-muted">{t('扫电脑上的二维码，登录 0x4 网页版、赛博伊甸园')}</span></span></button>
      : variant === 'icon'
      ? <button onClick={() => void start()} disabled={status !== 'ready' || busy} className="icon-button" aria-label={t('扫码登录电脑')} data-tooltip={t('扫码登录电脑')}><ScanLine size={20} /></button>
      : <Button size="sm" variant="secondary" loading={busy} disabled={status !== 'ready'} onClick={() => void start()}><Laptop size={16} />{t('电脑端登录')}</Button>}
    <Sheet open={!!pending} onClose={() => void decide(false)} title={admin ? t('登录 0x4 管理后台？') : game ? t('在电脑上登录赛博伊甸园？') : web ? t('在电脑上登录 0x4 网页版？') : t('在电脑上登录 0x4 Meet？')} dismissible={!deciding}>
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-2xl bg-card2 px-4 py-3.5">
          {admin ? <ShieldCheck size={22} className="shrink-0 text-accent" /> : <Laptop size={22} className="shrink-0 text-muted" />}
          <div className="min-w-0"><div className="truncate text-[15px] font-semibold">{pending?.device}</div><div className="mt-0.5 text-xs text-muted">{admin ? 'lord.420.meme' : game ? 'game.420.meme' : web ? t('0x4 网页版') : 'meet.420.meme'}{regionName(pending?.region) ? ` · ${t('电脑所在地区：{place}', { place: regionName(pending?.region) })}` : ''}</div></div>
        </div>
        {/* 设备描述是电脑自己报的，可以造假；地区来自网络，更可信。提醒本人对一下（2026-10-01 安全审查 #7） */}
        <p className="-mt-2 text-xs text-muted" data-testid="scan-confirm-hint">{t('请确认这是你本人刚刚在电脑上打开的二维码')}</p>
        {admin
          ? <p className="text-sm text-muted">{t('管理后台可以删除内容、处理举报和工单，所有操作都会记录。8 小时后自动退出，也可以随时在「我 → 安全 → 已登录的电脑」里移除。只在自己的电脑上登录。')}</p>
          : <p className="text-sm text-muted">{game ? t('电脑端只能查看你的小精灵和赛博伊甸园，不能转账、交易或查看私信。可以随时在「我 → 安全 → 已登录的电脑」里移除。') : web ? t('电脑上可以开会、看直播、聊天和发动态。转账、交易、送礼要在电脑上连接钱包，私信只在手机上看。随时可以在「我 → 安全 → 已登录的电脑」里让它下线。') : t('电脑端只能使用会议和直播，不能转账、交易或查看私信。可以随时在「我 → 安全 → 已登录的电脑」里移除。')}</p>}
        <p className="text-xs text-warning">{t('如果不是你本人刚刚在电脑上打开的二维码，请点「不是我」。')}</p>
        {web ? <>
          {/* 网页版：信任此设备 = 登录保留 30 天；仅本次 = 公共电脑，关掉浏览器或长时间没有操作就退出 */}
          <div className="rounded-2xl bg-card2 px-4 py-3.5" data-testid="trust-ask">
            <div className="text-[15px] font-semibold">{t('要信任此设备吗？')}</div>
            <div className="mt-1 text-xs text-muted">{t('信任后登录状态保留 30 天')}</div>
            <div className="mt-1 text-xs text-muted">{t('网吧、公司或别人的电脑，请选「仅本次登录」。')}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" disabled={!!deciding} loading={deciding === 'approve'} onClick={() => void decide(true, false)} data-testid="login-once">{t('仅本次登录')}</Button>
            <Button disabled={!!deciding} loading={deciding === 'trust'} onClick={() => void decide(true, true)} data-testid="login-trust">{t('信任并登录')}</Button>
          </div>
          <button type="button" className="w-full py-1 text-center text-sm text-muted disabled:opacity-60" disabled={!!deciding} onClick={() => void decide(false)}>{t('不是我')}</button>
        </> : <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" disabled={!!deciding} loading={deciding === 'deny'} onClick={() => void decide(false)}>{t('不是我')}</Button>
          <Button disabled={!!deciding} loading={deciding === 'approve'} onClick={() => void decide(true)}>{t('登录')}</Button>
        </div>}
      </div>
    </Sheet>
  </>
}
