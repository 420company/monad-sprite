// Solana 代币图标没有统一规律（Jupiter 给的是 arweave / github / ipfs 混着来），静态候选全失败时按 mint 去 Jupiter 查一次，结果缓存
const cache = new Map<string, Promise<string | null>>()
export function resolveSolanaLogo(mint: string): Promise<string | null> {
  let p = cache.get(mint)
  if (!p) {
    p = fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`).then((r) => r.ok ? r.json() : [])
      .then((list: { id: string; icon?: string }[]) => list.find((t) => t.id === mint)?.icon || null).catch(() => null)
    cache.set(mint, p)
  }
  return p
}
