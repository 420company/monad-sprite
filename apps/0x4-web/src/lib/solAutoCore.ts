// 小精灵现货全自动 · Solana 版：程序 ox4_auto 的地址和指令拼装（2026-10-04，设计见 docs/SOLANA_AUTO_TRADE.md）。
// 网页 / App（开启、关闭、提回保险箱）和服务器（买入、卖出）共用这一份，别各写一套。只依赖 @solana/web3.js，不用 Anchor 客户端。
// 指令识别码写死在这里，和程序对得上由 contracts/solana-auto 的 Rust 测试 discriminators_match_ts_core 保证。
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from '@solana/web3.js'

/** ★程序地址：现在是开发用的；上主网时生成正式地址，这里、程序里的 declare_id、服务器一起改 */
export const SOL_AUTO_PROGRAM = new PublicKey('FUZp2mtL582G5ESPVCCEqMV9k28ZZuzhVL6eRwTA8oPQ')
export const SOL_USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
export const JUPITER_V6 = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
/** USDC 6 位小数；每日额度上限 10 万、授权最长 90 天（和程序、BNB Chain 版一致） */
export const SOL_USDC_DECIMALS = 6
export const SOL_MAX_PER_DAY_USDC = 100_000
export const SOL_MAX_DAYS = 90

/**
 * 全自动走 Jupiter 时只用这些交易池（报价参数 dexes）。做市商的专有池（HumidiFi、SolFi、Tessera、Kipseli 等）只接受真人钱包直接签名，
 * 程序代签会报「real_user did not sign」（2026-10-04 分叉联调实测 Kipseli），所以只放标准的公开池：覆盖 SOL / USDC 主流对和 meme 币的发射盘、迁移后的池子
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
/** 程序事件的识别码（服务器从交易日志里认成交结果） */
export const SOL_AUTO_EVENTS = { bought: [193, 56, 215, 24, 156, 76, 42, 104], sold: [205, 203, 210, 202, 96, 11, 192, 10] } as const

const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, SOL_AUTO_PROGRAM)[0]
export const solAutoConfig = () => pda([Buffer.from('config')])
export const solAutoUser = (user: PublicKey) => pda([Buffer.from('user'), user.toBuffer()])
export const solAutoPull = (user: PublicKey) => pda([Buffer.from('pull'), user.toBuffer()])
export const solAutoStage = (user: PublicKey) => pda([Buffer.from('stage'), user.toBuffer()])
/** 保险箱的签名人（每个用户每个币一个） */
export const solAutoVaultAuth = (user: PublicKey, mint: PublicKey) => pda([Buffer.from('vault'), user.toBuffer(), mint.toBuffer()])
export function ata(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0]
}
/** 这位用户这个币的保险箱（代币账户地址） */
export const solAutoVault = (user: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM) => ata(solAutoVaultAuth(user, mint), mint, tokenProgram)

// ---------- 参数编码（borsh） ----------
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b }
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b }
const bool = (v: boolean) => Buffer.from([v ? 1 : 0])
const bytes = (v: Uint8Array) => { const n = Buffer.alloc(4); n.writeUInt32LE(v.length); return Buffer.concat([n, Buffer.from(v)]) }
const data = (d: readonly number[], ...args: Buffer[]) => Buffer.concat([Buffer.from(d), ...args])
const m = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable })

// ---------- 用户签的 ----------

/**
 * 0x4 账号标记：sha256(账号地址)。写进链上 UserAuto，证明这个 Solana 钱包授权给哪个账号的小精灵用（只有钱包主人签得出开启），
 * 服务器只认链上这条，不认客户端报的地址
 */
export async function solAutoAccountTag(account: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(account)))
}

/** 开启 / 修改：perDay 是 USDC 最小单位，until 是 unix 秒，accountTag 用 solAutoAccountTag 算。同一笔里程序把用户 USDC 授权给 pull（数量 = 每日额度 × 天数） */
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

/** 关闭：不再买卖，撤销给我们的 USDC 授权 */
export function solAutoStopIx(user: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [m(user, false, true), m(solAutoUser(user), true), m(solAutoPull(user)), m(SOL_USDC), m(ata(user, SOL_USDC), true), m(TOKEN_PROGRAM)],
    data: data(DISC.stop),
  })
}

/** 把保险箱里的币提回自己的账户 dest（必须是自己的这个币的账户）。amount 传 null = 全部；close = 提完关掉空保险箱、押金退回 */
export function solAutoWithdrawIx(user: PublicKey, mint: PublicKey, tokenProgram: PublicKey, dest: PublicKey, amount: bigint | null, close: boolean): TransactionInstruction {
  const auth = solAutoVaultAuth(user, mint)
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [m(user, true, true), m(auth), m(mint), m(ata(auth, mint, tokenProgram), true), m(dest, true), m(tokenProgram)],
    data: data(DISC.withdraw, u64(amount ?? 0xffffffffffffffffn), bool(close)),
  })
}

/** 把中转里滞留的 USDC 拿回自己钱包（正常是 0，退路） */
export function solAutoRescueStageIx(user: PublicKey): TransactionInstruction {
  const stage = solAutoStage(user)
  return new TransactionInstruction({
    programId: SOL_AUTO_PROGRAM,
    keys: [m(user, false, true), m(stage), m(SOL_USDC), m(ata(stage, SOL_USDC), true), m(ata(user, SOL_USDC), true), m(TOKEN_PROGRAM)],
    data: data(DISC.rescueStage),
  })
}

// ---------- 服务器（operator）签的 ----------

/** Jupiter /swap-instructions 返回的 swapInstruction（accounts 是 { pubkey, isSigner, isWritable }，data 是 base64） */
export interface JupSwapIx { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }

/**
 * 路由账户原样透传，但在外层一律标成不签名：中转 / 保险箱是程序 PDA，外层没法签，由程序调 Jupiter 时自己签；
 * 别的账户就算 Jupiter 标了要签名，程序也不会替它签（程序里只给那一个 PDA 签名）
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

// ---------- 读状态 ----------

export interface SolAutoUserState { perDay: bigint; until: bigint; dayStart: bigint; spent: bigint; active: boolean; /** 0x4 账号标记（hex） */ accountTag: string }
/** 解 UserAuto 账户（8 字节识别码 + user 32 + per_day 8 + until 8 + day_start 8 + spent 8 + active 1 + bump 1 + account 32） */
export function decodeSolAutoUser(raw: Uint8Array): SolAutoUserState | null {
  const b = Buffer.from(raw)
  if (b.length < 106 || !b.subarray(0, 8).equals(Buffer.from([91, 116, 68, 126, 31, 175, 44, 79]))) return null
  return { perDay: b.readBigUInt64LE(40), until: b.readBigInt64LE(48), dayStart: b.readBigInt64LE(56), spent: b.readBigUInt64LE(64), active: b[72] === 1, accountTag: b.subarray(74, 106).toString('hex') }
}
