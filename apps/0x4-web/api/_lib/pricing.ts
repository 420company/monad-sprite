/**
 * Model pricing database: luna.gift cost vs official retail price.
 * Used by admin UI to show markup headroom, and by billing to compute costs.
 *
 * Prices are per 1M tokens (in/out) unless noted as per-image (/img) or per-second (/s).
 * Sources: luna.gift/models page (2026-10-07) + official provider pricing pages.
 */

export interface ModelPrice {
  /** luna.gift cost — what we pay */
  costIn: number;
  costOut: number;
  /** official retail price — what users would pay going direct */
  officialIn?: number;
  officialOut?: number;
  unit: '1M' | 'img' | 's';
  /** short note e.g. "35% off official" */
  note?: string;
}

const P: Record<string, ModelPrice> = {
  // ---- Claude ----
  'claude-sonnet-4-5-20250929': { costIn: 2.7, costOut: 13.5, officialIn: 3, officialOut: 15, unit: '1M', note: '10% off' },
  'claude-sonnet-5': { costIn: 1.8, costOut: 9, officialIn: 2, officialOut: 10, unit: '1M', note: '10% off' },
  'claude-sonnet-5-5': { costIn: 1.8, costOut: 9, officialIn: 2, officialOut: 10, unit: '1M', note: '10% off' },
  'claude-haiku-4-5-20251001': { costIn: 0.9, costOut: 4.5, officialIn: 1, officialOut: 5, unit: '1M', note: '10% off' },
  'claude-opus-4-5': { costIn: 5, costOut: 25, officialIn: 5, officialOut: 25, unit: '1M', note: '原价' },
  'claude-opus-5-5': { costIn: 4, costOut: 20, officialIn: 4, officialOut: 20, unit: '1M', note: '原价' },

  // ---- OpenAI ----
  'gpt-5.4': { costIn: 1.625, costOut: 9.75, officialIn: 2.5, officialOut: 15, unit: '1M', note: '35% off' },
  'gpt-5.6-sol': { costIn: 2.6, costOut: 13, officialIn: 4, officialOut: 20, unit: '1M', note: '35% off' },
  'gpt-5.6-luna': { costIn: 0.13, costOut: 0.78, officialIn: 0.2, officialOut: 1.2, unit: '1M', note: '35% off' },
  'gpt-6-sol': { costIn: 1.3, costOut: 6.5, officialIn: 2, officialOut: 10, unit: '1M', note: '35% off' },
  'gpt-6-luna': { costIn: 0.065, costOut: 0.325, officialIn: 0.1, officialOut: 0.5, unit: '1M', note: '35% off' },

  // ---- Google ----
  'gemini-3.8-flash': { costIn: 0.5625, costOut: 2.8125, officialIn: 0.75, officialOut: 3.75, unit: '1M', note: '25% off' },
  'gemini-2.5-flash-lite': { costIn: 0.075, costOut: 0.3, officialIn: 0.1, officialOut: 0.4, unit: '1M', note: '25% off' },

  // ---- DeepSeek ----
  'deepseek-v4-flash': { costIn: 0.063, costOut: 0.126, officialIn: 0.44, officialOut: 1.32, unit: '1M', note: '86-90% off' },
  'deepseek-v4-pro': { costIn: 0.783, costOut: 1.566, officialIn: 1.32, officialOut: 3.96, unit: '1M', note: '41-60% off' },
  'deepseek-v3.2': { costIn: 0.399, costOut: 1.197, unit: '1M' },

  // ---- xAI ----
  'grok-4.6': { costIn: 2, costOut: 6, officialIn: 2, officialOut: 6, unit: '1M', note: '原价' },

  // ---- Alibaba ----
  'qwen-flash': { costIn: 0.035, costOut: 0.28, officialIn: 0.05, officialOut: 0.4, unit: '1M', note: '30% off' },
  'qwen3.7-flash': { costIn: 0.021, costOut: 0.091, officialIn: 0.15, officialOut: 0.47, unit: '1M', note: '~85% off' },

  // ---- Moonshot ----
  'kimi-k3': { costIn: 1.65, costOut: 8.25, officialIn: 3, officialOut: 15, unit: '1M', note: '45% off' },

  // ---- Zhipu ----
  'glm-5.3': { costIn: 0.63, costOut: 1.98, officialIn: 1.4, officialOut: 4.4, unit: '1M', note: '55% off' },

  // ---- Image models ----
  'dola-seedream-5-0-pro-260628': { costIn: 0.036, costOut: 0.036, officialIn: 0.045, officialOut: 0.045, unit: 'img', note: '20% off' },
  'seedream-4-0-250828': { costIn: 0.024, costOut: 0.024, officialIn: 0.03, officialOut: 0.03, unit: 'img', note: '20% off' },
  'seedream-4-5-251128': { costIn: 0.032, costOut: 0.032, officialIn: 0.04, officialOut: 0.04, unit: 'img', note: '20% off' },
  'seedream-5-0-lite-260128': { costIn: 0.028, costOut: 0.028, officialIn: 0.035, officialOut: 0.035, unit: 'img', note: '20% off' },
  'qwen-image': { costIn: 0.0245, costOut: 0.0245, unit: 'img', note: '持平' },
  'qwen-image-2.0': { costIn: 0.0245, costOut: 0.0245, unit: 'img', note: '持平' },
  'qwen-image-2.0-pro': { costIn: 0.0525, costOut: 0.0525, unit: 'img', note: '持平' },
  'qwen-image-plus': { costIn: 0.021, costOut: 0.021, unit: 'img', note: '持平' },
  'grok-imagine-image': { costIn: 0.02, costOut: 0.02, officialIn: 0.02, officialOut: 0.02, unit: 'img', note: '原价' },
  'gemini-2.5-flash-image': { costIn: 0.02925, costOut: 0.02925, officialIn: 0.04, officialOut: 0.04, unit: 'img', note: '~27% off' },

  // ---- Video models ----
  'wan3.0-video': { costIn: 0.025, costOut: 0.025, officialIn: 0.05, officialOut: 0.05, unit: 's', note: '50% off' },
  'wan3.0-video-prime': { costIn: 0.0408, costOut: 0.0408, officialIn: 0.05, officialOut: 0.05, unit: 's', note: '18% off' },
  'dreamina-seedance-2-0-mini-260615': { costIn: 0.034, costOut: 0.034, officialIn: 0.034, officialOut: 0.034, unit: 's', note: '持平' },
  'dreamina-seedance-2-0-260128': { costIn: 0.067, costOut: 0.067, officialIn: 0.067, officialOut: 0.067, unit: 's', note: '持平' },
  'dreamina-seedance-2.5': { costIn: 0.1, costOut: 0.1, officialIn: 0.1, officialOut: 0.1, unit: 's', note: '持平' },
  'wan2.6-i2v-flash': { costIn: 0.035, costOut: 0.035, unit: 's' },
  'grok-imagine-video': { costIn: 0.05, costOut: 0.05, officialIn: 0.05, officialOut: 0.05, unit: 's', note: '原价' },
  'happyhorse-1.1-t2v': { costIn: 0.098, costOut: 0.098, unit: 's' },

  // ---- TTS ----
  'qwen3-tts-flash': { costIn: 0.5, costOut: 0.5, unit: '1M', note: 'chars' },
};

export function getPrice(modelId: string): ModelPrice | undefined {
  return P[modelId];
}

/** Format: "$0.063/$0.126 per 1M" or "$0.036/张" */
export function formatPrice(p: ModelPrice): string {
  const unit = p.unit === 'img' ? '/张' : p.unit === 's' ? '/秒' : '/1M';
  if (p.costIn === p.costOut) return `$${p.costIn}${unit}`;
  return `$${p.costIn}/$${p.costOut}${unit}`;
}

/** Discount % vs official (input price). Null if no official price. */
export function discountPct(p: ModelPrice): number | null {
  if (!p.officialIn || p.officialIn <= 0) return null;
  return Math.round((1 - p.costIn / p.officialIn) * 100);
}
