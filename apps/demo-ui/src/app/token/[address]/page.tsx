'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { isAddress, type Address } from 'viem';
import { getTokenInfo, getRecentTrades, type TokenSummary, type TradePoint } from '../../../lib/launcher';
import { fetchScore, radarHealthy, type RadarScore } from '../../../lib/radar';
import { fmtMon, fmtTokens, shortAddr } from '../../../lib/format';
import { explorerAddress } from '../../../config';
import { ScoreCard } from '../../../components/ScoreCard';
import { BuySellPanel } from '../../../components/BuySellPanel';
import { TradeChart } from '../../../components/TradeChart';

export default function TokenPage() {
  const params = useParams();
  const raw = Array.isArray(params.address) ? params.address[0] : (params.address as string);
  const valid = isAddress(raw || '');
  const token = (valid ? raw : '0x0000000000000000000000000000000000000000') as Address;

  const [info, setInfo] = useState<TokenSummary | null | 'missing'>(null);
  const [trades, setTrades] = useState<TradePoint[] | null>(null);
  const [score, setScore] = useState<RadarScore | null>(null);
  const [scoreState, setScoreState] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const t = await getTokenInfo(token);
      setInfo(t ?? 'missing');
    } catch {
      setInfo('missing');
    }
    getRecentTrades(token).then(setTrades).catch(() => setTrades([]));
  }, [token]);

  useEffect(() => {
    if (!valid) return;
    setInfo(null);
    setTrades(null);
    setScore(null);
    setScoreState('loading');
    load();
    (async () => {
      if (!(await radarHealthy())) {
        setScoreState('offline');
        return;
      }
      try {
        const s = await fetchScore(token);
        setScore(s);
        setScoreState('ok');
      } catch {
        setScoreState('error');
      }
    })();
  }, [token, valid, load, refreshKey]);

  if (!valid) {
    return <div className="empty"><p>Invalid token address.</p></div>;
  }

  if (info === null) {
    return <div className="card muted" style={{ marginTop: 24 }}><span className="spin" />Loading token…</div>;
  }

  if (info === 'missing') {
    return (
      <div className="empty">
        <p>Token <code>{shortAddr(token)}</code> was not launched via Meme Terminal.</p>
        <p className="muted small">You can still scan it with Rug Radar.</p>
      </div>
    );
  }

  return (
    <>
      <div className="detail-head">
        <div>
          <h1>{info.name} <span className="muted" style={{ fontSize: 18 }}>${info.symbol}</span></h1>
          <div className="addr-line">
            {info.address} · <a href={explorerAddress(info.address)} target="_blank" rel="noreferrer">explorer</a>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat"><b>{fmtMon(info.price, 6)} MON</b><span>price / token</span></div>
        <div className="stat"><b>{fmtTokens(info.supply, 0)}</b><span>supply</span></div>
        <div className="stat"><b>{fmtMon(info.reserve)} MON</b><span>curve reserve</span></div>
        <div className="stat"><b>{trades === null ? '…' : trades.length}</b><span>recent trades</span></div>
      </div>

      {trades === null ? (
        <div className="card muted"><span className="spin" />Loading trades…</div>
      ) : (
        <TradeChart trades={trades} />
      )}

      <div className="section-head"><h2>Trade</h2></div>
      <BuySellPanel token={token} onTrade={() => setRefreshKey((k) => k + 1)} />

      <div className="section-head"><h2>🛡 Rug Radar</h2></div>
      {scoreState === 'loading' && <div className="card muted"><span className="spin" />Scanning token…</div>}
      {scoreState === 'offline' && (
        <div className="card muted">
          Radar API offline — start it with <code>npm run dev</code> in <code>../radar</code> (or set NEXT_PUBLIC_RADAR_API_URL).
        </div>
      )}
      {scoreState === 'error' && <div className="card muted">Scan failed. The Radar service may be starting up — try refreshing.</div>}
      {scoreState === 'ok' && score && <ScoreCard score={score} />}
    </>
  );
}
