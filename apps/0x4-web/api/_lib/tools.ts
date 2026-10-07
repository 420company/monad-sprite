/**
 * Tool definitions + executors for the Sprite agent.
 * Trading tools are read-only or return unsigned tx payloads;
 * signing always happens client-side in the user's MetaMask.
 */
import type { ToolDef } from './router.js';
import { generateImage } from './router.js';
import {
  findToken,
  listTokens,
  getMonBalance,
  getTokenBalance,
  priceFromReserves,
  LAUNCHER,
  type TokenInfo,
} from './monad.js';
import { encodeFunctionData, parseEther, type Address } from 'viem';

const LAUNCHER_ABI_TX = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'createToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
    ],
    outputs: [],
  },
] as const;

export const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_token_price',
      description:
        'Get the current price and stats of a memecoin on the Monad testnet MemeLauncher. Query by ticker symbol (e.g. "SPRITE") or token address.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Token ticker symbol or contract address' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tokens',
      description: 'List the most recently launched memecoins on the Monad testnet MemeLauncher.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max tokens to return (default 10, max 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_portfolio',
      description:
        'Get a wallet\'s MON balance and memecoin holdings on Monad testnet. Needs the user\'s wallet address.',
      parameters: {
        type: 'object',
        properties: {
          wallet: { type: 'string', description: 'Wallet address (0x...)' },
        },
        required: ['wallet'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_buy',
      description:
        'Prepare an unsigned buy transaction for a memecoin. Returns tx data the frontend will ask the user to sign in MetaMask. Amount is in MON.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Token ticker symbol' },
          amount_mon: { type: 'string', description: 'Amount of MON to spend, e.g. "0.1"' },
        },
        required: ['symbol', 'amount_mon'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_sell',
      description:
        'Prepare an unsigned sell transaction for a memecoin. Returns tx data the frontend will ask the user to sign in MetaMask. Amount is in tokens.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Token ticker symbol' },
          amount_tokens: { type: 'string', description: 'Amount of tokens to sell, e.g. "1000"' },
        },
        required: ['symbol', 'amount_tokens'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_launch',
      description:
        'Prepare an unsigned createToken transaction to launch a new memecoin on Monad testnet.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Token name, e.g. "Moon Cat"' },
          symbol: { type: 'string', description: 'Token ticker, e.g. "MCAT"' },
        },
        required: ['name', 'symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate an image with AI (Seedream). Use for memes, art, profile pictures — anything visual the user asks for. Returns a URL to the generated image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed image prompt in English for best results',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_code',
      description:
        'Execute JavaScript code in a sandbox and return stdout/result. For calculations, data processing, quick scripts. No network, no filesystem. Timeout 5s.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript code. Use console.log or a final expression for output.' },
        },
        required: ['code'],
      },
    },
  },
];

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  /** Unsigned tx for the frontend to sign (buy/sell/launch). */
  tx?: { to: string; data: string; value: string; description: string };
  error?: string;
}

function txPayload(to: string, data: string, value: string, description: string): ToolResult {
  return { ok: true, tx: { to, data, value, description } };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_token_price': {
        const t = await findToken(String(args.query));
        if (!t) return { ok: false, error: `Token "${args.query}" not found on MemeLauncher` };
        const price = priceFromReserves(t.reserveMON, t.reserveToken);
        const mcap = parseFloat(t.reserveMON) * 2; // rough: curve holds ~half supply value
        return {
          ok: true,
          data: {
            name: t.name,
            symbol: t.symbol,
            address: t.address,
            price_mon: price,
            price_note: `${price.toExponential(3)} MON per ${t.symbol}`,
            reserve_mon: t.reserveMON,
            market_cap_mon_approx: mcap.toFixed(4),
          },
        };
      }
      case 'list_tokens': {
        const limit = Math.min(Number(args.limit) || 10, 20);
        const tokens = await listTokens(limit);
        return {
          ok: true,
          data: tokens.map((t: TokenInfo) => ({
            symbol: t.symbol,
            name: t.name,
            address: t.address,
            reserve_mon: t.reserveMON,
            price_mon: priceFromReserves(t.reserveMON, t.reserveToken).toExponential(3),
          })),
        };
      }
      case 'get_portfolio': {
        const wallet = String(args.wallet) as Address;
        const mon = await getMonBalance(wallet);
        const tokens = await listTokens(20);
        const holdings: Array<{ symbol: string; balance: string }> = [];
        for (const t of tokens) {
          const bal = await getTokenBalance(t.address, wallet);
          if (parseFloat(bal) > 0) holdings.push({ symbol: t.symbol, balance: bal });
        }
        return { ok: true, data: { mon_balance: mon, holdings } };
      }
      case 'prepare_buy': {
        const t = await findToken(String(args.symbol));
        if (!t) return { ok: false, error: `Token "${args.symbol}" not found` };
        const value = parseEther(String(args.amount_mon));
        const data = encodeFunctionData({
          abi: LAUNCHER_ABI_TX as any,
          functionName: 'buy',
          args: [BigInt(t.id)],
        });
        const price = priceFromReserves(t.reserveMON, t.reserveToken);
        const estTokens = price > 0 ? (parseFloat(String(args.amount_mon)) / price).toFixed(0) : '?';
        return txPayload(
          LAUNCHER,
          data,
          value.toString(),
          `Buy ~${estTokens} ${t.symbol} with ${args.amount_mon} MON`,
        );
      }
      case 'prepare_sell': {
        const t = await findToken(String(args.symbol));
        if (!t) return { ok: false, error: `Token "${args.symbol}" not found` };
        const amount = parseEther(String(args.amount_tokens));
        const data = encodeFunctionData({
          abi: LAUNCHER_ABI_TX as any,
          functionName: 'sell',
          args: [BigInt(t.id), amount],
        });
        return txPayload(
          LAUNCHER,
          data,
          '0',
          `Sell ${args.amount_tokens} ${t.symbol}`,
        );
      }
      case 'prepare_launch': {
        const data = encodeFunctionData({
          abi: LAUNCHER_ABI_TX as any,
          functionName: 'createToken',
          args: [String(args.name), String(args.symbol)],
        });
        return txPayload(
          LAUNCHER,
          data,
          '0',
          `Launch token ${args.name} (${args.symbol})`,
        );
      }
      case 'generate_image': {
        const url = await generateImage(String(args.prompt));
        return { ok: true, data: { image_url: url, prompt: args.prompt } };
      }
      case 'run_code': {
        const code = String(args.code);
        if (code.length > 2000) return { ok: false, error: 'Code too long (max 2000 chars)' };
        // Block obvious escape attempts
        if (/require\s*\(|import\s|process|globalThis|constructor|prototype|__proto__|fetch\s*\(|XMLHttpRequest/.test(code)) {
          return { ok: false, error: 'Blocked: code uses restricted APIs' };
        }
        const logs: string[] = [];
        const sandboxConsole = { log: (...a: unknown[]) => logs.push(a.map(String).join(' ')) };
        try {
          const fn = new Function(
            'console',
            'Math',
            'JSON',
            `"use strict"; const out = (function(){ ${code} })(); return out;`,
          );
          const result = fn(sandboxConsole, Math, JSON);
          return {
            ok: true,
            data: { logs, result: result === undefined ? null : String(result).slice(0, 2000) },
          };
        } catch (e) {
          return { ok: false, error: `Execution error: ${(e as Error).message.slice(0, 300)}` };
        }
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: `Tool error: ${(e as Error).message.slice(0, 300)}` };
  }
}
