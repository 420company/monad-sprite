// Solana token icons follow no uniform pattern (Jupiter serves a mix of arweave / github / ipfs); when all static candidates fail, look up by mint on Jupiter once and cache the result
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
