/**
 * zalienGate.ts — Agent access gate: Zalien Universe NFT (BNB Chain) OR SpritePass (Monad testnet).
 *
 * Each Zalien NFT (BNB Chain) = license key for one personal MonadSprite AI agent.
 * SpritePass (Monad testnet, free mint) = hackathon-friendly alternative so judges
 * can try the agent without buying a Zalien.
 * Frontend flow: connect wallet -> checkAgentAccess(wallet) -> holder? unlock agent : show mint CTA.
 *
 * - Read-only: only calls balanceOf, never asks for signatures/txs.
 * - No private keys anywhere in this module.
 */
import { createPublicClient, http, getAddress, isAddress } from "viem";
import { bsc, monadTestnet } from "viem/chains";

/** Zalien Universe (ZALIEN) on BNB Smart Chain mainnet — source: zalien.io /zalien-bsc.js */
export const ZALIEN_CONTRACT = "0x40223d0fcF191F573c5B3f6c286D09B363aAdF2D" as const;
/** Zalien testnet counterpart (BSC testnet), for dev only */
export const ZALIEN_TESTNET_CONTRACT = "0x812dC300b17F1Dc1E520F0649848e1e92E3b56e2" as const;
/** SpritePass on Monad testnet — free mint, unlocks the agent (deployed 2026-10-07) */
export const SPRITEPASS_CONTRACT = "0x815250d0314f32fc11c40ddcb60e7439534efb78" as const;

const ERC721_MIN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export interface GateCheckOptions {
  /** BSC RPC URL. Defaults to publicnode. */
  rpcUrl?: string;
  /** Override contract (e.g. testnet). Defaults to ZALIEN_CONTRACT. */
  contract?: string;
}

export interface GateResult {
  /** checksummed wallet that was checked */
  wallet: `0x${string}`;
  /** true when the wallet holds >= 1 Zalien */
  holder: boolean;
  /** number of Zaliens held */
  count: number;
  /** contract that was checked */
  contract: `0x${string}`;
}

/**
 * Check whether a wallet holds Zalien Universe NFTs on BNB Chain.
 * @throws on malformed wallet address.
 * RPC failures / contract reverts resolve to { holder: false, count: 0 } (fail-closed).
 */
export async function checkZalienHolder(
  wallet: string,
  opts: GateCheckOptions = {}
): Promise<GateResult> {
  if (!isAddress(wallet)) throw new Error(`zalienGate: invalid wallet address: ${wallet}`);
  const checksumWallet = getAddress(wallet);
  const contract = getAddress(opts.contract ?? ZALIEN_CONTRACT);
  const client = createPublicClient({
    chain: bsc,
    transport: http(opts.rpcUrl ?? "https://bsc-rpc.publicnode.com"),
  });
  try {
    const count = await client.readContract({
      address: contract,
      abi: ERC721_MIN_ABI,
      functionName: "balanceOf",
      args: [checksumWallet],
    });
    const n = Number(count);
    return { wallet: checksumWallet, holder: n > 0, count: n, contract };
  } catch {
    // fail-closed: RPC down or contract revert -> treat as not a holder
    return { wallet: checksumWallet, holder: false, count: 0, contract };
  }
}

/** Convenience: boolean only. */
export async function isZalienHolder(wallet: string, opts: GateCheckOptions = {}): Promise<boolean> {
  return (await checkZalienHolder(wallet, opts)).holder;
}

export interface AgentAccessResult {
  wallet: `0x${string}`;
  /** true when the wallet holds a Zalien (BSC) or a SpritePass (Monad testnet) */
  holder: boolean;
  zalienCount: number;
  spritePassCount: number;
  /** which credential unlocked the agent, if any */
  via: 'zalien' | 'spritepass' | null;
}

/**
 * Check agent access: Zalien on BNB Chain OR SpritePass on Monad testnet.
 * Fail-closed per chain; either credential unlocks.
 */
export async function checkAgentAccess(wallet: string): Promise<AgentAccessResult> {
  if (!isAddress(wallet)) throw new Error(`agentGate: invalid wallet address: ${wallet}`);
  const checksumWallet = getAddress(wallet);
  const monadClient = createPublicClient({
    chain: monadTestnet,
    transport: http("https://testnet-rpc.monad.xyz"),
  });
  const [zalien, passCount] = await Promise.all([
    checkZalienHolder(checksumWallet).catch(() => ({ holder: false, count: 0 })),
    monadClient.readContract({
      address: SPRITEPASS_CONTRACT,
      abi: ERC721_MIN_ABI,
      functionName: "balanceOf",
      args: [checksumWallet],
    }).then(Number).catch(() => 0),
  ]);
  const via = zalien.holder ? 'zalien' : passCount > 0 ? 'spritepass' : null;
  return {
    wallet: checksumWallet,
    holder: via !== null,
    zalienCount: zalien.count,
    spritePassCount: passCount,
    via,
  };
}

/** Check SpritePass balance on Monad testnet (free mint). */
export async function checkSpritePassHolder(wallet: string): Promise<number> {
  if (!isAddress(wallet)) throw new Error(`agentGate: invalid wallet address: ${wallet}`);
  const client = createPublicClient({
    chain: monadTestnet,
    transport: http("https://testnet-rpc.monad.xyz"),
  });
  try {
    return Number(await client.readContract({
      address: SPRITEPASS_CONTRACT,
      abi: ERC721_MIN_ABI,
      functionName: "balanceOf",
      args: [getAddress(wallet)],
    }));
  } catch {
    return 0;
  }
}

/** Verify the gate is pointed at the real Zalien collection (name/symbol check). */
export async function verifyCollection(opts: GateCheckOptions = {}): Promise<{
  name: string;
  symbol: string;
  contract: `0x${string}`;
}> {
  const contract = getAddress(opts.contract ?? ZALIEN_CONTRACT);
  const client = createPublicClient({
    chain: bsc,
    transport: http(opts.rpcUrl ?? "https://bsc-rpc.publicnode.com"),
  });
  const [name, symbol] = await Promise.all([
    client.readContract({ address: contract, abi: ERC721_MIN_ABI, functionName: "name" }),
    client.readContract({ address: contract, abi: ERC721_MIN_ABI, functionName: "symbol" }),
  ]);
  return { name, symbol, contract };
}
