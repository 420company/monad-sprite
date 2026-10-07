'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ACTIVE_CHAIN } from '../config';

export function Providers({ children }: { children: React.ReactNode }) {
  const [config] = useState(() =>
    createConfig({
      chains: [ACTIVE_CHAIN],
      connectors: [injected()],
      transports: { [ACTIVE_CHAIN.id]: http() },
      ssr: true,
    })
  );
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
