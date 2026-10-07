'use client';

import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { ACTIVE_CHAIN } from '../config';
import { shortAddr } from '../lib/format';

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    const c = connectors[0];
    return (
      <button
        className="btn btn-primary"
        disabled={!c || isPending}
        onClick={() => c && connect({ connector: c })}
      >
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </button>
    );
  }

  if (chainId !== ACTIVE_CHAIN.id) {
    return (
      <button className="btn btn-warn" onClick={() => switchChain({ chainId: ACTIVE_CHAIN.id })}>
        Switch to {ACTIVE_CHAIN.name}
      </button>
    );
  }

  return (
    <button className="btn" onClick={() => disconnect()} title={address}>
      {address ? shortAddr(address) : 'Connected'}
    </button>
  );
}
