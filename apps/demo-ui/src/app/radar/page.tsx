'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { isAddress } from 'viem';
import { fetchScore, fetchRecentScores, radarHealthy, type RadarScore } from '../../lib/radar';
import { ScoreCard } from '../../components/ScoreCard';
import { ScoreBadge } from '../../components/ScoreBadge';
import { shortAddr, timeAgo } from '../../lib/format';

export default function RadarPage() {
  const [input, setInput] = useState('');
  const [score, setScore] = useState<RadarScore | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'offline' | 'error'>('idle');
  const [recent, setRecent] = useState<RadarScore[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    radarHealthy().then((ok) => {
      setOnline(ok);
      if (ok) fetchRecentScores().then(setRecent).catch(() => {});
    });
  }, []);

  const scan = async () => {
    if (!isAddress(input)) {
      setState('error');
      return;
    }
    setState('loading');
    setScore(null);
    try {
      const s = await fetchScore(input);
      setScore(s);
      setState('ok');
      setRecent((r) => [s, ...r.filter((x) => x.tokenAddress.toLowerCase() !== s.tokenAddress.toLowerCase())].slice(0, 20));
    } catch {
      setState('error');
    }
  };

  return (
    <>
      <section className="hero">
        <h1>🛡 Rug Radar</h1>
        <p>
          AI risk scoring for every new meme launch on Monad. Paste any token
          address — contract risks, liquidity, holder concentration, launch
          velocity and creator history, scored 0–100 in seconds.
        </p>
        {online === false && (
          <div className="card muted" style={{ marginTop: 16 }}>
            Radar API offline — start it with <code>npm run dev</code> in <code>../radar</code>,
            or set <code>NEXT_PUBLIC_RADAR_API_URL</code>.
          </div>
        )}
      </section>

      <div className="scan-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.trim())}
          placeholder="0x… token address"
          spellCheck={false}
        />
        <button className="btn btn-primary" disabled={state === 'loading' || !input} onClick={scan}>
          {state === 'loading' ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {state === 'loading' && <div className="card muted"><span className="spin" />Running 9 on-chain checks…</div>}
      {state === 'error' && !score && <div className="error">Enter a valid 0x address, or check the Radar API is running.</div>}
      {state === 'ok' && score && <ScoreCard score={score} />}

      {recent.length > 0 && (
        <>
          <div className="section-head"><h2>Recent scans</h2></div>
          <div className="recent-list">
            {recent.map((r) => (
              <div key={r.tokenAddress + r.scannedAt} className="recent-item">
                <span>
                  <Link href={`/token/${r.tokenAddress}`}><code>{shortAddr(r.tokenAddress)}</code></Link>
                  <span className="muted small" style={{ marginLeft: 10 }}>{timeAgo(new Date(r.scannedAt).getTime())}</span>
                </span>
                <ScoreBadge score={r.score} band={r.band} size="sm" />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
