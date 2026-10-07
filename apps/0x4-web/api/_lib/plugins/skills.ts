/**
 * Plugin: skills — reusable agent workflows.
 *
 * A skill is a named multi-step workflow the agent can invoke as one tool.
 * Skills orchestrate other plugins server-side for reliability.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';
import type { PluginContext } from '../plugin.js';
import { registry } from '../plugin.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List available skills (reusable workflows).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_skill',
      description:
        'Run a skill by name. Skills are multi-step workflows: token-analysis, meme-creator, portfolio-report.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'Skill name' },
          input: { type: 'string', description: 'Input for the skill (e.g. token symbol)' },
        },
        required: ['skill'],
      },
    },
  },
];

const SKILLS: Record<string, { description: string; usage: string }> = {
  'token-analysis': {
    description: 'Full memecoin analysis: price, stats, recent context',
    usage: 'run_skill(skill="token-analysis", input="SPRITE")',
  },
  'meme-creator': {
    description: 'Create a funny meme: generates image + witty caption',
    usage: 'run_skill(skill="meme-creator", input="cyberpunk cat")',
  },
  'portfolio-report': {
    description: 'Portfolio summary with holdings chart',
    usage: 'run_skill(skill="portfolio-report", input="")',
  },
};

export const skillsPlugin: AgentPlugin = {
  name: 'skills',
  version: '1.0.0',
  description: 'Reusable workflows: token-analysis, meme-creator, portfolio-report',
  tools,

  async execute(toolName: string, args: Record<string, unknown>, ctx?: PluginContext): Promise<ToolResult> {
    if (toolName === 'list_skills') {
      return { ok: true, data: { skills: SKILLS } };
    }

    if (toolName !== 'run_skill') return { ok: false, error: `Unknown tool: ${toolName}` };

    const skill = String(args.skill || '').toLowerCase().trim();
    const input = String(args.input || '').trim();

    if (skill === 'token-analysis') {
      if (!input) return { ok: false, error: 'Token symbol required' };
      // Step 1: get price
      const priceR = await registry.execute('get_token_price', { query: input }, ctx);
      if (!priceR.ok) return priceR;
      const info = priceR.data as Record<string, unknown>;
      // Step 2: web search for context
      const searchR = await registry.execute('web_search', { query: `${input} memecoin news`, count: 3 }, ctx);
      const context = searchR.ok ? (searchR.data as { results: Array<{ title: string }> }).results.map((r) => r.title) : [];
      return {
        ok: true,
        data: {
          skill: 'token-analysis',
          token: info,
          recent_context: context,
          summary: `${info.symbol} at ${info.price_note}. Reserve: ${info.reserve_mon} MON.`,
        },
      };
    }

    if (skill === 'meme-creator') {
      const theme = input || 'crypto cat';
      const imgR = await registry.execute(
        'generate_image',
        { prompt: `Funny meme image, ${theme}, high quality, humorous, no text watermark` },
        ctx,
      );
      if (!imgR.ok) return imgR;
      const captions = [
        `When ${theme} moons 🚀`,
        `POV: you bought ${theme} at the top`,
        `${theme}: trust the process`,
      ];
      return {
        ok: true,
        data: {
          skill: 'meme-creator',
          ...(imgR.data as object),
          caption_ideas: captions,
        },
      };
    }

    if (skill === 'portfolio-report') {
      const wallet = ctx?.wallet;
      if (!wallet) return { ok: false, error: 'Wallet required' };
      const pfR = await registry.execute('get_portfolio', { wallet }, ctx);
      if (!pfR.ok) return pfR;
      const pf = pfR.data as { mon_balance: string; holdings: Array<{ symbol: string; balance: string }> };
      // Build chart if there are holdings
      let chart = null;
      if (pf.holdings.length > 0) {
        const chartR = await registry.execute(
          'create_chart',
          {
            type: 'pie',
            title: 'Portfolio Holdings',
            labels: pf.holdings.map((h) => h.symbol),
            values: pf.holdings.map((h) => parseFloat(h.balance) || 0),
          },
          ctx,
        );
        if (chartR.ok) chart = (chartR.data as { chart_svg: string }).chart_svg;
      }
      return {
        ok: true,
        data: {
          skill: 'portfolio-report',
          mon_balance: pf.mon_balance,
          holdings: pf.holdings,
          chart_svg: chart,
        },
      };
    }

    return { ok: false, error: `Unknown skill: ${skill}. Available: ${Object.keys(SKILLS).join(', ')}` };
  },
};
