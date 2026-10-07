/**
 * Plugin: voice — text-to-speech via router.ai (Qwen TTS).
 * Returns base64 MP3 audio. Used for Telegram voice replies.
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
      name: 'text_to_speech',
      description:
        'Convert text to speech (MP3 audio, base64). Use when the user asks for a voice message or audio reply. Keep text under 500 chars for speed.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to speak (max 500 chars)' },
          voice: { type: 'string', description: 'Voice name (default "Cherry")' },
        },
        required: ['text'],
      },
    },
  },
];

export async function synthesize(text: string, voice?: string, model?: string): Promise<Buffer> {
  const cfg = getConfig();
  const r = await fetch(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key()}`,
    },
    body: JSON.stringify({
      model: model || cfg.defaultTtsModel,
      input: text.slice(0, 500),
      voice: voice || cfg.defaultTtsVoice,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`TTS failed: ${r.status} ${body.slice(0, 200)}`);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 100) throw new Error('TTS returned empty audio');
  return buf;
}

export const voicePlugin: AgentPlugin = {
  name: 'voice',
  version: '1.0.0',
  description: 'Text-to-speech (Qwen TTS via router.ai)',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== 'text_to_speech') return { ok: false, error: `Unknown tool: ${toolName}` };
    const buf = await synthesize(String(args.text), String(args.voice || 'Cherry'));
    return {
      ok: true,
      data: {
        audio_base64: buf.toString('base64'),
        format: 'mp3',
        chars: String(args.text).length,
        note: 'MP3 audio as base64. Play it or forward to the user.',
      },
    };
  },
};
