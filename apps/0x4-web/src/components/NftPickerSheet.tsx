// Use an NFT as avatar: lists my NFTs (Solana via DAS, EVM via Alchemy; manual entry when unavailable); after verifying ownership it becomes the avatar, marked with its chain
import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import Button from './Button'
import { toast } from './Toast'
import { api, type AvatarNft } from '@/lib/social'
import { listLinkedWallets, unlinkWallet, type LinkedWallet } from '@/lib/linkedWallets'
import { shortAddr } from '@/lib/format'
import { Check, Plus, Trash2, Wallet } from 'lucide-react'
import WalletLinkSheet from './WalletLinkSheet'
import { CHAINS, chainName } from '@/lib/chains'
import { t } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { WEB_SURFACE } from '@/lib/surface'

interface Owned { chainId: number; contract: string; tokenId: string | null; image: string; thumb?: string; name: string; owner?: string }
/** Items per page: three columns × two rows, paginate beyond that (2026-09-27 goat) */
const PAGE_SIZE = 6
interface NftsResponse { list: Owned[]; indexedChains: number[] }

export default function NftPickerSheet({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked: (nft: AvatarNft, image: string) => void }) {
  const [list, setList] = useState<Owned[] | null>(null)
  /** The server can genuinely list NFT chains automatically now. The UI only shows these — no manual contract-address entry */
  const [chains, setChains] = useState<number[]>([])
  /** The network being viewed; null = all */
  const [chainId, setChainId] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  // Select first, then tap "Confirm" to submit (2026-09-27 goat: it used to submit on a single tap, graying the whole sheet during verification with no visible progress)
  const [sel, setSel] = useState<Owned | null>(null)

  const load = () => {
    setList(null)
    return api<NftsResponse>('/api/me/nfts')
      .then((r) => { setList(r.list); setChains(r.indexedChains || []) })
      .catch(() => { setList([]); setChains([]) })
  }
  useEffect(() => { if (open) { setChainId(null); setPage(0); setSel(null); void load() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // Switching networks returns to page one, otherwise it could land on a nonexistent page
  useEffect(() => { setPage(0) }, [chainId])

  const use = async (n: Owned) => {
    setBusy(true)
    try {
      const r = await api<{ avatar: string; avatarNft: AvatarNft }>('/api/me/avatar-nft', {
        method: 'PUT',
        body: JSON.stringify({ chainId: n.chainId, contract: n.contract, tokenId: n.tokenId }),
      })
      toast.success(t('头像已换成这个 NFT')); onPicked(r.avatarNft, r.avatar); onClose()
    } catch (e) { toast.error(errorText(e, t('验证失败'))) } finally { setBusy(false) }
  }

  const counts = new Map<number, number>()
  for (const n of list || []) counts.set(n.chainId, (counts.get(n.chainId) || 0) + 1)
  // Chains with items sort first, visible at a glance
  const tabs = [...chains].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))
  const filtered = (list || []).filter((n) => chainId === null || n.chainId === chainId)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const [showAllChains, setShowAllChains] = useState(false)
  const current = Math.min(page, pages - 1)
  const shown = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  return (
    <Sheet open={open} onClose={onClose} title={t('验证 NFT')}>
      <p className="text-xs text-muted">{t('选择持有 NFT 的钱包。资产在其他钱包的，点「关联其他钱包」。')}</p>

      {tabs.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label={t('网络')}>
          <button role="tab" aria-selected={chainId === null} onClick={() => setChainId(null)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${chainId === null ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>
            {t('全部')}{list?.length ? ` ${list.length}` : ''}
          </button>
          {/* No horizontal scrollbar (2026-09-25 goat: the drag bar is ugly): show only the first 3 chains by default, the rest fold into "more" — tapping unwraps and shows all */}
          {(showAllChains ? tabs : tabs.filter((id, i) => i < 3 || id === chainId)).map((id) => {
            const c = CHAINS.find((x) => x.id === id)
            if (!c) return null
            const n = counts.get(id) || 0
            return (
              <button key={id} role="tab" aria-selected={chainId === id} onClick={() => setChainId(id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${chainId === id ? 'bg-accent text-bg' : 'bg-card2 text-muted'}`}>
                {c.logo && <img src={c.logo} alt="" className="h-4 w-4 rounded-full" />}
                {c.name}{n ? ` ${n}` : ''}
              </button>
            )
          })}
          {tabs.length > 3 && (
            <button onClick={() => setShowAllChains((v) => !v)} className="shrink-0 rounded-full bg-card2 px-3 py-1.5 text-sm font-semibold text-muted">
              {showAllChains ? t('收起') : t('更多 {n}', { n: tabs.length - 3 })}
            </button>
          )}
        </div>
      )}

      {list === null && (
        <div className="mt-4 grid grid-cols-3 gap-2" role="status" aria-label={t('正在找你的 NFT')}>
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton aspect-square rounded-2xl" />)}
        </div>
      )}

      {list && shown.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {shown.map((n) => (
            <button key={`${n.chainId}:${n.contract}:${n.tokenId}`} disabled={busy} onClick={() => setSel(n)} aria-pressed={sel === n}
              className={`relative overflow-hidden rounded-2xl bg-card2 text-left ${sel === n ? 'ring-2 ring-accent' : ''}`}>
              {sel === n && <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-accent text-bg"><Check size={14} aria-hidden="true" /></span>}
              <img src={n.thumb || n.image} alt="" loading="lazy" decoding="async" className="aspect-square w-full bg-card object-cover" />
              <div className="truncate px-2 py-1 text-[11px]">{n.name || (n.tokenId ? `#${n.tokenId}` : n.contract.slice(0, 8))}</div>
              <div className="truncate px-2 pb-1 text-[10px] text-muted">{chainName(n.chainId)}</div>
            </button>
          ))}
        </div>
      )}

      {sel && (
        <Button className="mt-4 w-full" loading={busy} onClick={() => use(sel)}>{t('设为头像')}</Button>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={current === 0}
            className="min-h-11 rounded-xl border border-line bg-card2 px-4 text-sm font-semibold disabled:opacity-40">{t('上一页')}</button>
          <span className="text-sm text-muted">{current + 1} / {pages}　{t('共 {n} 个', { n: filtered.length })}</span>
          <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={current >= pages - 1}
            className="min-h-11 rounded-xl border border-line bg-card2 px-4 text-sm font-semibold disabled:opacity-40">{t('下一页')}</button>
        </div>
      )}

      {list && shown.length === 0 && (
        <div className="mt-4 rounded-2xl bg-card2 px-4 py-7 text-center" role="status">
          <p className="text-sm text-muted">{chainId === null ? t('当前钱包里还没有 NFT，请检查您的钱包') : t('{chain} 上没有 NFT', { chain: chainName(chainId) })}</p>
        </div>
      )}

      <LinkedWallets open={open} onChanged={() => { void load() }} />
    </Sheet>
  )
}

/**
 * Link another wallet: for NFTs sitting in a cold wallet or another everyday wallet.
 * That wallet is only used to sign a proof message; we never touch its private keys and never send transactions from it.
 */
function LinkedWallets({ open, onChanged }: { open: boolean; onChanged: () => void }) {
  const [wallets, setWallets] = useState<LinkedWallet[] | null>(null)
  const [max, setMax] = useState(5)
  const [busy] = useState(false)

  const reload = () => listLinkedWallets().then((r) => { setWallets(r.list); setMax(r.max) }).catch(() => setWallets([]))
  useEffect(() => { if (open) reload() }, [open])

  const [linking, setLinking] = useState(false)

  const remove = async (w: LinkedWallet) => {
    if (!confirm(t('解除关联 {addr}？用它的 NFT 做的头像会在下次登录时恢复默认。', { addr: shortAddr(w.address, 6) }))) return
    try { await unlinkWallet(w.address); toast.success(t('已解除')); await reload(); onChanged() }
    catch (e) { toast.error(errorText(e, t('解除失败'))) }
  }

  return (
    <div className="mt-6 border-t border-line pt-4">

      {wallets && wallets.length > 0 && (
        <div className="mt-3 divide-y divide-line/60">
          {wallets.map((w) => (
            <div key={w.address} className="flex items-center gap-3 py-2.5">
              <Wallet size={16} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{shortAddr(w.address, 6)}</span>
              <span className="shrink-0 text-xs text-muted">{w.chain_type === 'solana' ? 'Solana' : 'EVM'}</span>
              <button onClick={() => remove(w)} className="icon-button -mr-2 shrink-0" aria-label={t('解除关联 {addr}', { addr: w.address })}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Linking other wallets goes through third-party wallet QR connections: the web version only connects the 0x4 browser extension (2026-09-29 goat), so it's not offered here; already-linked wallets still show and can be unlinked */}
      {!WEB_SURFACE && <>
      <Button
        size="md"
        variant="secondary"
        className="mt-3 w-full"
        loading={busy}
        disabled={!!wallets && wallets.length >= max}
        onClick={() => setLinking(true)}
      ><Plus size={16} />{wallets && wallets.length >= max ? t('最多关联 {n} 个', { n: max }) : t('关联其他钱包')}</Button>

      <WalletLinkSheet open={linking} onClose={() => setLinking(false)} onLinked={() => { void reload(); onChanged() }} />
      </>}
    </div>
  )
}
