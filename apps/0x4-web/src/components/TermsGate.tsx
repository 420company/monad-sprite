// 同意条款（2026-10-02 goat，上架要求）：第一次使用社交功能（= 在服务器上创建账号）之前，要先同意《服务条款》和《隐私政策》，
// 条款里写明不许发布违法、色情、骚扰等内容。没同意：钱包照常用，社交功能不登录。全站只有一个，挂在 App 里。
// 注销账号以后同意记录会清掉，想重新用社交功能要在这里再同意一次。
// 2026-10-03 goat：文案缩短、排版改成三行「图标 + 小标题 + 一句话」，同意那句放在按钮上面。
import { Flag, ShieldAlert, Wallet } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import { acceptTerms, useTermsGate } from '@/lib/safety'
import { legalUrl } from '@/lib/legal'
import { useSocial, walletKey } from '@/store/social'
import { openExternal } from '@/lib/native'
import { t } from '@/lib/i18n'

export const TERMS_URL = 'https://420.meme/terms/'
export const PRIVACY_URL = 'https://420.meme/privacy/'

export default function TermsGate() {
  const open = useTermsGate((s) => s.open)
  const hide = useTermsGate((s) => s.hide)
  const rows = [
    { Icon: ShieldAlert, title: t('内容有底线'), text: t('违法、色情、暴力、骚扰、诈骗类内容会被删除，严重的封号。') },
    { Icon: Flag, title: t('举报和拉黑'), text: t('看到不合适的内容可以举报，不想被打扰可以拉黑。') },
    { Icon: Wallet, title: t('钱包不受影响'), text: t('不同意也能照常使用钱包和交易，只是用不了社交功能。') },
  ]
  const agree = () => {
    const key = walletKey()
    if (key) acceptTerms(key)
    hide()
    void useSocial.getState().login()
  }
  const link = (url: string, label: string) => (
    <button type="button" onClick={() => void openExternal(legalUrl(url))} className="font-semibold text-accent underline decoration-accent/40 underline-offset-2">{label}</button>
  )
  return (
    <Sheet open={open} onClose={() => hide(true)} title={t('加入社区前')}>
      <p className="text-[15px] leading-relaxed text-muted">{t('动态、评论、群聊、私信和直播是公共空间。')}</p>
      <ul className="mt-4 space-y-3">
        {rows.map(({ Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-card2 text-accent" aria-hidden="true"><Icon size={18} /></span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">{title}</div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{text}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[13px] leading-relaxed text-muted">
        {t('点「同意并继续」即表示你已阅读并同意')}{link(TERMS_URL, t('服务条款'))}{t('和')}{link(PRIVACY_URL, t('隐私政策'))}{t('。')}
      </p>
      <Button className="mt-3 w-full" size="lg" onClick={agree} data-testid="terms-agree">{t('同意并继续')}</Button>
      <Button className="mt-2 w-full" variant="secondary" onClick={() => hide(true)}>{t('以后再说')}</Button>
    </Sheet>
  )
}
