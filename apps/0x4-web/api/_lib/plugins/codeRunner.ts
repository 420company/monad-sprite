/**
 * Plugin: code-runner — sandboxed JavaScript execution.
 * No network, no filesystem, no process access. 2000 char limit.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'run_code',
      description:
        'Execute JavaScript code in a sandbox and return stdout/result. For calculations, data processing, quick scripts. No network, no filesystem. Timeout 5s.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript code. Use console.log or a final expression for output.' },
        },
        required: ['code'],
      },
    },
  },
];

const BLOCKED = /require\s*\(|import\s|process|globalThis|constructor|prototype|__proto__|fetch\s*\(|XMLHttpRequest/;

export const codeRunnerPlugin: AgentPlugin = {
  name: 'code-runner',
  version: '1.0.0',
  description: 'Sandboxed JavaScript execution for calculations and data processing',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== 'run_code') return { ok: false, error: `Unknown tool: ${toolName}` };
    const code = String(args.code);
    if (code.length > 2000) return { ok: false, error: 'Code too long (max 2000 chars)' };
    if (BLOCKED.test(code)) return { ok: false, error: 'Blocked: code uses restricted APIs' };
    const logs: string[] = [];
    const sandboxConsole = { log: (...a: unknown[]) => logs.push(a.map(String).join(' ')) };
    try {
      const fn = new Function(
        'console',
        'Math',
        'JSON',
        `"use strict"; const out = (function(){ ${code} })(); return out;`,
      );
      const result = fn(sandboxConsole, Math, JSON);
      return {
        ok: true,
        data: { logs, result: result === undefined ? null : String(result).slice(0, 2000) },
      };
    } catch (e) {
      return { ok: false, error: `Execution error: ${(e as Error).message.slice(0, 300)}` };
    }
  },
};
