'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { parseEventLogs, type Address } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { LAUNCHER_ADDRESS, explorerTx } from '../../config';
import { LAUNCHER_ABI, getTokenCount, publicClient } from '../../lib/launcher';

export default function LaunchPage() {
  const { isConnected } = useAccount();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [newToken, setNewToken] = useState<Address | null>(null);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  // Resolve the new token address from the TokenCreated event (fallback: last token).
  useEffect(() => {
    if (!isSuccess || !receipt) return;
    (async () => {
      try {
        const logs = parseEventLogs({
          abi: LAUNCHER_ABI,
          logs: receipt.logs,
          eventName: 'TokenCreated',
        });
        const first = logs[0] as unknown as { args: { token?: Address } } | undefined;
        if (first?.args.token) {
          setNewToken(first.args.token);
          return;
        }
      } catch {
        /* fall through to count-based lookup */
      }
      const count = await getTokenCount();
      const last = (await publicClient.readContract({
        address: LAUNCHER_ADDRESS,
        abi: LAUNCHER_ABI,
        functionName: 'allTokens',
        args: [count - 1n],
      })) as Address;
      setNewToken(last);
    })();
  }, [isSuccess, receipt]);

  const canLaunch = isConnected && name.trim().length > 0 && symbol.trim().length > 0 && !isPending && !confirming;

  const doLaunch = () => {
    reset();
    setNewToken(null);
    writeContract({
      address: LAUNCHER_ADDRESS,
      abi: LAUNCHER_ABI,
      functionName: 'createToken',
      args: [name.trim(), symbol.trim().toUpperCase()],
    });
  };

  return (
    <>
      <div className="section-head"><h2>🚀 Launch a meme coin</h2></div>
      <p className="muted" style={{ maxWidth: 560, lineHeight: 1.6 }}>
        One transaction deploys your ERC-20 on a bonding curve. Launching is free
        (just gas) — buys and sells trade against the curve from block one.
      </p>

      {!isConnected && <div className="card muted" style={{ marginTop: 16 }}>Connect your wallet to launch.</div>}

      <div className="card form-narrow" style={{ marginTop: 16 }}>
        <label className="field">
          <span>Token name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monad Cat" maxLength={32} />
        </label>
        <label className="field">
          <span>Symbol</span>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. MCAT" maxLength={12} />
        </label>
        <button className="btn btn-primary" disabled={!canLaunch} onClick={doLaunch} style={{ width: '100%' }}>
          {!isConnected ? 'Connect wallet first' : isPending ? 'Confirm in wallet…' : confirming ? 'Deploying…' : 'Launch token'}
        </button>

        {hash && (
          <div className="tx-note" style={{ marginTop: 12 }}>
            <a href={explorerTx(hash)} target="_blank" rel="noreferrer">
              {isSuccess ? '✓ Confirmed — view tx' : 'View tx…'}
            </a>
          </div>
        )}
        {error && <div className="error" style={{ marginTop: 12 }}>{(error as Error).message.slice(0, 200)}</div>}
      </div>

      {newToken && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--green)' }}>
          <h3 style={{ margin: '0 0 8px' }}>🎉 Token launched!</h3>
          <div className="addr-line">{newToken}</div>
          <div className="cta-row" style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <Link href={`/token/${newToken}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Open token page
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
