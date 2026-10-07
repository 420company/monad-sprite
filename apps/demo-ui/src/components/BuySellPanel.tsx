'use client';

import { useEffect, useState } from 'react';
import { parseEther, type Address } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { LAUNCHER_ADDRESS } from '../config';
import { LAUNCHER_ABI, getTokenBalance, quoteBuy, quoteSell } from '../lib/launcher';
import { fmtMon, fmtTokens } from '../lib/format';
import { explorerTx } from '../config';

export function BuySellPanel({
  token,
  onTrade,
}: {
  token: Address;
  onTrade: () => void;
}) {
  const { address: wallet, isConnected } = useAccount();
  const [buyAmt, setBuyAmt] = useState('0.1');
  const [sellAmt, setSellAmt] = useState('');
  const [buyQuote, setBuyQuote] = useState<bigint | null>(null);
  const [sellQuote, setSellQuote] = useState<bigint | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Live quotes (debounced)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setBuyQuote(buyAmt ? await quoteBuy(token, parseEther(buyAmt)) : null);
      } catch {
        setBuyQuote(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [buyAmt, token]);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setSellQuote(sellAmt ? await quoteSell(token, parseEther(sellAmt)) : null);
      } catch {
        setSellQuote(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [sellAmt, token]);

  useEffect(() => {
    if (wallet) getTokenBalance(token, wallet).then(setBalance).catch(() => setBalance(null));
  }, [token, wallet, isSuccess]);

  useEffect(() => {
    if (isSuccess) {
      onTrade();
      const t = setTimeout(reset, 4000);
      return () => clearTimeout(t);
    }
  }, [isSuccess, onTrade, reset]);

  const doBuy = () => {
    if (!buyAmt) return;
    writeContract({
      address: LAUNCHER_ADDRESS,
      abi: LAUNCHER_ABI,
      functionName: 'buy',
      args: [token],
      value: parseEther(buyAmt),
    });
  };

  const doSell = () => {
    if (!sellAmt) return;
    writeContract({
      address: LAUNCHER_ADDRESS,
      abi: LAUNCHER_ABI,
      functionName: 'sell',
      args: [token, parseEther(sellAmt)],
    });
  };

  if (!isConnected) {
    return <div className="card muted">Connect your wallet to trade.</div>;
  }

  return (
    <div className="trade-grid">
      <div className="card">
        <h3>Buy</h3>
        <label className="field">
          <span>MON to spend</span>
          <input value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} inputMode="decimal" placeholder="0.1" />
        </label>
        <div className="quote">
          {buyQuote !== null ? `≈ ${fmtTokens(buyQuote)} tokens` : '—'}
        </div>
        <button className="btn btn-buy" disabled={isPending || confirming || !buyAmt} onClick={doBuy}>
          {isPending ? 'Confirm in wallet…' : confirming ? 'Confirming…' : 'Buy'}
        </button>
      </div>

      <div className="card">
        <h3>Sell</h3>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Balance: {balance === null ? '…' : `${fmtTokens(balance)} tokens`}
          {balance !== null && balance > 0n && (
            <button className="linklike" onClick={() => setSellAmt(fmtTokens(balance, 6).replace(/,/g, ''))}>
              max
            </button>
          )}
        </div>
        <label className="field">
          <span>Tokens to sell</span>
          <input value={sellAmt} onChange={(e) => setSellAmt(e.target.value)} inputMode="decimal" placeholder="0" />
        </label>
        <div className="quote">
          {sellQuote !== null ? `≈ ${fmtMon(sellQuote)} MON` : '—'}
        </div>
        <button className="btn btn-sell" disabled={isPending || confirming || !sellAmt} onClick={doSell}>
          {isPending ? 'Confirm in wallet…' : confirming ? 'Confirming…' : 'Sell'}
        </button>
      </div>

      {hash && (
        <div className="tx-note">
          <a href={explorerTx(hash)} target="_blank" rel="noreferrer">
            {isSuccess ? '✓ Confirmed — view tx' : 'View tx…'}
          </a>
        </div>
      )}
      {error && <div className="error">{(error as Error).message.slice(0, 180)}</div>}
    </div>
  );
}
