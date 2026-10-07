// K 线工具栏「问小精灵」（2026-10-02 goat 第三批）：让自己的小精灵看一眼当前这张图，用它的口吻说两三句看到了什么。
// · 只点评、不下单：这里不发任何交易请求，小精灵的买卖仍然只按它自己的信号来
// · 点按钮就问（问完的回答留着，再打开还在；换了币或周期算新的一张图）；每只小精灵和聊天共用每小时 30 句
// · 没登录 → 请连接钱包；没有小精灵 → 引到小精灵页；都在休眠 → 说明白
// · 交给它的只有图上的公开行情和仓位的比例（见 lib/chartBrief.ts），没有数量、金额、密钥
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { api, type Fly } from '@/lib/social'
import { useSocial } from '@/store/social'
import { t, useLang } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { askSpriteLook, type LookReply } from '@/lib/spriteLook'
import type { ChartBrief } from '@/lib/chartBrief'
import { needWallet } from '../walletGate'
import Popover from './Popover'

const PICK_KEY = '0x4.lookFly'
const remembered = () => { try { return localStorage.getItem(PICK_KEY) || '' } catch { return '' } }

type Ask = { status: 'idle' } | { status: 'asking'; reply: LookReply | null } | { status: 'done'; reply: LookReply } | { status: 'error'; msg: string }

export default function SpriteLook({ chartKey, getBrief }: {
  /** 换了币或周期就是另一张图：上一张的回答不再显示 */
  chartKey: string
  /** 点「问」的那一刻整理当前这张图；K 线还没加载出来返回 null */
  getBrief: () => ChartBrief | null
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { status, me } = useSocial()
  const lang = useLang((s) => s.lang)
  const signedIn = status === 'ready' && !!me
  /** undefined = 还没读，null = 读取失败 */
  const [flies, setFlies] = useState<Fly[] | null | undefined>(undefined)
  const [pick, setPick] = useState(remembered)
  const [ask, setAsk] = useState<Ask>({ status: 'idle' })
  const askedFor = useRef('')
  const abort = useRef<AbortController | null>(null)

  const awake = useMemo(() => (flies ?? []).filter((f) => !f.expired), [flies])
  const fly = awake.find((f) => f.id === pick) ?? awake[0]

  const loadFlies = () => {
    setFlies(undefined)
    api<{ list: Fly[] }>('/api/flies/mine/all').then((r) => setFlies(r.list)).catch(() => setFlies(null))
  }
  // 打开面板时读一次自己的小精灵；换了账号重读
  useEffect(() => { if (open && signedIn) loadFlies() }, [open, signedIn, me?.address]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFlies(undefined); setAsk({ status: 'idle' }); askedFor.current = '' }, [me?.address])
  // 换了一张图：上一张的回答收起来，正在问的那次作废
  useEffect(() => { abort.current?.abort(); setAsk({ status: 'idle' }); askedFor.current = '' }, [chartKey])
  useEffect(() => () => abort.current?.abort(), [])

  const run = async (f: Fly) => {
    const brief = getBrief()
    if (!brief) { setAsk({ status: 'error', msg: t('K 线还没加载出来，稍等一下再问') }); return }
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    askedFor.current = `${chartKey}|${f.id}`
    setAsk({ status: 'asking', reply: null })
    try {
      const reply = await askSpriteLook(f.id, brief, (p) => { if (!ctrl.signal.aborted) setAsk({ status: 'asking', reply: p }) }, ctrl.signal)
      if (!ctrl.signal.aborted) setAsk({ status: 'done', reply })
    } catch (e) {
      if (ctrl.signal.aborted) return
      setAsk({ status: 'error', msg: errorText(e, t('它现在没有回应，稍后再试')) })
    }
  }
  // 打开面板、小精灵读到了、这张图还没问过：直接问（点按钮就是想听它说）
  useEffect(() => {
    if (open && fly && ask.status === 'idle' && askedFor.current !== `${chartKey}|${fly.id}`) void run(fly)
  }, [open, fly?.id, chartKey, ask.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (id: string) => {
    setPick(id)
    try { localStorage.setItem(PICK_KEY, id) } catch { /* 记不住也能用 */ }
    const f = awake.find((x) => x.id === id)
    if (f) void run(f)
  }
  const said = ask.status === 'asking' || ask.status === 'done' ? ask.reply : null
  const words = said ? (lang === 'en' ? said.textEn || said.text : said.text) : ''

  return (
    <>
      <button ref={btn} type="button" className={`tx-ask-btn ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog">
        <Sparkles size={13} aria-hidden="true" />{t('问小精灵')}
      </button>
      <Popover open={open} anchor={btn} onClose={() => setOpen(false)} width={340} label={t('问小精灵')} className="tx-ask-pop">
        {!signedIn ? (
          <div className="tx-ask-empty">
            <p>{t('连接钱包后，可以让你的小精灵帮你看这张图。')}</p>
            <button type="button" className="tx-btn tx-btn-sm" onClick={() => { setOpen(false); needWallet() }}>{t('连接钱包')}</button>
          </div>
        ) : flies === undefined ? (
          <div className="tx-ask-empty"><span className="tx-spin" aria-hidden="true" /><p>{t('正在找你的小精灵')}</p></div>
        ) : flies === null ? (
          <div className="tx-ask-empty"><p>{t('暂时读不到你的小精灵')}</p><button type="button" className="tx-btn tx-btn-sm" onClick={loadFlies}><RefreshCw size={13} aria-hidden="true" />{t('重试')}</button></div>
        ) : !fly ? (
          <div className="tx-ask-empty">
            <p>{flies.length ? t('你的小精灵都在休眠，醒着的才能帮你看图。') : t('你还没有小精灵。领养一只，它可以帮你看图。')}</p>
            <Link to="/flies" className="tx-btn tx-btn-sm" onClick={() => setOpen(false)}>{t('去小精灵页')}</Link>
          </div>
        ) : (
          <>
            <div className="tx-ask-head">
              <Sparkles size={14} aria-hidden="true" />
              {awake.length > 1
                ? <select aria-label={t('选一只小精灵')} value={fly.id} onChange={(e) => choose(e.target.value)} disabled={ask.status === 'asking'}>{awake.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                : <b>{fly.name}</b>}
              <button type="button" className="tx-btn tx-btn-sm" onClick={() => void run(fly)} disabled={ask.status === 'asking'}>
                {ask.status === 'asking' ? <LoaderCircle size={13} className="tx-spin-ic" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}{t('再看一次')}
              </button>
            </div>
            <div className="tx-ask-body" aria-live="polite">
              {ask.status === 'error' ? <p className="warn">{ask.msg}</p>
                : words ? <p>{words}{ask.status === 'asking' && <i className="tx-ask-caret" aria-hidden="true" />}</p>
                  : <p className="mute">{t('它正在看这张图…')}</p>}
            </div>
            <p className="tx-fine tx-ask-note">{t('它只是说说在图上看到的情况，不是投资建议，也不会替你下单。')}</p>
          </>
        )}
      </Popover>
    </>
  )
}
