/**
 * Plugin: media — AI image generation via router.ai.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';
import { generateImage } from '../router.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate an image with AI (Seedream). Use for memes, art, profile pictures — anything visual the user asks for. Returns a URL to the generated image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed image prompt in English for best results' },
        },
        required: ['prompt'],
      },
    },
  },
];

export const mediaPlugin: AgentPlugin = {
  name: 'media',
  version: '1.0.0',
  description: 'AI image generation (Seedream via router.ai)',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== 'generate_image') return { ok: false, error: `Unknown tool: ${toolName}` };
    const url = await generateImage(String(args.prompt));
    return { ok: true, data: { image_url: url, prompt: args.prompt } };
  },
};
