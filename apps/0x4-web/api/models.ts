/**
 * GET /api/models — list available models from router.ai.
 * Returns a curated list grouped by capability. No auth needed (no key exposed).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = (process.env.ROUTER_AI_BASE_URL || 'https://api.router.ai').replace(/\/$/, '');

function key(): string {
  const k = process.env.ROUTER_AI_KEY;
  if (!k) throw new Error('ROUTER_AI_KEY not configured');
  return k;
}

interface ModelInfo {
  id: string;
  label: string;
  group: 'chat' | 'image' | 'video' | 'other';
}

function classify(id: string): ModelInfo['group'] {
  const l = id.toLowerCase();
  if (l.includes('image') || l.includes('seedream') || l.includes('dola-seed')) return 'image';
  if (l.includes('video') || l.includes('seedance') || l.includes('dreamina') || l.includes('sora') || l.includes('veo')) return 'video';
  if (l.includes('embed')) return 'other';
  return 'chat';
}

function label(id: string): string {
  // claude-sonnet-4-5-20250929 -> Claude Sonnet 4.5
  return id
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s\d{8}$/, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const r = await fetch(`${BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${key()}` },
    });
    if (!r.ok) throw new Error(`models fetch failed: ${r.status}`);
    const data = await r.json();
    const ids: string[] = (data.data || []).map((m: { id: string }) => m.id).filter(Boolean);

    const models: ModelInfo[] = ids.map((id) => ({ id, label: label(id), group: classify(id) }));
    // Sort: chat first, then alphabetical
    const order = { chat: 0, image: 1, video: 2, other: 3 };
    models.sort((a, b) => order[a.group] - order[b.group] || a.id.localeCompare(b.id));

    return res.status(200).json({
      default: 'claude-sonnet-4-5-20250929',
      models,
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message.slice(0, 200) });
  }
}
