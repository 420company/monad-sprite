/**
 * router.ai client (OpenAI-compatible). Key comes from ROUTER_AI_KEY env var.
 * Base URL defaults to https://api.router.ai, override with ROUTER_AI_BASE_URL
 * (e.g. if using the luna.gift relay endpoint).
 * Never log or expose the key.
 */
const BASE = (process.env.ROUTER_AI_BASE_URL || 'https://api.router.ai').replace(/\/$/, '');

function key(): string {
  const k = process.env.ROUTER_AI_KEY;
  if (!k) throw new Error('ROUTER_AI_KEY not configured');
  return k;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export async function chatCompletions(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  max_tokens?: number;
  temperature?: number;
}): Promise<{
  content: string | null;
  tool_calls?: ToolCall[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key()}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      max_tokens: opts.max_tokens ?? 2000,
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`router.ai chat failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  if (!choice) throw new Error('router.ai returned no choices');
  return {
    content: choice.content ?? null,
    tool_calls: choice.tool_calls,
    usage: data.usage,
  };
}

export async function generateImage(prompt: string, model?: string): Promise<string> {
  const m = model || process.env.DEFAULT_IMAGE_MODEL || 'dola-seedream-5-0-pro-260628';
  const res = await fetch(`${BASE}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key()}`,
    },
    body: JSON.stringify({ model: m, prompt }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`image gen failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const url = data.data?.[0]?.url ?? data.data?.[0]?.b64_json;
  if (!url) throw new Error('image gen returned no url');
  return url;
}

export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
