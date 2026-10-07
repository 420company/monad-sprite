/**
 * POST /api/telegram — Telegram webhook for the Sprite agent.
 *
 * Setup:
 *  1. Create a bot via @BotFather, get the token
 *  2. Set env var TELEGRAM_BOT_TOKEN on Vercel
 *  3. Set webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://monad-sprite.vercel.app/api/telegram
 *
 * Each Telegram user gets their own conversation (in-memory per chat_id;
 * serverless may reset — for the demo this is fine).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runAgent } from './_lib/agentCore.js';

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  return t;
}

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`telegram ${method} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// In-memory conversations keyed by chat id (demo-grade; use KV/DB for production)
const conversations = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>();

function escapeMd(text: string): string {
  // We send as plain text to avoid MarkdownV2 escaping pain
  return text;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const update = req.body ?? {};
    const msg = update.message;
    // Acknowledge fast so Telegram doesn't retry
    res.status(200).json({ ok: true });
    if (!msg?.text || !msg?.chat?.id) return;

    const chatId: number = msg.chat.id;
    const text: string = String(msg.text).slice(0, 4000);

    if (text === '/start') {
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Hey! I\'m Sprite — your AI agent on Monad testnet.\n\nI can chat, check memecoin prices, generate images, run code, and prepare trades (you sign in the web app).\n\nTry: "price SPRITE" or "draw a cyberpunk cat"',
      });
      return;
    }

    const history = conversations.get(chatId) ?? [];
    history.push({ role: 'user', content: text });

    await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

    const result = await runAgent({ messages: history.slice(-20) });
    history.push({ role: 'assistant', content: result.reply });
    conversations.set(chatId, history.slice(-40));

    let replyText = result.reply || '(no reply)';
    if (result.tx) {
      replyText += `\n\n📝 *Trade prepared:* ${result.tx.description}\nOpen the web app to review & sign in your wallet: https://monad-sprite.vercel.app/agent`;
    }
    // Telegram message limit 4096
    for (let i = 0; i < replyText.length; i += 4000) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: escapeMd(replyText.slice(i, i + 4000)),
      });
    }
    if (result.image_url) {
      await tg('sendPhoto', { chat_id: chatId, photo: result.image_url });
    }
  } catch (e) {
    // Already acked; log only
    console.error('telegram webhook error:', (e as Error).message);
  }
}
