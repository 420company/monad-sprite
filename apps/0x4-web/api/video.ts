/**
 * Video generation via router.ai (async).
 *
 * POST /api/video { prompt, model?, seconds? } -> { video_id, status }
 * GET  /api/video?id=xxx -> { status, url? }
 *
 * Frontend polls GET until status=completed, then shows the video.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = (process.env.ROUTER_AI_BASE_URL || 'https://api.router.ai').replace(/\/$/, '');

function key(): string {
  const k = process.env.ROUTER_AI_KEY;
  if (!k) throw new Error('ROUTER_AI_KEY not configured');
  return k;
}

const DEFAULT_VIDEO_MODEL = 'dreamina-seedance-2-0-mini-260615'; // fast + cheap

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key()}`,
  };

  try {
    if (req.method === 'POST') {
      const { prompt, model, seconds, image, aspect_ratio, audio } = req.body ?? {};
      if (!prompt) return res.status(400).json({ error: 'prompt required' });
      const payload: Record<string, unknown> = {
        model: model || DEFAULT_VIDEO_MODEL,
        prompt: String(prompt).slice(0, 2000),
      };
      if (seconds) payload.seconds = Math.min(Number(seconds), 30);
      // TEST ONLY: passthrough for capability probing (to be reverted)
      if (image) payload.image = image;
      if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
      if (audio !== undefined) payload.audio = audio;

      const r = await fetch(`${BASE}/v1/videos/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`video start failed: ${r.status} ${body.slice(0, 200)}`);
      }
      const d = await r.json();
      const vid = d.id || d.data?.[0]?.id;
      if (!vid) throw new Error('no video id returned');
      return res.status(200).json({ video_id: vid, status: 'processing' });
    }

    if (req.method === 'GET') {
      const id = String(req.query.id || '');
      if (!id) return res.status(400).json({ error: 'id required' });

      const r = await fetch(`${BASE}/v1/videos/generations/${id}`, { headers });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`video status failed: ${r.status} ${body.slice(0, 200)}`);
      }
      const d = await r.json();
      const status = d.status || d.state || 'unknown';
      const done = ['completed', 'succeeded', 'done'].includes(status);
      const failed = ['failed', 'error', 'cancelled'].includes(status);
      // Try common URL fields
      const url =
        d.url || d.video_url || d.data?.[0]?.url || (done ? `${BASE}/v1/videos/generations/${id}/download` : null);
      return res.status(200).json({ video_id: id, status: done ? 'completed' : failed ? 'failed' : 'processing', url });
    }

    return res.status(405).json({ error: 'GET or POST only' });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message.slice(0, 300) });
  }
}
