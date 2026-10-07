/**
 * POST /api/agent — Sprite AI agent endpoint (web).
 * Body: { messages: [{role, content, images?}], wallet?: "0x...", model?: string }
 *
 * Billing: checks wallet credit balance, deducts per usage after the call.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runAgent } from './_lib/agentCore.js';
import { getBalance, ensureFreeTier, deduct, calcCost } from './_lib/billing.js';

const MIN_BALANCE = 0.001; // must have at least this much to call

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

    // Billing check (skip if no wallet — backwards compatible, free)
    let billed = false;
    if (wallet && String(wallet).startsWith('0x')) {
      const bal = ensureFreeTier(String(wallet));
      if (bal < MIN_BALANCE) {
        return res.status(402).json({
          error: 'Insufficient credit. Top up USDT to continue.',
          balance_usd: bal,
        });
      }
    }

    const result = await runAgent({ messages, wallet, model });

    // Deduct based on actual token usage
    let deduction: { cost: number; balance: number } | null = null;
    if (wallet && String(wallet).startsWith('0x') && result.usage) {
      const cost = calcCost({
        model: model || 'deepseek-v4-flash',
        kind: 'chat',
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
      });
      // Add media costs if generated
      let total = cost;
      if (result.image_url) total += calcCost({ model: 'dola-seedream-5-0-pro-260628', kind: 'image' });
      if (result.video_id) total += calcCost({ model: 'wan3.0-video', kind: 'video', seconds: 5 });
      if (result.audio_base64) {
        total += calcCost({ model: 'qwen3-tts-flash', kind: 'tts', chars: result.reply.length });
      }
      const d = deduct(String(wallet), total, { model: model || 'deepseek-v4-flash', kind: 'chat' });
      if (d.ok) {
        billed = true;
        deduction = { cost: d.cost, balance: d.balance };
      }
    }

    return res.status(200).json({
      ...result,
      billing: deduction ? { charged_usd: deduction.cost, balance_usd: deduction.balance } : null,
    });
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg.includes('ROUTER_AI_KEY') ? 503 : 500;
    return res.status(status).json({ error: msg.slice(0, 300) });
  }
}
