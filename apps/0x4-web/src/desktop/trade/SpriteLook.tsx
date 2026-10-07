// Chart toolbar "Ask the sprite" (2026-10-02 goat 3rd batch): let your sprite glance at the current chart and say in its own voice what it sees, in two or three sentences.
// · Commentary only, no orders: nothing trade-related is sent here; the sprite still trades only on its own signals
// · Asking happens on button tap (the answer stays, still there on reopen; changing coin or timeframe counts as a new chart); each sprite shares 30 messages/hour with chat
// · Not logged in → please connect a wallet; no sprite → point to the sprite page; all asleep → say so clearly
// · It only gets the chart's public market data and the position's proportion (see lib/chartBrief.ts) — no quantities, amounts, or keys
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
  /** A changed coin or timeframe is a different chart: the previous answer no longer shows */
  chartKey: string
  /** Snapshot the current chart at the moment "Ask" is tapped; null when candles haven't loaded yet */
  getBrief: () => ChartBrief | null
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { status, me } = useSocial()
  const lang = useLang((s) => s.lang)
  const signedIn = status === 'ready' && !!me
  /** undefined = not read yet, null = read failed */
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
  // Read my sprite once when the panel opens; re-read on account switch
  useEffect(() => { if (open && signedIn) loadFlies() }, [open, signedIn, me?.address]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFlies(undefined); setAsk({ status: 'idle' }); askedFor.current = '' }, [me?.address])
  // Chart changed: tuck away the previous answer, void the in-flight ask
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
  // Panel opened, sprite loaded, this chart never asked: ask right away (tapping the button means wanting to hear it)
  useEffect(() => {
    if (open && fly && ask.status === 'idle' && askedFor.current !== `${chartKey}|${fly.id}`) void run(fly)
  }, [open, fly?.id, chartKey, ask.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (id: string) => {
    setPick(id)
    try { localStorage.setItem(PICK_KEY, id) } catch { /* Works even if it can't persist */ }
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
