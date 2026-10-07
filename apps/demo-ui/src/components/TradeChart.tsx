'use client';

import { useMemo } from 'react';
import type { TradePoint } from '../lib/launcher';
import { timeAgo } from '../lib/format';

/** Minimal SVG price chart from per-trade execution prices. */
export function TradeChart({ trades }: { trades: TradePoint[] }) {
  const { points, min, max } = useMemo(() => {
    const ordered = [...trades].reverse(); // oldest -> newest
    const prices = ordered.map((t) => t.priceMon);
    const min = Math.min(...prices, 0);
    const max = Math.max(...prices, 0);
    return { points: ordered, min, max };
  }, [trades]);

  if (points.length === 0) {
    return <div className="card muted">No trades yet — be the first to buy.</div>;
  }

  const W = 560;
  const H = 160;
  const PAD = 8;
  const span = max - min || 1;
  const xy = points.map((t, i) => {
    const x = PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((t.priceMon - min) / span) * (H - PAD * 2);
    return { x, y, t };
  });
  const path = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const last = points[points.length - 1];

  return (
    <div className="card">
      <div className="chart-head">
        <h3>Recent trades</h3>
        <span className="muted small">
          last {last.priceMon.toFixed(6)} MON · {timeAgo(last.timestampMs)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="trade price chart">
        <path d={path} fill="none" stroke="#836EF9" strokeWidth="2" />
        {xy.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3"
            fill={p.t.type === 'buy' ? '#4ade80' : '#f87171'}
          >
            <title>{`${p.t.type} ${p.t.monAmount.toFixed(4)} MON @ ${p.t.priceMon.toFixed(6)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="legend muted small">
        <span><i className="dot dot-buy" /> buy</span>
        <span><i className="dot dot-sell" /> sell</span>
        <span>{points.length} trades · range {min.toFixed(6)}–{max.toFixed(6)} MON</span>
      </div>
    </div>
  );
}
