// Spot order panel's "pay asset" dropdown (2026-09-29 goat: tapping pay-asset popped the phone's full-height sheet — change to a desktop dropdown hugging the button).
// List data shared with the phone coin-picker sheet (components/TokenPicker's usePickerLists): my assets → favorites → frequent → search results; top search + main-chain filter.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Search } from 'lucide-react'
import TokenLogo from '@/components/TokenLogo'
import { OfficialTag, usePickerLists, type PickedToken } from '@/components/TokenPicker'
import { isOfficial } from '@/lib/tokenRank'
import { BTC_CHAIN_ID, MAIN_CHAIN_IDS, SOLANA_CHAIN_ID, chainById, type ChainToken } from '@/lib/chains'
import { findHolding, tokenKey } from '@/lib/tokens'
import { fmtAmount, fmtUsd } from '@/lib/format'
import { usePortfolio } from '@/store/portfolio'
import { t } from '@/lib/i18n'
import Popover from './Popover'

export default function AssetPicker({ open, anchor, onClose, onSelect, onlyHoldings, exclude, current }: {
  open: boolean; anchor: RefObject<HTMLElement | null>; onClose: () => void; onSelect: (x: PickedToken) => void
  onlyHoldings: boolean; exclude?: ChainToken; current?: ChainToken | null
}) {
  const holdings = usePortfolio((s) => s.holdings)
  const [q, setQ] = useState('')
  const [chain, setChain] = useState<number | undefined>(undefined)
  const { mine, favs, common, more, searching } = usePickerLists({ open, q, chain, onlyHoldings, exclude })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setQ(''); requestAnimationFrame(() => input.current?.focus()) } }, [open])

  const pick = (x: ChainToken) => { onSelect({ ...x, amount: findHolding(holdings, x)?.amount }); onClose() }
  const groups: [string, ChainToken[], boolean][] = [[t('我的资产'), mine, true], [t('收藏'), favs, false], [t('常用'), common, false], [searching ? t('搜索中…') : t('搜索结果'), more, false]]
  const empty = !mine.length && !favs.length && !common.length && !more.length && !searching

  return (
    <Popover open={open} anchor={anchor} onClose={onClose} width={360} align="end" maxHeight={480} label={t('选择支付资产')}>
      <label className="tx-pop-search">
        <Search size={14} aria-hidden="true" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索符号、名称或合约地址')} aria-label={t('搜索支付资产')} spellCheck={false} />
      </label>
      <div className="tx-pop-chips" role="group" aria-label={t('按链筛选')}>
        <button type="button" aria-pressed={!chain} className={!chain ? 'on' : ''} onClick={() => setChain(undefined)}>{t('全部')}</button>
        {/* Bitcoin after the main chains (2026-09-30 Bitcoin instant swap) */}
        {[...MAIN_CHAIN_IDS, BTC_CHAIN_ID].map((id) => { const c = chainById(id); return c ? <button key={id} type="button" aria-pressed={chain === id} className={chain === id ? 'on' : ''} onClick={() => setChain(id)} title={c.name}><img src={c.logo} alt="" />{c.name.replace(' Smart Chain', '').replace(' Mainnet', '')}</button> : null })}
      </div>
      <div className="tx-pop-list">
        {groups.map(([label, list, showAmt]) => (list.length > 0 || (label === t('搜索中…'))) && (
          <div key={label} role="group" aria-label={label}>
            <div className="tx-pop-group">{label}</div>
            {list.map((x) => {
              const amt = showAmt ? (x as ChainToken & { amount?: number }).amount : undefined
              const on = !!current && tokenKey(current) === tokenKey(x)
              return (
                <button key={tokenKey(x)} type="button" className={`tx-pop-row ${on ? 'on' : ''}`} onClick={() => pick(x)} aria-current={on || undefined}>
                  <TokenLogo src={x.logo} symbol={x.symbol} size={24} chain={x.chainId === SOLANA_CHAIN_ID ? 'solana' : undefined} address={x.address} />
                  <span className="tx-pop-name"><b className="inline-flex items-center gap-1.5">{x.symbol}{isOfficial(x) && <OfficialTag />}</b><small>{chainById(x.chainId)?.name || ''}</small></span>
                  {amt !== undefined && <span className="tx-pop-amt"><b className="tx-num">{fmtAmount(amt)}</b>{x.priceUsd ? <small className="tx-num">{fmtUsd(amt * x.priceUsd)}</small> : null}</span>}
                </button>
              )
            })}
          </div>
        ))}
        {empty && <div className="tx-empty is-tight"><span>{onlyHoldings ? t('没有可用于支付的资产') : t('没有找到代币')}</span></div>}
      </div>
    </Popover>
  )
}
