// 新用户引导：创建钱包 / 导入钱包
import { useId, useState } from 'react'
import { CatMark, PixelTitle, T, timelineFor, useIntroPlay } from '@/components/welcome/WelcomeIntro'
import FluidBackground from '@/components/welcome/FluidBackground'
import { Route, Routes, useNavigate, Link, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Copy, Eye, EyeOff, LockKeyhole } from 'lucide-react'
import Button from '@/components/Button'
import { Input, Label, Textarea } from '@/components/Field'
import MnemonicInput from '@/components/MnemonicInput'
import { toast } from '@/components/Toast'
import { useWallet } from '@/store/wallet'
import { useSettings } from '@/store/settings'
import { isValidMnemonic, classifySecret } from '@/lib/wallet'
import { copyText } from '@/lib/native'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
// 建好钱包后回到扫码登录 / 分享的直播（lib/afterUnlock.ts，2026-10-04 走查）
import { takeAfterUnlock } from '@/lib/afterUnlock'

// 欢迎页（没有钱包时）：像素开场，背景是全局液态流体，时间线与效果见 components/welcome/WelcomeIntro.tsx
function Welcome() {
  // 本次打开 App 第一次进欢迎页才完整播开场；从创建 / 导入页返回时直接在位（WelcomeIntro useIntroPlay）
  const intro = useIntroPlay(T)
  return (
    <div className={`welcome-stage safe-top${intro.play ? '' : ' is-replay'}`} style={timelineFor(intro.tl)}>
      <FluidBackground />
      <div className="welcome-content">
        <div className="welcome-brand">
          <CatMark tl={intro.tl} play={intro.play} />
          <PixelTitle tl={intro.tl} still={!intro.play} />
        </div>
        <div className="welcome-actions">
          <Link to="/onboarding/create" className="ui-button welcome-cta pearl-button">{t('创建新钱包')}<ArrowRight size={18} strokeWidth={1.75} /></Link>
          <Link to="/onboarding/import" className="ui-button welcome-cta glass-lite text-fg">{t('导入已有钱包')}</Link>
        </div>
        <p className="welcome-note"><LockKeyhole size={13} strokeWidth={1.75} />{t('私钥仅保存在本机')}</p>
      </div>
    </div>
  )
}

function PasswordForm({ onSubmit, loading, label = t('继续') }: { onSubmit: (pw: string) => void; loading?: boolean; label?: string }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const id = useId()
  const ok = pw.length >= 8 && pw === pw2
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={`${id}-password`}>{t('请设置解锁密码，至少 8 位')}</Label>
        <div className="relative">
          <Input id={`${id}-password`} className="pr-14" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('密码')} autoComplete="new-password" aria-describedby={`${id}-hint`} />
          <button type="button" onClick={() => setShow(!show)} className="icon-button absolute right-1 top-1" aria-label={show ? t('隐藏密码') : t('显示密码')} aria-pressed={show} data-tooltip={show ? t('隐藏密码') : t('显示密码')}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </div>
      </div>
      <div>
        <Label htmlFor={`${id}-confirm`}>{t('再次输入密码')}</Label>
        <Input id={`${id}-confirm`} type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={t('确认密码')} autoComplete="new-password" aria-invalid={!!pw2 && pw !== pw2} aria-describedby={pw2 && pw !== pw2 ? `${id}-error` : undefined} />
        {pw2 && pw !== pw2 && <div id={`${id}-error`} className="mt-2 text-[13px] text-down">{t('两次输入不一致')}</div>}
      </div>
      <p id={`${id}-hint`} className="text-[13px] leading-relaxed text-muted">{t('助记词或私钥是找回密码的唯一方式，请妥善备份。')}</p>
      <Button size="lg" className="w-full" disabled={!ok} loading={loading} onClick={() => onSubmit(pw)}>{label}</Button>
    </div>
  )
}

function Create() {
  const nav = useNavigate()
  const createWallet = useWallet((s) => s.createWallet)
  const [loading, setLoading] = useState(false)
  return (
    <Page title={t('创建新钱包')}>
      <PasswordForm
        loading={loading}
        label={t('生成钱包')}
        onSubmit={async (pw) => {
          setLoading(true)
          try {
            const m = await createWallet(pw)
            nav('/onboarding/backup', { state: { mnemonic: m }, replace: true })
          } catch (e) {
            toast.error(errorText(e, t('创建失败')))
          } finally {
            setLoading(false)
          }
        }}
      />
    </Page>
  )
}

