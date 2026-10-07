/**
 * Plugin: files — generate downloadable files.
 *
 * The agent can create text files (markdown, code, CSV, etc.) that the user
 * can download. Files are returned as data URLs (base64) for small files.
 * For hackathon scope: in-memory, no persistence.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description:
        'Create a downloadable text file (markdown, code, CSV, JSON, etc.). Returns a download link. Use when the user asks for a document, report, code file, or data export.',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Filename with extension, e.g. "report.md", "script.py", "data.csv"',
          },
          content: { type: 'string', description: 'Full file content (max 100KB)' },
          mime: {
            type: 'string',
            description: 'MIME type, e.g. "text/markdown", "text/plain", "application/json"',
          },
        },
        required: ['filename', 'content'],
      },
    },
  },
];

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    md: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    csv: 'text/csv',
    html: 'text/html',
    js: 'text/javascript',
    ts: 'text/typescript',
    py: 'text/x-python',
    sql: 'application/sql',
    xml: 'application/xml',
    yaml: 'text/yaml',
    yml: 'text/yaml',
  };
  return map[ext || ''] || 'text/plain';
}

export const filesPlugin: AgentPlugin = {
  name: 'files',
  version: '1.0.0',
  description: 'Create downloadable text files (documents, code, data)',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== 'create_file') return { ok: false, error: `Unknown tool: ${toolName}` };

    const filename = String(args.filename || 'file.txt').slice(0, 100);
    const content = String(args.content || '').slice(0, 100 * 1024);
    if (!content) return { ok: false, error: 'Empty content' };

    const mime = String(args.mime || '') || mimeFor(filename);
    const base64 = Buffer.from(content, 'utf-8').toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    return {
      ok: true,
      data: {
        file_url: dataUrl,
        filename,
        mime,
        size_bytes: Buffer.byteLength(content, 'utf-8'),
      },
    };
  },
};
