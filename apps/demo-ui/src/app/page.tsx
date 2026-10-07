'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAllTokens, type TokenSummary } from '../lib/launcher';
import { fetchScore, type RadarScore } from '../lib/radar';
import { fmtMon, fmtTokens, shortAddr } from '../lib/format';
import { ScoreBadge } from '../components/ScoreBadge';
import { explorerAddress } from '../config';

interface Row extends TokenSummary {
  score: RadarScore | null;
  scoreFailed: boolean;
}

export default function Home() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const tokens = await getAllTokens();
        setRows(tokens.map((t) => ({ ...t, score: null, scoreFailed: false })));
        // Score each token; never let Radar downtime break the list.
        await Promise.all(
          tokens.map(async (t, i) => {
            try {
              const s = await fetchScore(t.address);
              setRows((prev) =>
                prev ? prev.map((r, j) => (j === i ? { ...r, score: s } : r)) : prev
              );
            } catch {
              setRows((prev) =>
                prev ? prev.map((r, j) => (j === i ? { ...r, scoreFailed: true } : r)) : prev
              );
            }
          })
        );
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <>
      <section className="hero">
        <h1>
          Launch a meme coin <span className="hl">in one click.</span>
        </h1>
        <p>
          Meme Terminal is a bonding-curve launchpad on Monad — 10,000+ TPS and
          300ms finality make fair, bot-resistant launches possible. Every token
          ships with an AI risk score from <Link href="/radar">Rug Radar</Link>.
        </p>
        <div className="cta-row">
          <Link href="/launch" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            🚀 Launch a token
          </Link>
          <Link href="/radar" className="btn" style={{ textDecoration: 'none', display: 'inline-block' }}>
            🛡 Scan any token
          </Link>
        </div>
      </section>

      <div className="section-head">
        <h2>Launched on Terminal</h2>
        <span className="muted small">{rows === null ? '' : `${rows.length} token${rows.length === 1 ? '' : 's'}`}</span>
      </div>

      {error && <div className="error">{error}</div>}

      {rows === null && !error && (
        <div className="card muted"><span className="spin" />Loading tokens from Monad testnet…</div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="empty">
          <p>No tokens launched yet.</p>
          <Link href="/launch" className="btn btn-primary" style={{ textDecoration: 'none' }}>Be the first 🚀</Link>
        </div>
      )}

      <div className="token-grid">
        {rows?.map((t) => (
          <Link key={t.address} href={`/token/${t.address}`} className="card token-card">
            <div>
              <span className="t-name">{t.name}</span>
              <span className="t-sym">${t.symbol}</span>
            </div>
            <div className="t-addr">
              {shortAddr(t.address)} ·{' '}
              <span
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(explorerAddress(t.address), '_blank');
                }}
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
              >
                explorer
              </span>
            </div>
            <div className="token-stats">
              <div><b>{fmtMon(t.price, 6)}</b><span>MON / token</span></div>
              <div><b>{fmtTokens(t.supply, 0)}</b><span>supply</span></div>
              <div><b>{fmtMon(t.reserve)}</b><span>reserve MON</span></div>
            </div>
            {t.score ? (
              <ScoreBadge score={t.score.score} band={t.score.band} size="sm" />
            ) : (
              <ScoreBadge score={null} band={null} size="sm" />
            )}
          </Link>
        ))}
      </div>
    </>
  );
}
