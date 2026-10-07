// 注销账号（2026-10-02 goat，上架要求：能创建账号就必须能在 App 里删除账号）。
// 先把会发生什么列清楚（服务器给的预览：小精灵、我是群主的群、余额），勾选确认后才执行；不可恢复。
// 注销的是 0x4 账号（服务器上的资料和内容），不是钱包：私钥和链上的币都不受影响。
import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import Sheet from '@/components/Sheet'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { deleteAccount, previewDeleteAccount, revokeTerms, useTermsGate, type DeletePreview } from '@/lib/safety'
import { useSocial, walletKey } from '@/store/social'
import { fmtMoney } from '@/lib/format'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

export default function AccountDeleteSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const [pv, setPv] = useState<DeletePreview | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [sure, setSure] = useState(false)
  const [forfeit, setForfeit] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    let alive = true
    setPv(null); setFailed(null); setSure(false); setForfeit(false)
    previewDeleteAccount().then((r) => { if (alive) setPv(r) }).catch((e) => { if (alive) setFailed(errorText(e, t('暂时无法加载'))) })
    return () => { alive = false }
  }, [open])

  const money = pv ? pv.balance + pv.earnings : 0
  const hasMoney = money > 0.01
  const run = async () => {
    if (!pv || busy || !sure || (hasMoney && !forfeit)) return
    setBusy(true)
    try {
      const key = walletKey()
      await deleteAccount(hasMoney)
      // 同意条款的记录清掉：之后不会自动又建一个新账号，想再用社交功能要重新同意
      if (key) revokeTerms(key)
      useTermsGate.setState({ open: false, dismissed: true })
      useSocial.getState().logout(true)
      // 界面上显示成「还没启用社交功能」（有重新同意的入口），而不是一直「连接中」
      useSocial.setState({ needTerms: true })
      toast.success(t('账号已注销'))
      onClose()
      onDone?.()
    } catch (e) { toast.error(errorText(e, t('注销失败'))) } finally { setBusy(false) }
  }

  const li = 'flex gap-2.5 text-sm leading-relaxed'
  const dot = <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" aria-hidden="true" />
  return (
    <Sheet open={open} onClose={onClose} title={t('注销账号')} dismissible={!busy}>
      {failed ? <p className="text-sm text-muted">{failed}</p>
        : !pv ? <div className="space-y-3"><div className="skeleton h-5" /><div className="skeleton h-5" /><div className="skeleton h-24" /></div>
          : pv.staff ? <p className="text-sm leading-relaxed text-muted">{t('工作人员账号不能自助注销，请先联系管理员移除身份。')}</p>
            : <>
              <div className="flex items-start gap-2.5 rounded-xl bg-down/10 px-3.5 py-3 text-sm leading-relaxed text-down"><TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{t('注销后无法恢复。同一个钱包以后再用社交功能，会是一个全新的空账号。')}</span></div>
              <h3 className="ui-label mt-5">{t('会被删除')}</h3>
              <ul className="mt-2 space-y-2">
                <li className={li}>{dot}<span>{t('你的资料、动态、评论、点赞、关注和粉丝、私信、群聊里你发的消息、通知。')}</span></li>
                {pv.sprites.length > 0 && <li className={li}>{dot}<span>{t('小精灵（{names}）会立即停止并释放。它们开的仓位留在你自己的钱包和合约账户里，不会自动平仓，请自己处理。', { names: pv.sprites.map((s) => s.name).join('、') })}</span></li>}
                {pv.groupsTransfer.length > 0 && <li className={li}>{dot}<span>{t('你是群主的群（{names}）会转给最早的管理员或成员。', { names: pv.groupsTransfer.map((g) => g.name).join('、') })}</span></li>}
                {pv.groupsDissolve.length > 0 && <li className={li}>{dot}<span>{t('只剩你一个人的群（{names}）会解散。', { names: pv.groupsDissolve.map((g) => g.name).join('、') })}</span></li>}
              </ul>
              <h3 className="ui-label mt-5">{t('不受影响')}</h3>
              <ul className="mt-2 space-y-2">
                <li className={li}>{dot}<span>{t('你的钱包：私钥和链上的币都还在这台设备上，注销的是 0x4 账号，不是钱包。')}</span></li>
                {pv.pendingEarnings > 0.01 && <li className={li}>{dot}<span>{t('还没到账的直播收益会照常在下次结算时打到你的钱包。')}</span></li>}
                <li className={li}>{dot}<span>{t('充值、提现、打赏等资金流水和封禁记录会按对账和法律要求保留。')}</span></li>
              </ul>
              {hasMoney && (
                <label className="mt-5 flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 text-sm leading-relaxed">
                  <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-down)]" />
                  <span>{t('账号里还有 {amount} 站内余额。注销后拿不回来；想留着请先在网页版提出。我确定放弃这笔余额。', { amount: fmtMoney(money) })}</span>
                </label>
              )}
              <label className="mt-4 flex items-start gap-2.5 text-sm leading-relaxed">
                <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-down)]" data-testid="delete-sure" />
                <span>{t('我已了解，注销后无法恢复。')}</span>
              </label>
              <Button className="mt-5 w-full" size="lg" variant="danger" disabled={!sure || (hasMoney && !forfeit)} loading={busy} onClick={() => void run()} data-testid="delete-go">{t('永久注销账号')}</Button>
            </>}
    </Sheet>
  )
}
