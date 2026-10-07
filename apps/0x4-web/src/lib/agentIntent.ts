// Zalien agent intent parser (added 2026-10-07 for hackathon).
// Small local parser, no LLM: turns a chat line into one of three trading intents.
//   buy   — "buy 0.1 MON of SPRITE", "buy 0.1 SPRITE", "buy 0.1 mon worth of 0xabc..."
//   sell  — "sell 100 SPRITE", "sell 100 of SPRITE", "sell 2.5 SPRITE"
//   price — "price SPRITE", "price of SPRITE", "SPRITE price", "what is the price of SPRITE?"
// Amounts are kept as exact wei bigints (18 decimals: MON and every MemeLauncher token).
import { parseEther } from 'viem'

/** Token reference as typed by the user: a ticker symbol or a 0x contract address */
export type TokenRef = { kind: 'symbol'; symbol: string } | { kind: 'address'; address: `0x${string}` }

export type AgentIntent =
  | { kind: 'buy'; monWei: bigint; amount: string; token: TokenRef }
  | { kind: 'sell'; tokenWei: bigint; amount: string; token: TokenRef }
  | { kind: 'price'; token: TokenRef }
  | { kind: 'help' }
  | { kind: 'unknown'; reason: string }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SYMBOL = /^[A-Za-z0-9]{1,10}$/
// Up to 18 decimals; leading-dot forms like ".5" are accepted
const AMOUNT = /^(?:\d+(?:\.\d{0,18})?|\.\d{1,18})$/

/** Parse a token word into a reference; null when it is neither a symbol nor an address */
export function parseTokenRef(word: string): TokenRef | null {
  const w = word.trim().replace(/^\$/, '')
  if (ADDRESS.test(w)) return { kind: 'address', address: w as `0x${string}` }
  // A truncated or mistyped address must not silently fall through to a ticker lookup
  if (/^0x/i.test(w)) return null
  if (SYMBOL.test(w)) return { kind: 'symbol', symbol: w.toUpperCase() }
  return null
}

/** Parse a positive decimal amount into 18-decimal wei; null when malformed or zero */
export function parseAmount(text: string): bigint | null {
  const s = text.trim()
  if (!AMOUNT.test(s)) return null
  const wei = parseEther(s.startsWith('.') ? `0${s}` : s)
  return wei > 0n ? wei : null
}

/** Human-readable label for a token reference */
export function tokenLabel(ref: TokenRef): string {
  return ref.kind === 'symbol' ? ref.symbol : `${ref.address.slice(0, 6)}...${ref.address.slice(-4)}`
}

export const HELP_TEXT =
  'I understand three commands:\n' +
  '- buy <amount> MON of <TOKEN>   e.g. "buy 0.1 MON of SPRITE"\n' +
  '- sell <amount> <TOKEN>         e.g. "sell 100 SPRITE"\n' +
  '- price <TOKEN>                 e.g. "price SPRITE"\n' +
  'TOKEN can be a ticker or a 0x contract address. Every trade asks for confirmation first.'

/** Parse one chat line into an intent. Never throws. */
export function parseIntent(input: string): AgentIntent {
  // Normalize: lowercase keywords only (token words keep their case for addresses), strip trailing punctuation
  const words = input.trim().replace(/[?!.,;]+$/, '').split(/\s+/).filter(Boolean)
  if (!words.length) return { kind: 'unknown', reason: 'Type a command, or "help" to see examples.' }
  const lower = words.map((w) => w.toLowerCase())
  const verb = lower[0]

  if (verb === 'help' || verb === '?' || verb === 'commands') return { kind: 'help' }

  if (verb === 'buy') {
    // buy <amount> [mon] [worth] [of] <token>
    const amount = words[1]
    const monWei = amount ? parseAmount(amount) : null
    if (!amount || monWei === null) return { kind: 'unknown', reason: 'Buy needs a MON amount, e.g. "buy 0.1 MON of SPRITE".' }
    const rest = dropFillers(words.slice(2), ['mon', 'worth', 'of'])
    if (rest.length !== 1) return { kind: 'unknown', reason: 'Which token? e.g. "buy 0.1 MON of SPRITE".' }
    const token = parseTokenRef(rest[0])
    if (!token) return { kind: 'unknown', reason: `"${rest[0]}" is not a valid token ticker or address.` }
    return { kind: 'buy', monWei, amount: normalizeAmount(amount), token }
  }

  if (verb === 'sell') {
    // sell <amount> [of] <token>
    const amount = words[1]
    const tokenWei = amount ? parseAmount(amount) : null
    if (!amount || tokenWei === null) return { kind: 'unknown', reason: 'Sell needs a token amount, e.g. "sell 100 SPRITE".' }
    const rest = dropFillers(words.slice(2), ['of'])
    if (rest.length !== 1) return { kind: 'unknown', reason: 'Which token? e.g. "sell 100 SPRITE".' }
    const token = parseTokenRef(rest[0])
    if (!token) return { kind: 'unknown', reason: `"${rest[0]}" is not a valid token ticker or address.` }
    if (token.kind === 'symbol' && token.symbol === 'MON') return { kind: 'unknown', reason: 'Sell takes a launcher token, not MON, e.g. "sell 100 SPRITE".' }
    return { kind: 'sell', tokenWei, amount: normalizeAmount(amount), token }
  }

  // price <token> | price of <token> | <token> price | what is the price of <token>
  const pi = lower.indexOf('price')
  if (pi >= 0) {
    const after = dropFillers(words.slice(pi + 1), ['of', 'for'])
    const before = dropFillers(words.slice(0, pi), ['what', "what's", 'whats', 'is', 'the', 'current'])
    const candidates = after.length ? after : before
    if (candidates.length !== 1) return { kind: 'unknown', reason: 'Which token? e.g. "price SPRITE".' }
    const token = parseTokenRef(candidates[0])
    if (!token) return { kind: 'unknown', reason: `"${candidates[0]}" is not a valid token ticker or address.` }
    return { kind: 'price', token }
  }

  return { kind: 'unknown', reason: 'Sorry, I only understand buy, sell and price for now. Type "help" for examples.' }
}

/** Remove filler words (case-insensitive) from a word list */
function dropFillers(words: string[], fillers: string[]): string[] {
  return words.filter((w) => !fillers.includes(w.toLowerCase()))
}

/** "0.10" -> "0.1", ".5" -> "0.5" for display */
function normalizeAmount(s: string): string {
  let out = s.startsWith('.') ? `0${s}` : s
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '')
  return out
}
