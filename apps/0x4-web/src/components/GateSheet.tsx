// Group entry-gate editor: joining requires holding a specified token (amount) or NFT (contract / collection)
// The same editor is used at group creation and inside the group (admins); new members are restricted immediately after saving; existing members can be removed via "re-verify member holdings"
import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, ChevronDown, Image as ImageIcon } from 'lucide-react'
import Button from './Button'
import Sheet from './Sheet'
import TokenPicker, { type PickedToken } from './TokenPicker'
import { Input, Label } from './Field'
import { toast } from './Toast'
import { api, type GroupGate } from '@/lib/social'
import { NFT_CHAIN_IDS, SOLANA_CHAIN_ID, chainName, isNative, type ChainToken } from '@/lib/chains'
import { createCollectionLookup, fetchCollection, type LookupState, type NftCollectionInfo } from '@/lib/nftCollection'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'

/**
 * The NFT gate's chain and collection name are identified server-side (GET /api/nft/collection); the user only pastes the address.
 * nftOk = the current address + chain is already identified (or was stored when editing an existing gate); submission is blocked until identified.
 * nftImage is only for the small card display, never submitted.
 */
export interface GateDraft { kind: 'token' | 'nft'; token: ChainToken | null; nftChainId: number; contract: string; name: string; min: string; nftOk: boolean; nftImage?: string }
export const emptyDraft = (token: ChainToken | null = null): GateDraft => ({ kind: 'token', token, nftChainId: SOLANA_CHAIN_ID, contract: '', name: '', min: '', nftOk: false })

/** Convert editor state into the gate the API needs; returns null when incomplete (including unidentified NFT) */
export function draftToGate(d: GateDraft): GroupGate | null {
  if (d.kind === 'token') return d.token ? { kind: 'token', chainId: d.token.chainId, token: isNative(d.token.address) ? 'native' : d.token.address, symbol: d.token.symbol, min: Number(d.min) || 0 } : null
  const c = d.contract.trim()
  if (!c || !d.nftOk) return null
  return { kind: 'nft', chainId: d.nftChainId, token: c, symbol: d.name.trim() || 'NFT', min: Math.max(1, Number(d.min) || 1) }
}

export function gateToDraft(g: GroupGate | null): GateDraft {
  if (!g) return emptyDraft()
  // Existing gates show the stored chain and name directly, no forced re-identification; re-identify only when the address changes
  if (g.kind === 'nft') return { kind: 'nft', token: null, nftChainId: g.chainId, contract: g.token, name: g.symbol || '', min: String(g.min || 1), nftOk: true }
  return { kind: 'token', token: { chainId: g.chainId, address: g.token, symbol: g.symbol || '', name: g.symbol || '', decimals: 0 }, nftChainId: SOLANA_CHAIN_ID, contract: '', name: '', min: String(g.min || ''), nftOk: false }
}

const EVM_NFT_CHAINS = NFT_CHAIN_IDS.filter((id) => id !== SOLANA_CHAIN_ID)

/** The identified collection: thumbnail + name + chain, read-only */
function CollectionCard({ name, image, chainId, verified }: { name: string; image?: string; chainId: number; verified?: boolean }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card2 px-3 py-2.5">
      {image && !broken
        ? <img src={image} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" onError={() => setBroken(true)} />
        : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-muted"><ImageIcon size={18} /></div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm font-semibold"><span className="truncate">{name}</span>{verified && <BadgeCheck size={14} className="shrink-0 text-accent" aria-label={t('已认证')} />}</div>
        <div className="text-xs text-muted">{chainName(chainId)}</div>
      </div>
    </div>
  )
}

