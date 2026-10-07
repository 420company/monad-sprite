# @monad-sprite/agent-gate

Zalien Universe NFT holder gate — **each Zalien NFT = license key for one personal AI agent**.

## Contract (verified, BSC mainnet)

| Item | Value |
|---|---|
| Collection | Zalien Universe (ZALIEN) |
| Chain | BNB Smart Chain (56) |
| Contract | `0x40223d0fcF191F573c5B3f6c286D09B363aAdF2D` |
| Source | zalien.io `/zalien-bsc.js` mainnet config (on-chain `name()`/`symbol()` verified) |
| Testnet counterpart | `0x812dC300b17F1Dc1E520F0649848e1e92E3b56e2` (BSC testnet, dev only) |

## Frontend integration ("connect wallet → check Zalien → unlock agent")

```ts
import { checkZalienHolder } from "@monad-sprite/agent-gate/zalienGate.ts";

// 1. User connects wallet (wagmi / RainbowKit / custom connector → address)
// 2. Check holdings
const { holder, count } = await checkZalienHolder(address);
// 3. Branch
if (holder) {
  // Unlock agent UI: show "Zalien Holder · {count} agents available"
} else {
  // Show mint CTA: https://zalien.io (0.1 BNB each)
}
```

Notes:
- **Read-only calls** — no signatures, no transactions, no gas for the user, no need to switch to BSC (direct RPC reads).
- Fail-closed on `holder=false`: if the RPC is down, treat as non-holder — never let anyone through by mistake.
- Address case doesn't matter; the module normalizes to checksum internally; invalid addresses throw — catch in the frontend and prompt "connect wallet".
- Re-check on wallet connect / account switch; holdings rarely change, so no polling needed (60s refresh is plenty for demo).

## Cross-chain narrative (demo script)

> Identity verified on BSC (Zalien NFT) → trades executed on Monad testnet (monad-executor).
> Wallet is identity, NFT is license, one VPS per agent.

## Tests

`npm test` — 10 cases, all against BSC mainnet public RPC (incl. known holder `0x4695…D000` with count=10).
