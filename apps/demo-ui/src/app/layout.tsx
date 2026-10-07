import type { Metadata } from 'next';
import Link from 'next/link';
import { Providers } from '../components/Providers';
import { ConnectButton } from '../components/ConnectButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meme Terminal — Monad',
  description: 'One-click meme coin launcher with AI risk scoring, natively built for Monad.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="topbar">
            <Link href="/" className="brand">
              <span className="brand-mark">◈</span> Meme Terminal
              <span className="brand-sub">on Monad</span>
            </Link>
            <nav className="nav">
              <Link href="/">Terminal</Link>
              <Link href="/launch">Launch</Link>
              <Link href="/radar">Rug Radar</Link>
            </nav>
            <ConnectButton />
          </header>
          <main className="wrap">{children}</main>
          <footer className="foot muted small">
            Meme Terminal · Rug Radar — Monad Metropolis hackathon demo · testnet only, not audited
          </footer>
        </Providers>
      </body>
    </html>
  );
}
