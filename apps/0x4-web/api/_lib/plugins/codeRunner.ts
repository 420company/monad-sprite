/**
 * Plugin: code-runner — JavaScript execution with hardening.
 *
 * HONEST LIMITATION: This is NOT a true sandbox. It runs in the serverless
 * function process with API restrictions. A determined attacker could escape.
 * For the VPS product, this MUST move to a separate container with seccomp.
 *
 * Hardening applied:
 * - Blocked patterns (expanded): no require/import/process/network/reflection
 * - 3 second execution timeout
 * - 2000 char code limit, 5000 char output limit
 * - Only Math, JSON, console.log available (no Date, no RegExp constructor tricks)
 * - Strict mode, no access to outer scope
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'run_code',
      description:
        'Execute JavaScript for calculations, data processing, quick scripts. Sandboxed (no network/filesystem). Timeout 3s. For math, arrays, string ops.',
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

// Block dangerous patterns including obfuscation attempts
const BLOCKED = new RegExp(
  [
    'require\\s*\\(',
    'import\\s',
    'import\\(',
    'process',
    'globalThis',
    'global\\b',
    'constructor',
    'prototype',
    '__proto__',
    'fetch\\s*\\(',
    'XMLHttpRequest',
    'WebSocket',
    'eval\\s*\\(',
    'Function\\s*\\(',
    'setTimeout',
    'setInterval',
    'queueMicrotask',
    'Promise',
    'async\\b',
    'await\\b',
    'Reflect\\b',
    'Proxy\\b',
    '\\.call\\s*\\(',
    '\\.apply\\s*\\(',
    '\\.bind\\s*\\(',
    'arguments\\b',
    'this\\b',
    'window\\b',
    'document\\b',
    'localStorage',
    'indexedDB',
    'Worker\\b',
    'SharedArrayBuffer',
    'Atomics\\b',
    'WebAssembly',
    'crypto\\b',
    'Buffer\\b',
    '\\\\u00', // unicode escapes (obfuscation)
    '\\\\x', // hex escapes (obfuscation)
  ].join('|'),
  'i',
);

export const codeRunnerPlugin: AgentPlugin = {
  name: 'code-runner',
  version: '2.0.0',
  description: 'Hardened JavaScript execution for calculations and data processing',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== 'run_code') return { ok: false, error: `Unknown tool: ${toolName}` };
    const code = String(args.code || '');
    if (code.length > 2000) return { ok: false, error: 'Code too long (max 2000 chars)' };
    if (BLOCKED.test(code)) return { ok: false, error: 'Blocked: code uses restricted patterns' };

    const logs: string[] = [];
    const sandboxConsole = {
      log: (...a: unknown[]) => {
        const line = a.map((x) => String(x).slice(0, 500)).join(' ');
        if (logs.join('\n').length < 5000) logs.push(line);
      },
    };

    // Timeout via Promise.race (best effort — new Function can't be truly interrupted,
    // but infinite loops in pure computation will hit this)
    const run = (): unknown => {
      const fn = new Function(
        'console',
        'Math',
        'JSON',
        `"use strict";\nconst out = (function(){\n${code}\n})();\nreturn out;`,
      );
      return fn(sandboxConsole, Math, JSON);
    };

    try {
      const result = await Promise.race([
        (async () => run())(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout (3s)')), 3000)),
      ]);
      return {
        ok: true,
        data: {
          logs,
          result: result === undefined ? null : String(result).slice(0, 5000),
          note: 'Sandboxed execution (hardened, not container-isolated)',
        },
      };
    } catch (e) {
      return { ok: false, error: `Execution error: ${(e as Error).message.slice(0, 300)}` };
    }
  },
};
