/**
 * Shared agent conversation loop — used by both the web endpoint (api/agent.ts)
 * and the Telegram webhook (api/telegram.ts).
 */
import { chatCompletions, DEFAULT_MODEL, type ChatMessage } from './router.js';
import { TOOLS, executeTool } from './tools.js';

export const SYSTEM_PROMPT = `You are Sprite, the AI agent of monad-sprite — a Monad-native memecoin terminal. You are a sharp, capable, slightly playful assistant, like a crypto-native friend who actually gets things done.

Capabilities (use tools when the user asks):
- Monad testnet memecoins: check prices (get_token_price), list new launches (list_tokens), check a wallet's portfolio (get_portfolio)
- Trading: prepare_buy / prepare_sell / prepare_launch return an unsigned transaction — tell the user to review and sign it in MetaMask. NEVER claim a trade executed until the user confirms.
- generate_image: make memes, art, pfps — be creative, make it funny, never low-effort
- run_code: run JavaScript for calculations, analysis, quick scripts

Rules:
- You live on Monad TESTNET (chain 10143, currency MON). Always remind users this is testnet, not real money.
- When a tool returns a tx payload, present it clearly: what it does, then ask the user to confirm in their wallet. On Telegram, tell them to open the web app to sign.
- For image generation, write a detailed English prompt and share the result URL.
- Keep replies concise and natural. Use markdown lightly (bold, code, bullets).
- Never promise profits or give financial advice. No price predictions.
- If the user's wallet address is provided in context, use it for portfolio lookups without asking again.
- You can chat about anything — you're a full AI assistant, not just a trading bot.`;

const MAX_TURNS = 6;

export interface AgentResult {
  reply: string;
  tx?: { to: string; data: string; value: string; description: string } | null;
  image_url?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function runAgent(opts: {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  wallet?: string;
  model?: string;
}): Promise<AgentResult> {
  const history: ChatMessage[] = opts.messages.slice(-20).map((m) => ({
    role: m.role,
    content: String(m.content ?? '').slice(0, 8000),
  }));

  const sysMessages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (opts.wallet) {
    sysMessages.push({
      role: 'system',
      content: `The user's connected wallet is ${opts.wallet} (Monad testnet). Use it for portfolio lookups.`,
    });
  }

  const convo: ChatMessage[] = [...sysMessages, ...history];
  let usage;
  let pendingTx: AgentResult['tx'] = null;
  let imageUrl: string | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const out = await chatCompletions({
      model: opts.model || DEFAULT_MODEL,
      messages: convo,
      tools: TOOLS,
    });
    usage = out.usage;

    if (!out.tool_calls || out.tool_calls.length === 0) {
      return { reply: out.content ?? '', tx: pendingTx, image_url: imageUrl, usage };
    }

    convo.push({ role: 'assistant', content: out.content, tool_calls: out.tool_calls });

    for (const tc of out.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      if (tc.function.name === 'get_portfolio' && opts.wallet && !args.wallet) {
        args.wallet = opts.wallet;
      }
      const result = await executeTool(tc.function.name, args);
      if (result.tx) pendingTx = result.tx;
      const data = result as unknown as { image_url?: string };
      if (result.ok && data.data && typeof data.data === 'object' && 'image_url' in data.data) {
        imageUrl = (data.data as { image_url: string }).image_url;
      }
      convo.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  return {
    reply: 'I ran into too many steps — could you simplify the request?',
    tx: pendingTx,
    image_url: imageUrl,
    usage,
  };
}
