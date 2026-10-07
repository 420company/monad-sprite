/**
 * Plugin: research — deep research mode.
 *
 * Orchestrates multi-step research: breaks a question into sub-queries,
 * searches + fetches in parallel, then synthesizes a report with sources.
 * This runs server-side (not via LLM tool loops) for speed and reliability.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';
import { chatCompletions, DEFAULT_MODEL } from '../router.js';
import { getConfig } from '../config.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'deep_research',
      description:
        'Research a topic thoroughly: searches multiple angles, reads key sources, and returns a structured report with citations. Use for "research X", "what is the latest on Y", "compare A vs B". Takes 30-90 seconds.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Research topic or question' },
          depth: {
            type: 'string',
            enum: ['quick', 'standard', 'deep'],
            description: 'quick=3 searches, standard=5, deep=8 (default standard)',
          },
        },
        required: ['topic'],
      },
    },
  },
];

interface Source {
  title: string;
  url: string;
  snippet: string;
  text?: string;
}

async function search(query: string, count: number): Promise<Source[]> {
  // Use Tavily if available, else DuckDuckGo
  if (process.env.TAVILY_API_KEY) {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: count,
        search_depth: 'advanced',
        include_answer: false,
      }),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results || []).map((x: { title: string; url: string; content: string }) => ({
      title: x.title || '',
      url: x.url || '',
      snippet: (x.content || '').slice(0, 500),
    }));
  }
  // DuckDuckGo fallback
  const r = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  );
  if (!r.ok) return [];
  const data = await r.json();
  const out: Source[] = [];
  if (data.AbstractText) {
    out.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText.slice(0, 500) });
  }
  for (const t of data.RelatedTopics || []) {
    if (t.Text && t.FirstURL && out.length < count) {
      out.push({ title: t.Text.split(' - ')[0], url: t.FirstURL, snippet: t.Text.slice(0, 500) });
    }
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpriteAgent/1.0)' },
    });
    clearTimeout(timer);
    if (!r.ok) return '';
    const html = await r.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|h1|h2|h3|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
  } catch {
    return '';
  }
}

export const researchPlugin: AgentPlugin = {
  name: 'research',
  version: '1.0.0',
  description: 'Deep research: multi-angle search + source reading + synthesized report',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== 'deep_research') return { ok: false, error: `Unknown tool: ${toolName}` };

    const topic = String(args.topic || '').trim().slice(0, 500);
    if (!topic) return { ok: false, error: 'Topic required' };
    const depth = String(args.depth || 'standard');
    const numQueries = depth === 'quick' ? 3 : depth === 'deep' ? 8 : 5;

    // Step 1: Generate sub-queries via LLM
    const model = getConfig().defaultChatModel || DEFAULT_MODEL;
    let queries: string[] = [topic];
    try {
      const qOut = await chatCompletions({
        model,
        messages: [
          {
            role: 'user',
            content: `Break this research topic into ${numQueries} specific search queries (one per line, no numbering):\n\n${topic}`,
          },
        ],
      });
      const lines = (qOut.content || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, numQueries);
      if (lines.length >= 2) queries = lines;
    } catch {
      /* fall back to single query */
    }

    // Step 2: Search all queries in parallel
    const searchResults = await Promise.all(queries.map((q) => search(q, 4)));
    const allSources = searchResults.flat();

    // Dedupe by URL
    const seen = new Set<string>();
    const sources = allSources.filter((s) => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    }).slice(0, 12);

    // Step 3: Fetch top sources in parallel
    const texts = await Promise.all(sources.slice(0, 6).map((s) => fetchText(s.url)));
    sources.forEach((s, i) => {
      if (i < texts.length && texts[i]) s.text = texts[i];
    });

    // Step 4: Synthesize report
    const sourceBlock = sources
      .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.text || s.snippet}`)
      .join('\n\n');

    let report = '';
    try {
      const rOut = await chatCompletions({
        model,
        messages: [
          {
            role: 'user',
            content: `Write a thorough research report on: ${topic}\n\nUse these sources:\n\n${sourceBlock.slice(0, 20000)}\n\nFormat:\n## Summary\n(2-3 sentences)\n\n## Key Findings\n(bullet points with [n] citations)\n\n## Details\n(organized sections)\n\n## Sources\n(numbered list with URLs)\n\nBe factual, cite sources, note uncertainties.`,
          },
        ],
      });
      report = rOut.content || '';
    } catch (e) {
      return { ok: false, error: `Synthesis failed: ${e instanceof Error ? e.message : 'unknown'}` };
    }

    return {
      ok: true,
      data: {
        topic,
        report,
        sources: sources.map((s, i) => ({ n: i + 1, title: s.title, url: s.url })),
        queries_used: queries,
      },
    };
  },
};
