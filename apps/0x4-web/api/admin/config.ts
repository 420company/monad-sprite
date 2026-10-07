/**
 * Admin API for agent configuration.
 *
 * GET  /api/admin/config — read current config (models, pricing)
 * POST /api/admin/config — update config { defaultChatModel, defaultImageModel, ... }
 * POST /api/admin/config { reset: true } — reset to defaults
 *
 * Auth: header `x-admin-secret: <ADMIN_SECRET>` (env var).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getConfig, updateConfig, resetConfig } from '../_lib/config.js';

function checkAuth(req: VercelRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false; // no secret configured = admin disabled
  return req.headers['x-admin-secret'] === secret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'unauthorized — set x-admin-secret header' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ config: getConfig() });
    }
    if (req.method === 'POST') {
      const body = req.body ?? {};
      if (body.reset) {
        return res.status(200).json({ config: resetConfig(), reset: true });
      }
      const allowed = [
        'defaultChatModel',
        'defaultImageModel',
        'defaultVideoModel',
        'defaultTtsModel',
        'defaultTtsVoice',
        'priceMarkup',
        'hiddenModels',
      ] as const;
      const patch: Record<string, unknown> = {};
      for (const k of allowed) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      return res.status(200).json({ config: updateConfig(patch) });
    }
    return res.status(405).json({ error: 'GET or POST only' });
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message.slice(0, 200) });
  }
}
