/**
 * Plugin: web — web search and page fetching.
 *
 * Search: Tavily API if TAVILY_API_KEY is set, otherwise DuckDuckGo instant answers.
 * Fetch: plain HTTP GET with text extraction (no JS rendering — for JS-heavy pages
 * the agent should tell the user it can't render them).
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current information: news, prices, documentation, facts. Returns titles, URLs and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Max results (default 5, max 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description:
        'Fetch a web page and extract its text content. Use after web_search to read a specific result.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to fetch (must start with https://)' },
          max_chars: { type: 'number', description: 'Max characters to return (default 8000)' },
        },
        required: ['url'],
      },
    },
  },
];

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function tavilySearch(query: string, count: number): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY!;
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: count,
      search_depth: 'basic',
      include_answer: false,
    }),
  });
  if (!r.ok) throw new Error(`Tavily: ${r.status}`);
  const data = await r.json();
  return (data.results || []).map((x: { title: string; url: string; content: string }) => ({
    title: x.title || '',
    url: x.url || '',
    snippet: (x.content || '').slice(0, 300),
  }));
}

async function ddgSearch(query: string): Promise<SearchResult[]> {
  // DuckDuckGo instant answers — free, no key, limited results
  const r = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  );
  if (!r.ok) throw new Error(`DDG: ${r.status}`);
  const data = await r.json();
  const out: SearchResult[] = [];
  if (data.AbstractText) {
    out.push({
      title: data.Heading || query,
      url: data.AbstractURL || '',
      snippet: data.AbstractText.slice(0, 300),
    });
  }
  for (const t of data.RelatedTopics || []) {
    if (t.Text && t.FirstURL && out.length < 5) {
      out.push({ title: t.Text.split(' - ')[0] || '', url: t.FirstURL, snippet: t.Text.slice(0, 300) });
    }
  }
  return out;
}

function extractText(html: string): string {
  return (
    html
      // remove scripts, styles, nav, footer
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      // extract text from common content tags, fallback to all tags stripped
      .replace(/<\/(p|div|h1|h2|h3|h4|li|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim()
  );
}

export const webPlugin: AgentPlugin = {
  name: 'web',
  version: '1.0.0',
  description: 'Web search and page fetching for current information',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName === 'web_search') {
      const query = String(args.query || '').trim();
      if (!query) return { ok: false, error: 'Empty query' };
      const count = Math.min(Number(args.count) || 5, 10);
      try {
        const results = process.env.TAVILY_API_KEY
          ? await tavilySearch(query, count)
          : await ddgSearch(query);
        if (results.length === 0) {
          return {
            ok: true,
            data: {
              results: [],
              note: 'No results. Tip: set TAVILY_API_KEY env var for better search quality.',
            },
          };
        }
        return { ok: true, data: { results: results.slice(0, count) } };
      } catch (e) {
        return { ok: false, error: `Search failed: ${e instanceof Error ? e.message : 'unknown'}` };
      }
    }

    if (toolName === 'web_fetch') {
      const url = String(args.url || '').trim();
      if (!/^https:\/\//i.test(url)) return { ok: false, error: 'URL must start with https://' };
      const maxChars = Math.min(Number(args.max_chars) || 8000, 20000);
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SpriteAgent/1.0)',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        clearTimeout(timer);
        if (!r.ok) return { ok: false, error: `Fetch failed: HTTP ${r.status}` };
        const ct = r.headers.get('content-type') || '';
        if (!/text|html/i.test(ct)) return { ok: false, error: `Not a text page (${ct})` };
        const html = await r.text();
        const text = extractText(html).slice(0, maxChars);
        return { ok: true, data: { url, text, truncated: text.length >= maxChars } };
      } catch (e) {
        return { ok: false, error: `Fetch failed: ${e instanceof Error ? e.message : 'unknown'}` };
      }
    }

    return { ok: false, error: `Unknown tool: ${toolName}` };
  },
};
