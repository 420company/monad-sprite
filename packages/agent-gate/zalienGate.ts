/**
 * zalienGate.ts — Zalien Universe NFT holder gate.
 *
 * Each Zalien NFT (BNB Chain) = license key for one personal MonadSprite AI agent.
 * Frontend flow: connect wallet -> checkZalienHolder(wallet) -> holder? unlock agent : show mint CTA.
 *
 * - Read-only: only calls balanceOf on BSC, never asks for signatures/txs.
 * - No private keys anywhere in this module.
 */
import { createPublicClient, http, getAddress, isAddress } from "viem";
import { bsc } from "viem/chains";

/** Zalien Universe (ZALIEN) on BNB Smart Chain mainnet — source: zalien.io /zalien-bsc.js */
export const ZALIEN_CONTRACT = "0x40223d0fcF191F573c5B3f6c286D09B363aAdF2D" as const;
/** Zalien testnet counterpart (BSC testnet), for dev only */
export const ZALIEN_TESTNET_CONTRACT = "0x812dC300b17F1Dc1E520F0649848e1e92E3b56e2" as const;

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
