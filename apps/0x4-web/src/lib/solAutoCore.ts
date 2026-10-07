// Sprite spot full-auto · Solana edition: the ox4_auto program's address and instruction builders (2026-10-04; design in docs/SOLANA_AUTO_TRADE.md).
// Shared by web / app (enable, disable, withdraw-from-vault) and the server (buy, sell) — don't write two copies. Depends only on @solana/web3.js, no Anchor client.
// Instruction discriminators are hardcoded here; matching the program is guaranteed by the Rust test discriminators_match_ts_core in contracts/solana-auto.
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js'

/** ★Program address: currently the dev one; when going mainnet, generate the production address and change it here, in the program's declare_id, and on the server together */
export const SOL_AUTO_PROGRAM = new PublicKey('FUZp2mtL582G5ESPVCCEqMV9k28ZZuzhVL6eRwTA8oPQ')
export const SOL_USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
export const JUPITER_V6 = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
/** USDC has 6 decimals; daily allowance cap 100k, max 90-day authorization (consistent with the program and the BNB Chain edition) */
export const SOL_USDC_DECIMALS = 6
export const SOL_MAX_PER_DAY_USDC = 100_000
export const SOL_MAX_DAYS = 90

/**
 * Full-auto only uses these pools when routing via Jupiter (the dexes quote param). Market makers' proprietary pools (HumidiFi, SolFi, Tessera, Kipseli, etc.) only accept direct signatures from human wallets —
 * program co-signing errors with "real_user did not sign" (2026-10-04 fork-integration test hit Kipseli), so only standard public pools are included: covering SOL/USDC majors plus meme-coin launchpads and migrated pools
 */
export const SOL_AUTO_DEXES = [
  'Raydium', 'Raydium CLMM', 'Raydium CP', 'Raydium Launchlab', 'Whirlpool', 'Orca V2', 'Meteora', 'Meteora DLMM', 'Meteora DAMM v2',
  'Dynamic Bonding Curve', 'Pump.fun', 'Pump.fun Amm', 'Phoenix',
] as const

const DISC = {
  initConfig: [23, 235, 115, 232, 168, 96, 1, 231],
  setOperator: [238, 153, 101, 169, 243, 131, 36, 1],
  setPaused: [91, 60, 125, 192, 176, 225, 166, 218],
  enable: [159, 34, 127, 41, 193, 53, 124, 27],
  stop: [42, 133, 32, 60, 171, 253, 184, 155],
  buy: [102, 6, 61, 18, 1, 218, 235, 234],
  sell: [51, 230, 133, 164, 1, 127, 131, 173],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
  rescueStage: [75, 215, 62, 23, 153, 10, 59, 128],
} as const
/** Program event discriminators (the server reads fill results from tx logs with them) */
export const SOL_AUTO_EVENTS = { bought: [193, 56, 215, 24, 156, 76, 42, 104], sold: [205, 203, 210, 202, 96, 11, 192, 10] } as const

const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, SOL_AUTO_PROGRAM)[0]
export const solAutoConfig = () => pda([Buffer.from('config')])
export const solAutoUser = (user: PublicKey) => pda([Buffer.from('user'), user.toBuffer()])
export const solAutoPull = (user: PublicKey) => pda([Buffer.from('pull'), user.toBuffer()])
export const solAutoStage = (user: PublicKey) => pda([Buffer.from('stage'), user.toBuffer()])
/** The vault's signer (one per user per coin) */
export const solAutoVaultAuth = (user: PublicKey, mint: PublicKey) => pda([Buffer.from('vault'), user.toBuffer(), mint.toBuffer()])
export function ata(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0]
}
/** This user's vault for this coin (the token account address) */
export const solAutoVault = (user: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM) => ata(solAutoVaultAuth(user, mint), mint, tokenProgram)

// ---------- Argument encoding (borsh) ----------
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b }
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b }
const bool = (v: boolean) => Buffer.from([v ? 1 : 0])
const bytes = (v: Uint8Array) => { const n = Buffer.alloc(4); n.writeUInt32LE(v.length); return Buffer.concat([n, Buffer.from(v)]) }
const data = (d: readonly number[], ...args: Buffer[]) => Buffer.concat([Buffer.from(d), ...args])
const m = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable })

// ---------- Signed by the user ----------

/**
 * 0x4 account tag: sha256(account address). Written into the on-chain UserAuto, proving which account's sprite this Solana wallet authorizes (only the wallet owner can sign the enable),
 * the server trusts only this on-chain record, not addresses reported by the client
 */
export async function solAutoAccountTag(account: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account)))
}

/** Enable / modify: perDay is in USDC base units, until is unix seconds, accountTag computed via solAutoAccountTag. In the same tx the program approves the user's USDC to pull (amount = daily allowance × days) */
export function solAutoEnableIx(user: PublicKey, perDay: bigint, until: bigint, accountTag: Uint8Array): TransactionInstruction {
  if (accountTag.length !== 32) throw new Error('账号标记不对')
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [
      m(user, true, true), m(solAutoUser(user), true), m(solAutoPull(user)), m(SOL_USDC), m(ata(user, SOL_USDC), true),
      m(TOKEN_PROGRAM), m(ATA_PROGRAM), m(SystemProgram.programId),
    ],
    data: data(DISC.enable, u64(perDay), i64(until), Buffer.from(accountTag)),
  })
}

