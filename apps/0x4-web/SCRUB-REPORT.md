# Scrub Report (SCRUB-REPORT.md)

`apps/0x4-web/` is a competition-branch snapshot of the private 0x4-web repo (pulled 2026-10-07, no git history).
A full de-identification review was completed before publishing.

## Method

- Repo-wide grep: `sk-` / API-key shapes, `[0-9]{8,10}:[A-Za-z0-9_-]{35}` (Telegram token shape),
  64-char hex (private-key shape), mnemonics (BIP39 wordlist spot-check), `bot_token` / `mnemonic` / `private_key`,
  internal IPs / localhost ports, `.env*` files
- Every hit manually verified: hardcoded real value vs. variable reference / placeholder

## Findings

| # | Location | Content | Verdict | Action |
|---|---|---|---|---|
| 1 | `src/lib/autoTradeCore.ts:30` | `ROOT_AUTHORITY = '0xffff…ffff'` | Sentinel placeholder, not a real key | Kept (no risk) |
| 2 | `src/lib/env.ts` | `WALLETCONNECT_ID = '902842f4…'` | WalletConnect project ID; code comment states "public value, not a secret" | Kept |
| 3 | `src/lib/env.ts` | `bngAddress = '0x6652b2…'` | On-chain BSC contract address (public) | Kept |
| 4 | Repo-wide | All `VITE_*` config | Only `import.meta.env.VITE_*` references — **no hardcoded real values** | Added `.env.example` (all placeholders) |
| 5 | Repo-wide | `.env` / `.env.local` etc. | Excluded at pull time, never entered the repo | — |
| 6 | `src/effects/models/face_landmarker.task` | MediaPipe face-model binary | MCP can't transfer binaries; unrelated to competition | Not included |

## Conclusion

- **Zero hardcoded API keys, private keys, mnemonics, Telegram/Binance secrets**
- **Zero internal addresses, zero real user data**
- All secret config goes through `VITE_*` env vars; `.env.example` is placeholders only
- The deployer key (`~/.monad-deployer-key`) never entered any directory of this repo
