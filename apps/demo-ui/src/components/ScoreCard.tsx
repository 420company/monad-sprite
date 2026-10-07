'use client';

import type { RadarScore } from '../lib/radar';
import { ScoreBadge } from './ScoreBadge';

const SIGNAL_LABELS: Record<string, string> = {
  contract: 'Contract risks',
  liquidity: 'Liquidity',
  holders: 'Holder concentration',
  velocity: 'Launch velocity',
  creator: 'Creator history',
};

export function ScoreCard({ score }: { score: RadarScore }) {
  const entries = Object.entries(score.breakdown).filter(([, v]) => v !== null) as Array<
    [string, number]
  >;
  return (
    <div className="card score-card">
      <div className="score-head">
        <div>
          <div className="score-num">{score.score}<span className="score-denom">/100</span></div>
          <div className="muted small">Rug Radar · {score.checksPassed}/{score.checksTotal} checks passed</div>
        </div>
        <ScoreBadge score={score.score} band={score.band} />
      </div>

      {score.flags.length > 0 && (
        <div className="flags">
          {score.flags.map((f) => (
            <span key={f} className="flag">{f}</span>
          ))}
        </div>
      )}

      <div className="breakdown">
        {entries.map(([key, val]) => (
          <div key={key} className="bar-row">
            <span className="bar-label">{SIGNAL_LABELS[key] ?? key}</span>
            <div className="bar-track">
              <div
                className={`bar-fill ${val >= 80 ? 'bar-low' : val >= 50 ? 'bar-medium' : 'bar-high'}`}
                style={{ width: `${val}%` }}
              />
            </div>
            <span className="bar-val">{val}</span>
          </div>
        ))}
      </div>

      <p className="verdict">{score.verdict}</p>
      <div className="muted small">scanned {new Date(score.scannedAt).toLocaleString()} · chain {score.chainId}</div>
    </div>
  );
}