/** Disable: stop trading, revoke our USDC approval */
export function solAutoStopIx(user: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [m(user, false, true), m(solAutoUser(user), true), m(solAutoPull(user)), m(SOL_USDC), m(ata(user, SOL_USDC), true), m(TOKEN_PROGRAM)],
    data: data(DISC.stop),
  })
}

/** Withdraw the vault's tokens back to your own account dest (must be your own account for this token). amount null = all; close = close the emptied vault after withdrawing, deposit refunded */
export function solAutoWithdrawIx(user: PublicKey, mint: PublicKey, tokenProgram: PublicKey, dest: PublicKey, amount: bigint | null, close: boolean): TransactionInstruction {
  const auth = solAutoVaultAuth(user, mint)
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [m(user, true, true), m(auth), m(mint), m(ata(auth, mint, tokenProgram), true), m(dest, true), m(tokenProgram)],
    data: data(DISC.withdraw, u64(amount ?? 0xffffffffffffffffn), bool(close)),
  })
}

/** Recover USDC stuck in the transit account back to your own wallet (normally 0 — an escape hatch) */
export function solAutoRescueStageIx(user: PublicKey): TransactionInstruction {
  const stage = solAutoStage(user)
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [m(user, false, true), m(stage), m(SOL_USDC), m(ata(stage, SOL_USDC), true), m(ata(user, SOL_USDC), true), m(TOKEN_PROGRAM)],
    data: data(DISC.rescueStage),
  })
}

// ---------- Signed by the server (operator) ----------

/** The swapInstruction returned by Jupiter /swap-instructions (accounts are { pubkey, isSigner, isWritable }, data is base64) */
export interface JupSwapIx { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }

/**
 * Routing accounts are passed through as-is, but uniformly marked non-signer at the outer layer: the transit / vault are program PDAs that the outer layer can't sign for — the program signs them itself when calling Jupiter;
 * other accounts are never signed for by the program even if Jupiter marks them as signers (the program only signs for that one PDA)
 */
function routeMetas(ix: JupSwapIx): { metas: AccountMeta[]; data: Buffer } {
  if (ix.programId !== JUPITER_V6.toBase58()) throw new Error('兑换路由不是 Jupiter')
  return { metas: ix.accounts.map((a) => m(new PublicKey(a.pubkey), a.isWritable, false)), data: Buffer.from(ix.data, 'base64') }
}

export function solAutoBuyIx(p: { operator: PublicKey; user: PublicKey; mint: PublicKey; mintTokenProgram: PublicKey; amountIn: bigint; minOut: bigint; swap: JupSwapIx }): TransactionInstruction {
  const stage = solAutoStage(p.user)
  const vaultAuth = solAutoVaultAuth(p.user, p.mint)
  const r = routeMetas(p.swap)
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [
      m(p.operator, true, true), m(solAutoConfig()), m(p.user), m(solAutoUser(p.user), true), m(solAutoPull(p.user)), m(stage), m(vaultAuth),
      m(SOL_USDC), m(p.mint), m(ata(p.user, SOL_USDC), true), m(ata(stage, SOL_USDC), true), m(ata(vaultAuth, p.mint, p.mintTokenProgram), true),
      m(TOKEN_PROGRAM), m(p.mintTokenProgram), m(ATA_PROGRAM), m(SystemProgram.programId), m(JUPITER_V6),
      ...r.metas,
    ],
    data: data(DISC.buy, u64(p.amountIn), u64(p.minOut), bytes(r.data)),
  })
}

export function solAutoSellIx(p: { operator: PublicKey; user: PublicKey; mint: PublicKey; mintTokenProgram: PublicKey; amountIn: bigint; minOut: bigint; swap: JupSwapIx }): TransactionInstruction {
  const vaultAuth = solAutoVaultAuth(p.user, p.mint)
  const r = routeMetas(p.swap)
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [
      m(p.operator, false, true), m(solAutoConfig()), m(p.user), m(solAutoUser(p.user)), m(vaultAuth), m(p.mint),
      m(ata(vaultAuth, p.mint, p.mintTokenProgram), true), m(SOL_USDC), m(ata(p.user, SOL_USDC), true),
      m(p.mintTokenProgram), m(TOKEN_PROGRAM), m(JUPITER_V6),
      ...r.metas,
    ],
    data: data(DISC.sell, u64(p.amountIn), u64(p.minOut), bytes(r.data)),
  })
}

export function solAutoInitConfigIx(payer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: SOL_AUTO_PROGRAM, keys: [m(payer, true, true), m(solAutoConfig(), true), m(SystemProgram.programId)], data: data(DISC.initConfig) })
}

// ---------- State reads ----------

export interface SolAutoUserState { perDay: bigint; until: bigint; dayStart: bigint; spent: bigint; active: boolean; /** 0x4 account tag (hex) */ accountTag: string }
/** Decode the UserAuto account (8-byte discriminator + user 32 + per_day 8 + until 8 + day_start 8 + spent 8 + active 1 + bump 1 + account 32) */
export function decodeSolAutoUser(raw: Uint8Array): SolAutoUserState | null {
  const b = Buffer.from(raw)
  if (b.length < 106 || !b.subarray(0, 8).equals(Buffer.from([91, 116, 68, 126, 31, 175, 44, 79]))) return null
  return { perDay: b.readBigUInt64LE(40), until: b.readBigInt64LE(48), dayStart: b.readBigInt64LE(56), spent: b.readBigUInt64LE(64), active: b[72] === 1, accountTag: b.subarray(74, 106).toString('hex') }
}
