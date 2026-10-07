/**
 * GET /api/cron/brief — scheduled 24/7 agent task (Vercel Cron).
 *
 * Generates a portfolio + market brief via the agent and pushes it to Telegram.
 * Configure via env vars:
 *   BRIEF_CHAT_ID  — Telegram chat id to push to
 *   BRIEF_WALLET   — Monad testnet wallet to report on
 *   TELEGRAM_BOT_TOKEN — bot token
 *   CRON_SECRET    — shared secret; Vercel Cron sends it as ?secret=
 *
 * vercel.json:
 *   { "crons": [{ "path": "/api/cron/brief?secret=XXX", "schedule": "0 1 * * *" }] }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runAgent } from '../_lib/agentCore.js';

async function tgSend(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error(`telegram send failed: ${res.status}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Simple shared-secret auth for cron
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const chatId = process.env.BRIEF_CHAT_ID;
  const wallet = process.env.BRIEF_WALLET;
  if (!chatId) return res.status(500).json({ error: 'BRIEF_CHAT_ID not configured' });

  try {
    const result = await runAgent({
      messages: [
        {
          role: 'user',
          content:
            'Give me my morning brief: my MON balance and memecoin holdings, plus the top 5 newest tokens on the launcher with prices. Keep it short, bullet points, no fluff.',
        },
      ],
      wallet,
    });
    await tgSend(chatId, `☀️ Morning brief\n\n${result.reply}`);
    return res.status(200).json({ ok: true, usage: result.usage });
  } catch (e) {
    const msg = (e as Error).message;
    try {
      await tgSend(chatId, `⚠️ Morning brief failed: ${msg.slice(0, 200)}`);
    } catch {
      /* ignore */
    }
    return res.status(500).json({ error: msg.slice(0, 300) });
  }
}