function Backup() {
  const nav = useNavigate()
  const setBackedUp = useSettings((s) => s.setBackedUp)
  const [agree, setAgree] = useState(false)
  const [reveal, setReveal] = useState(false)
  const mnemonic = (useLocation().state as { mnemonic?: string } | null)?.mnemonic
  if (!mnemonic) {
    nav(takeAfterUnlock(), { replace: true })
    return null
  }
  const words = mnemonic.split(' ')
  return (
    <Page title={t('备份助记词')} back={false}>
      <p className="text-sm text-muted">{t('按顺序记录在安全的地方。')}</p>
      <div className="relative mt-5 grid grid-cols-3 gap-2 rounded-lg border border-line bg-card p-3">
        {words.map((w, i) => (
          <div key={i} className="min-h-11 break-all px-1 py-2 text-sm"><span className="number mr-1.5 text-xs text-muted">{i + 1}.</span>{w}</div>
        ))}
        {!reveal && (
          <button onClick={() => setReveal(true)} className="absolute inset-0 flex items-center justify-center rounded-lg bg-card text-sm font-semibold">
            <Eye size={18} className="mr-2" /> {t('点击显示助记词')}
          </button>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => copyText(mnemonic).then(() => toast.success(t('已复制，请注意剪贴板安全')))}
      >
        <Copy size={16} /> {t('复制')}
      </Button>
      <label className="mt-6 flex min-h-11 items-start gap-3 text-sm leading-relaxed">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-accent" />
        {t('我已经完成备份')}
      </label>
      <Button size="lg" className="mt-6 w-full" disabled={!agree} onClick={() => { setBackedUp(true); nav(takeAfterUnlock(), { replace: true }) }}>{t('进入钱包')}</Button>
      {/* 借鉴 DeBox：允许先进钱包，首页会持续提醒直到备份完成 */}
      <Button size="md" variant="ghost" className="mt-2 w-full text-muted" onClick={() => { setBackedUp(false); nav(takeAfterUnlock(), { replace: true }) }}>{t('先跳过，稍后在「我」里备份')}</Button>
    </Page>
  )
}

function Import() {
  const nav = useNavigate()
  const { importMnemonic, importSecret } = useWallet()
  const [mode, setMode] = useState<'mnemonic' | 'secret'>('mnemonic')
  const [text, setText] = useState('')
  const [complete, setComplete] = useState(false) // 助记词格子是否已填满，没填满不提前报错
  const [loading, setLoading] = useState(false)
  const id = useId()
  // 私钥：识别是 EVM 还是 Solana，识别不出就不让提交
  const secretKind = mode === 'secret' ? classifySecret(text) : null
  const valid = mode === 'mnemonic' ? complete && isValidMnemonic(text) : !!secretKind
  const showError = mode === 'mnemonic' ? complete && !valid : !!text && !valid
  return (
    <Page title={t('导入钱包')}>
      <div className="mb-5 flex gap-6 border-b border-line" role="group" aria-label={t('导入方式')}>
        {(['mnemonic', 'secret'] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setText(''); setComplete(false) }} className="view-tab" aria-pressed={mode === m}>
            {m === 'mnemonic' ? t('助记词') : t('私钥')}
          </button>
        ))}
      </div>
      {mode === 'mnemonic' ? (
        <>
          <Label>{t('按顺序输入助记词，支持整串粘贴')}</Label>
          <MnemonicInput onChange={(m, done) => { setText(m); setComplete(done) }} />
        </>
      ) : (
        <>
          <Label htmlFor={`${id}-secret`}>{t('EVM 私钥（0x 开头）或 Solana 私钥')}</Label>
          <Textarea id={`${id}-secret`} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('输入私钥')} autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-invalid={showError} aria-describedby={showError ? `${id}-error` : undefined} />
        </>
      )}
      {showError && <div id={`${id}-error`} className="mt-2 text-[13px] text-down">{mode === 'mnemonic' ? t('这组助记词校验不通过，请检查单词拼写和顺序') : t('私钥格式不对。请粘贴 EVM 私钥（0x 开头）或 Solana 私钥')}</div>}
      {secretKind && <div className="mt-2 text-[13px] text-muted">{secretKind === 'evm' ? t('已识别为 EVM 私钥') : t('已识别为 Solana 私钥')}</div>}
      <div className="mt-6">
        <PasswordForm
          loading={loading}
          label={t('导入')}
          onSubmit={async (pw) => {
            if (!valid) return
            setLoading(true)
            try {
              if (mode === 'mnemonic') await importMnemonic(text, pw)
              else await importSecret(text, pw)
              useSettings.getState().setBackedUp(true) // 导入的钱包用户已持有助记词 / 私钥
              nav(takeAfterUnlock(), { replace: true })
            } catch (e) {
              toast.error(errorText(e, t('导入失败')))
            } finally {
              setLoading(false)
            }
          }}
        />
      </div>
    </Page>
  )
}

function Page({ title, back = true, children }: { title: string; back?: boolean; children: React.ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="safe-top min-h-screen">
      <div className="onboarding-content">
        <div className="mb-7 flex min-h-11 items-center gap-2">
          {back && <button onClick={() => nav(-1)} className="icon-button -ml-2" aria-label={t('返回')} data-tooltip={t('返回')}><ArrowLeft size={21} /></button>}
          <h1 className="page-title">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function Onboarding() {
  return (
    <Routes>
      <Route index element={<Welcome />} />
      <Route path="create" element={<Create />} />
      <Route path="backup" element={<Backup />} />
      <Route path="import" element={<Import />} />
    </Routes>
  )
}
