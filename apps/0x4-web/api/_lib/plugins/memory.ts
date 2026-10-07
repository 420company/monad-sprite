/**
 * Plugin: memory — the agent remembers the user across sessions.
 * save_memory stores a fact, recall_memory retrieves it.
 * The wallet address identifies the user.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';
import { saveMemory, recallMemory, deleteMemory } from '../memory.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Remember something about the user for future conversations: their name, preferences, goals, past decisions. Use proactively when the user shares durable info.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short label, e.g. "name", "favorite_token", "risk_tolerance"' },
          value: { type: 'string', description: 'What to remember' },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: 'Recall what you remember about the user. Optionally filter by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword to search memories (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget_memory',
      description: 'Delete a specific memory about the user.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key to delete' },
        },
        required: ['key'],
      },
    },
  },
];

export const memoryPlugin: AgentPlugin = {
  name: 'memory',
  version: '1.0.0',
  description: 'Long-term memory: remember the user across sessions',
  tools,

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx?: { wallet?: string },
  ): Promise<ToolResult> {
    const wallet = ctx?.wallet;
    if (!wallet) return { ok: false, error: 'No wallet connected — memory needs a wallet identity' };

    if (toolName === 'save_memory') {
      const key = String(args.key || '').trim();
      const value = String(args.value || '').trim();
      if (!key || !value) return { ok: false, error: 'key and value required' };
      saveMemory(wallet, key, value);
      return { ok: true, data: { saved: key } };
    }
    if (toolName === 'recall_memory') {
      const entries = recallMemory(wallet, String(args.query || ''));
      return { ok: true, data: { memories: entries } };
    }
    if (toolName === 'forget_memory') {
      const ok = deleteMemory(wallet, String(args.key || ''));
      return { ok: true, data: { deleted: ok } };
    }
    return { ok: false, error: `Unknown tool: ${toolName}` };
  },
};
