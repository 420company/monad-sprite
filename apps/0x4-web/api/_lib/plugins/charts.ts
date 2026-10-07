/**
 * Plugin: charts — generate SVG charts from data.
 * Returns inline SVG that renders directly in chat.
 * Types: bar, line, pie.
 */
import type { AgentPlugin, ToolResult } from '../plugin.js';
import type { ToolDef } from '../router.js';

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'create_chart',
      description:
        'Create a chart from data. Returns SVG that displays inline. Use when the user asks for a visualization, chart, or graph.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['bar', 'line', 'pie'],
            description: 'Chart type',
          },
          title: { type: 'string', description: 'Chart title' },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'X-axis labels or pie slice names',
          },
          values: {
            type: 'array',
            items: { type: 'number' },
            description: 'Data values (same length as labels)',
          },
        },
        required: ['type', 'labels', 'values'],
      },
    },
  },
];

const COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#84cc16'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function barChart(title: string, labels: string[], values: number[]): string {
  const W = 480, H = 320, padL = 50, padB = 50, padT = 40, padR = 20;
  const cw = W - padL - padR, ch = H - padT - padB;
  const max = Math.max(...values, 1);
  const bw = cw / values.length;
  const bars = values.map((v, i) => {
    const h = (v / max) * ch;
    const x = padL + i * bw + bw * 0.15;
    const y = padT + ch - h;
    const c = COLORS[i % COLORS.length];
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${c}"/>
      <text x="${(x + bw * 0.35).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="#888">${v}</text>
      <text x="${(x + bw * 0.35).toFixed(1)}" y="${(padT + ch + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#888">${esc(labels[i] || '').slice(0, 12)}</text>`;
  }).join('\n');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;background:#1a1a2e;border-radius:12px">
    <text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="bold" fill="#fff">${esc(title)}</text>
    ${bars}
    <line x1="${padL}" y1="${padT + ch}" x2="${W - padR}" y2="${padT + ch}" stroke="#444" />
  </svg>`;
}

function lineChart(title: string, labels: string[], values: number[]): string {
  const W = 480, H = 320, padL = 50, padB = 50, padT = 40, padR = 20;
  const cw = W - padL - padR, ch = H - padT - padB;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const range = max - min || 1;
  const px = (i: number) => padL + (i / Math.max(values.length - 1, 1)) * cw;
  const py = (v: number) => padT + ch - ((v - min) / range) * ch;
  const pts = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const dots = values.map((v, i) =>
    `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="4" fill="#8b5cf6"/>
     <text x="${px(i).toFixed(1)}" y="${(padT + ch + 18).toFixed(1)}" text-anchor="middle" font-size="10" fill="#888">${esc(labels[i] || '').slice(0, 10)}</text>`
  ).join('\n');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;background:#1a1a2e;border-radius:12px">
    <text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="bold" fill="#fff">${esc(title)}</text>
    <polyline points="${pts}" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}
  </svg>`;
}

function pieChart(title: string, labels: string[], values: number[]): string {
  const W = 480, H = 320;
  const cx = 160, cy = 170, r = 110;
  const total = values.reduce((a, b) => a + b, 0) || 1;
  let angle = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const a1 = angle, a2 = angle + (v / total) * Math.PI * 2;
    angle = a2;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const large = a2 - a1 > Math.PI ? 1 : 0;
    const c = COLORS[i % COLORS.length];
    return `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${c}" stroke="#1a1a2e" stroke-width="2"/>`;
  }).join('\n');
  const legend = labels.map((l, i) => {
    const pct = ((values[i] / total) * 100).toFixed(1);
    return `<rect x="300" y="${120 + i * 26}" width="14" height="14" rx="3" fill="${COLORS[i % COLORS.length]}"/>
      <text x="320" y="${132 + i * 26}" font-size="12" fill="#ccc">${esc(l).slice(0, 18)} (${pct}%)</text>`;
  }).join('\n');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;background:#1a1a2e;border-radius:12px">
    <text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="bold" fill="#fff">${esc(title)}</text>
    ${slices}${legend}
  </svg>`;
}

export const chartsPlugin: AgentPlugin = {
  name: 'charts',
  version: '1.0.0',
  description: 'Generate SVG charts (bar, line, pie) from data',
  tools,

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName !== 'create_chart') return { ok: false, error: `Unknown tool: ${toolName}` };

    const type = String(args.type || 'bar');
    const title = String(args.title || 'Chart').slice(0, 100);
    const labels = (Array.isArray(args.labels) ? args.labels : []).map((x) => String(x).slice(0, 30));
    const values = (Array.isArray(args.values) ? args.values : []).map((x) => Number(x) || 0);

    if (labels.length === 0 || values.length === 0) {
      return { ok: false, error: 'labels and values required (non-empty arrays)' };
    }
    if (labels.length !== values.length) {
      return { ok: false, error: 'labels and values must be same length' };
    }
    if (labels.length > 20) {
      return { ok: false, error: 'Max 20 data points' };
    }

    let svg = '';
    if (type === 'bar') svg = barChart(title, labels, values);
    else if (type === 'line') svg = lineChart(title, labels, values);
    else if (type === 'pie') svg = pieChart(title, labels, values);
    else return { ok: false, error: 'type must be bar, line, or pie' };

    return { ok: true, data: { chart_svg: svg, type, title } };
  },
};
