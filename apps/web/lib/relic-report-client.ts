'use client';

import type { R6StatcastLevel, R6StatcastRank } from '@prestige-tools/engine';

export type RelicReport = {
  rank: R6StatcastRank;
  level: R6StatcastLevel;
  rating: number;
  predictedRating?: number;
  isAlpha?: boolean;
};

export async function submitRelicReport(report: RelicReport): Promise<void> {
  const res = await fetch('/api/relic-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rank: report.rank,
      level: report.level,
      rating: report.rating,
      predictedRating: report.predictedRating,
      isAlpha: report.isAlpha,
      website: '',
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: `request failed (${res.status})` }))) as {
      error?: string;
    };
    if (res.status === 404) {
      throw new Error(
        "Reporting only works once deployed to Cloudflare Pages — the /api/relic-report endpoint isn't available in local dev.",
      );
    }
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
}
