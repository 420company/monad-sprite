/**
 * Plugin: monad-trading — Monad testnet memecoin tools.
 * Read-only queries + unsigned tx builders. The server never signs.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';
import {
  findToken,
  listTokens,
  getMonBalance,
  getTokenBalance,
  priceFromReserves,
  LAUNCHER,
  type TokenInfo,
} from '../monad.js';
import { encodeFunctionData, parseEther, type Address } from 'viem';

const LAUNCHER_ABI_TX = [
  {
    name: 'buy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
  {
    name: 'sell',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
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

const tools: ToolDef[] = [
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
      description: "Get a wallet's MON balance and memecoin holdings on Monad testnet.",
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
];

function txPayload(to: string, data: string, value: string, description: string): ToolResult {
  return { ok: true, tx: { to, data, value, description } };
}

export const monadTradingPlugin: AgentPlugin = {
  name: 'monad-trading',
  version: '1.0.0',
  description: 'Monad testnet memecoin trading: prices, portfolio, unsigned buy/sell/launch transactions',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case 'get_token_price': {
        const t = await findToken(String(args.query));
        if (!t) return { ok: false, error: `Token "${args.query}" not found on MemeLauncher` };
        const price = priceFromReserves(t.reserveMON, t.reserveToken);
        const mcap = parseFloat(t.reserveMON) * 2;
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
          abi: LAUNCHER_ABI_TX,
          functionName: 'buy',
          args: [t.address as Address],
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
          abi: LAUNCHER_ABI_TX,
          functionName: 'sell',
          args: [t.address as Address, amount],
        });
        return txPayload(LAUNCHER, data, '0', `Sell ${args.amount_tokens} ${t.symbol}`);
      }
      case 'prepare_launch': {
        const data = encodeFunctionData({
          abi: LAUNCHER_ABI_TX,
          functionName: 'createToken',
          args: [String(args.name), String(args.symbol)],
        });
        return txPayload(LAUNCHER, data, '0', `Launch token ${args.name} (${args.symbol})`);
      }
      default:
        return { ok: false, error: `Unknown tool: ${toolName}` };
    }
  },
};
