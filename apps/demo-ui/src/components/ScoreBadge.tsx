'use client';

import type { Band } from '../lib/radar';

const BAND_CLASS: Record<Band, string> = {
  LOW: 'badge-low',
  MEDIUM: 'badge-medium',
  HIGH: 'badge-high',
};

export function ScoreBadge({
  score,
  band,
  size = 'md',
}: {
  score: number | null;
  band: Band | null;
  size?: 'sm' | 'md';
}) {
  if (score === null || band === null) {
    return <span className={`badge badge-na ${size === 'sm' ? 'badge-sm' : ''}`}>scan…</span>;
  }
  return (
    <span className={`badge ${BAND_CLASS[band]} ${size === 'sm' ? 'badge-sm' : ''}`}>
      {score} · {band}
    </span>
  );
}
