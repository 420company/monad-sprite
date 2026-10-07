// 进群门槛编辑：持有指定代币（数量）或指定 NFT（合约 / 集合）才能进群
// 建群时和群内（管理员）都用同一个编辑器；保存后新成员立即受限，老成员可用「复核成员持仓」清退
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
 * NFT 门槛的链和系列名由服务端识别（GET /api/nft/collection），玩家只贴地址。
 * nftOk = 当前地址 + 链已经识别过（或是编辑已有门槛时存下来的），没识别到不能提交。
 * nftImage 只用来显示小卡片，不提交。
 */
export interface GateDraft { kind: 'token' | 'nft'; token: ChainToken | null; nftChainId: number; contract: string; name: string; min: string; nftOk: boolean; nftImage?: string }
export const emptyDraft = (token: ChainToken | null = null): GateDraft => ({ kind: 'token', token, nftChainId: SOLANA_CHAIN_ID, contract: '', name: '', min: '', nftOk: false })

/** 把编辑器状态转成接口需要的门槛；填写不完整（含 NFT 还没识别到）返回 null */
export function draftToGate(d: GateDraft): GroupGate | null {
  if (d.kind === 'token') return d.token ? { kind: 'token', chainId: d.token.chainId, token: isNative(d.token.address) ? 'native' : d.token.address, symbol: d.token.symbol, min: Number(d.min) || 0 } : null
  const c = d.contract.trim()
  if (!c || !d.nftOk) return null
  return { kind: 'nft', chainId: d.nftChainId, token: c, symbol: d.name.trim() || 'NFT', min: Math.max(1, Number(d.min) || 1) }
}

export function gateToDraft(g: GroupGate | null): GateDraft {
  if (!g) return emptyDraft()
  // 已有门槛直接显示存下的链和名字，不强制重新识别；地址改了才重新识别
  if (g.kind === 'nft') return { kind: 'nft', token: null, nftChainId: g.chainId, contract: g.token, name: g.symbol || '', min: String(g.min || 1), nftOk: true }
  return { kind: 'token', token: { chainId: g.chainId, address: g.token, symbol: g.symbol || '', name: g.symbol || '', decimals: 0 }, nftChainId: SOLANA_CHAIN_ID, contract: '', name: '', min: String(g.min || ''), nftOk: false }
}

const EVM_NFT_CHAINS = NFT_CHAIN_IDS.filter((id) => id !== SOLANA_CHAIN_ID)

/** 识别出来的系列：小图 + 名字 + 链，只读 */
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
  // 用户手动换过链：这时没识别到也要留着下拉，好换回去
  const [pinned, setPinned] = useState(false)
  // 识别结果是异步回来的，要合并到那一刻的最新草稿上，不能用发请求时的旧值
  const setRef = useRef(set)
  setRef.current = set
  const lookupRef = useRef<ReturnType<typeof createCollectionLookup> | null>(null)
  if (!lookupRef.current) {
    lookupRef.current = createCollectionLookup(fetchCollection, (s) => {
      setState(s)
      if (s.status === 'found') {
        const r = s.result
        if (r.candidates && r.candidates.length > 1) setCandidates(r.candidates)
        // 服务端门槛按 ERC-721 的 balanceOf(owner) 校验，ERC-1155 查不出持仓，建了也没人进得来
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
      {/* 自动识别后才出链选择；Solana 只有一条链，不用选 */}
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
  // 用最新的 value 合并：NFT 识别结果是异步回来的
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

/** 群内管理员设置门槛的弹层 */
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
