/**
 * Centralized agent configuration — models, pricing, feature flags.
 *
 * Defaults come from env vars; admin can override at runtime via /api/admin/config.
 * In-memory on serverless (resets on cold start — use Vercel KV for production).
 */

export interface AgentConfig {
  /** Default chat model for the agent */
  defaultChatModel: string;
  /** Default image generation model */
  defaultImageModel: string;
  /** Default video generation model */
  defaultVideoModel: string;
  /** Default TTS model + voice */
  defaultTtsModel: string;
  defaultTtsVoice: string;
  /** Markup multiplier over upstream cost (e.g. 1.5 = 50% margin) */
  priceMarkup: number;
  /** Models hidden from the user-facing picker (comma-separated ids) */
  hiddenModels: string[];
}

const DEFAULTS: AgentConfig = {
  defaultChatModel: process.env.DEFAULT_CHAT_MODEL || 'deepseek-v4-flash',
  defaultImageModel: process.env.DEFAULT_IMAGE_MODEL || 'dola-seedream-5-0-pro-260628',
  defaultVideoModel: process.env.DEFAULT_VIDEO_MODEL || 'wan3.0-video',
  defaultTtsModel: process.env.DEFAULT_TTS_MODEL || 'qwen3-tts-flash',
  defaultTtsVoice: process.env.DEFAULT_TTS_VOICE || 'Cherry',
  priceMarkup: parseFloat(process.env.PRICE_MARKUP || '1.5'),
  hiddenModels: (process.env.HIDDEN_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

// Runtime overrides (set via admin API)
let overrides: Partial<AgentConfig> = {};

export function getConfig(): AgentConfig {
  return { ...DEFAULTS, ...overrides };
}

export function updateConfig(patch: Partial<AgentConfig>): AgentConfig {
  // Validate model ids are non-empty strings
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') {
      throw new Error(`Config ${k} cannot be empty`);
    }
  }
  if (patch.priceMarkup !== undefined) {
    const m = Number(patch.priceMarkup);
    if (!isFinite(m) || m < 1 || m > 100) throw new Error('priceMarkup must be between 1 and 100');
    patch.priceMarkup = m;
  }
  overrides = { ...overrides, ...patch };
  return getConfig();
}

export function resetConfig(): AgentConfig {
  overrides = {};
  return getConfig();
}