function NftGateFields({ value, set }: { value: GateDraft; set: (p: Partial<GateDraft>) => void }) {
  const [state, setState] = useState<LookupState>({ status: 'idle' })
  const [candidates, setCandidates] = useState<NftCollectionInfo[]>([])
  // The user manually switched chains: keep the dropdown even when nothing is identified, so they can switch back
  const [pinned, setPinned] = useState(false)
  // Identification results come back async — merge them into the latest draft at that moment, not the stale values from when the request was sent
  const setRef = useRef(set)
  setRef.current = set
  const lookupRef = useRef<ReturnType<typeof createCollectionLookup> | null>(null)
  if (!lookupRef.current) {
    lookupRef.current = createCollectionLookup(fetchCollection, (s) => {
      setState(s)
      if (s.status === 'found') {
        const r = s.result
        if (r.candidates && r.candidates.length > 1) setCandidates(r.candidates)
        // The server verifies gates with ERC-721's balanceOf(owner); ERC-1155 holdings can't be checked, so a gate built on it would let nobody in
        setRef.current({ nftChainId: r.chainId, name: r.name, nftImage: r.image, nftOk: r.standard !== 'erc1155' })
      } else setRef.current({ nftOk: false, nftImage: undefined })
    })
  }
  useEffect(() => () => lookupRef.current?.cancel(), [])

  const onContract = (c: string) => {
    setCandidates([])
    setPinned(false)
    set({ contract: c, nftOk: false, nftImage: undefined, name: '' })
    lookupRef.current!.request(c)
  }
  const onChain = (id: number) => {
    setPinned(true)
    set({ nftChainId: id, nftOk: false })
    lookupRef.current!.request(value.contract, id)
  }

  const isEvm = value.contract.trim().startsWith('0x')
  const is1155 = state.status === 'found' && state.result.standard === 'erc1155'
  const showCard = (value.nftOk || is1155) && value.contract.trim()
  const chainOptions = candidates.length > 1 ? candidates.map((c) => c.chainId) : EVM_NFT_CHAINS
  return (
    <>
      <div><Label>{t('NFT 合约地址（EVM）或集合地址（Solana）')}</Label><Input value={value.contract} onChange={(e) => onContract(e.target.value)} placeholder={t('0x… 或 Solana collection 地址')} spellCheck={false} autoCapitalize="off" autoCorrect="off" /></div>
      <div aria-live="polite">
        {state.status === 'loading' && <p className="text-xs text-muted">{t('正在识别…')}</p>}
        {state.status === 'missing' && <p className="text-xs text-down">{t('没识别到这个 NFT 系列，请检查地址')}</p>}
        {state.status === 'error' && <p className="text-xs text-down">{t(state.message)}</p>}
        {showCard && state.status !== 'loading' && <CollectionCard name={value.name || 'NFT'} image={value.nftImage} chainId={value.nftChainId} verified={state.status === 'found' && state.result.verified} />}
        {is1155 && <p className="mt-1 text-xs text-down">{t('这是 ERC-1155 系列，进群门槛目前只支持 ERC-721')}</p>}
      </div>
      {/* The chain selector appears only after auto-identification; Solana has a single chain, no selection needed */}
      {isEvm && (showCard || (pinned && state.status === 'missing')) && (
        <div>
          <Label htmlFor="gate-nft-chain">{t('所在链')}</Label>
          <div className="relative">
            <select id="gate-nft-chain" value={value.nftChainId} onChange={(e) => onChain(Number(e.target.value))} className="ui-field min-h-12 w-full appearance-none pr-9">
              {!chainOptions.includes(value.nftChainId) && <option value={value.nftChainId}>{chainName(value.nftChainId)}</option>}
              {chainOptions.map((id) => <option key={id} value={id}>{chainName(id)}</option>)}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          </div>
          {candidates.length > 1 && <p className="mt-1 text-xs text-muted">{t('这个地址在 {n} 条链上都有，默认选了 {chain}', { n: candidates.length, chain: chainName(candidates[0].chainId) })}</p>}
        </div>
      )}
    </>
  )
}

export function GateEditor({ value, onChange }: { value: GateDraft; onChange: (d: GateDraft) => void }) {
  const [picking, setPicking] = useState(false)
  // Merge with the latest value: NFT identification results come back async
  const valueRef = useRef(value)
  valueRef.current = value
  const set = (p: Partial<GateDraft>) => { const next = { ...valueRef.current, ...p }; valueRef.current = next; onChange(next) }
  return (
    <div className="space-y-3">
      <div className="flex rounded-2xl bg-card p-1">
        {(['token', 'nft'] as const).map((k) => <button key={k} onClick={() => set({ kind: k, min: '' })} className={`flex-1 rounded-xl py-2 text-sm font-semibold ${value.kind === k ? 'bg-card2 text-fg' : 'text-muted'}`}>{k === 'token' ? t('持有代币') : t('持有 NFT')}</button>)}
      </div>
      {value.kind === 'token' ? (
        <>
          <button onClick={() => setPicking(true)} className="w-full rounded-2xl bg-card2 px-4 py-3 text-left text-sm">{value.token ? `${value.token.symbol} · ${chainName(value.token.chainId)}` : <span className="text-muted">{t('选择代币')}</span>}</button>
          <div><Label>{t('最低持仓数量')}</Label><Input type="number" inputMode="decimal" value={value.min} onChange={(e) => set({ min: e.target.value })} placeholder={t('例如 1000000')} /></div>
          <TokenPicker open={picking} onClose={() => setPicking(false)} title={t('选择门槛代币')} onSelect={(t: PickedToken) => set({ token: t })} />
        </>
      ) : (
        <>
          <NftGateFields value={value} set={set} />
          <div><Label>{t('最少持有几个')}</Label><Input type="number" inputMode="numeric" value={value.min} onChange={(e) => set({ min: e.target.value })} placeholder="1" /></div>
        </>
      )}
    </div>
  )
}

/** Sheet for group admins to set gates inside the group */
export default function GateSheet({ open, onClose, groupId, gate, onSaved }: { open: boolean; onClose: () => void; groupId: string; gate: GroupGate | null; onSaved: () => void }) {
  const [draft, setDraft] = useState<GateDraft>(gateToDraft(gate))
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setDraft(gateToDraft(gate)) }, [open, gate])
  const save = async (clear = false) => {
    const g = clear ? null : draftToGate(draft)
    if (!clear && !g) return toast.error(t('请先填写门槛'))
    setBusy(true)
    try { await api(`/api/groups/${groupId}/gate`, { method: 'PUT', body: JSON.stringify({ gate: g }) }); toast.success(clear ? t('已取消门槛') : t('门槛已生效')); onSaved(); onClose() } catch (e) { toast.error(errorText(e, t('保存失败'))) } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('进群门槛')}>
      <p className="mb-3 text-xs text-muted">{t('只有持有指定代币或 NFT 的人才能加入，已在群里的成员不受影响。')}</p>
      <GateEditor value={draft} onChange={setDraft} />
      <Button size="lg" className="mt-4 w-full" loading={busy} onClick={() => save(false)}>{t('保存门槛')}</Button>
      {gate && <Button size="md" variant="ghost" className="mt-2 w-full text-down" disabled={busy} onClick={() => save(true)}>{t('取消门槛')}</Button>}
    </Sheet>
  )
}
