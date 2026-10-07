/**
 * POST /api/agent — Sprite AI agent endpoint (web).
 * Body: { messages: [{role, content}], wallet?: "0x...", model?: string }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runAgent } from './_lib/agentCore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { messages, wallet, model } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages[] required' });
    }
    const result = await runAgent({ messages, wallet, model });
    return res.status(200).json(result);
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg.includes('ROUTER_AI_KEY') ? 503 : 500;
    return res.status(status).json({ error: msg.slice(0, 300) });
  }
}
