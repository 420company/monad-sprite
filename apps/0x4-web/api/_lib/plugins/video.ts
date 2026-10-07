/**
 * Plugin: video — AI video generation via router.ai (async).
 * Starts a job; the frontend polls /api/video?id=xxx until done.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';
import { getConfig } from '../config.js';

const BASE = (process.env.ROUTER_AI_BASE_URL || 'https://api.router.ai').replace(/\/$/, '');

function key(): string {
  const k = process.env.ROUTER_AI_KEY;
  if (!k) throw new Error('ROUTER_AI_KEY not configured');
  return k;
}

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description:
        'Generate a short AI video from a text prompt (Seedance/Wan). Async: returns a video_id immediately; the video takes 1-3 minutes. Tell the user it is generating and they can check back.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed video prompt in English for best results' },
          seconds: { type: 'number', description: 'Duration in seconds, max 30 (default 5)' },
        },
        required: ['prompt'],
      },
    },
  },
];

export const videoPlugin: AgentPlugin = {
  name: 'video',
  version: '1.0.0',
  description: 'AI video generation (Seedance/Wan via router.ai, async)',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== 'generate_video') return { ok: false, error: `Unknown tool: ${toolName}` };
    const r = await fetch(`${BASE}/v1/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key()}`,
      },
      body: JSON.stringify({
        model: (args.model as string) || getConfig().defaultVideoModel,
        prompt: String(args.prompt).slice(0, 2000),
        seconds: Math.min(Number(args.seconds) || 5, 30),
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, error: `video start failed: ${r.status} ${body.slice(0, 200)}` };
    }
    const d = await r.json();
    const vid = d.id || d.data?.[0]?.id;
    if (!vid) return { ok: false, error: 'no video id returned' };
    return {
      ok: true,
      data: {
        video_id: vid,
        status: 'processing',
        check_url: `/api/video?id=${vid}`,
        note: 'Video is generating (1-3 min). Poll check_url until status=completed.',
      },
    };
  },
};
