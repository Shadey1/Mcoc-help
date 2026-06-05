'use client';

import type {
  Battlecast6Id,
  R6StatcastLevel,
  R6StatcastRank,
} from '@prestige-tools/engine';

export type StatcastReport = {
  kind: 'statcast';
  rank: R6StatcastRank;
  level: R6StatcastLevel;
  rating: number;
  predictedRating?: number;
  isAlpha?: boolean;
};

export type BattlecastReport = {
  kind: 'battlecast';
  relicId: Battlecast6Id;
  rank: R6StatcastRank;
  level: R6StatcastLevel;
  rating: number;
  predictedRating?: number | null;
  isAlpha?: boolean;
};

export type RelicReport = StatcastReport | BattlecastReport;

export async function submitRelicReport(report: RelicReport): Promise<void> {
  const body: Record<string, unknown> = {
    kind: report.kind,
    rank: report.rank,
    level: report.level,
    rating: report.rating,
    website: '',
  };
  if (report.kind === 'battlecast') body.relicId = report.relicId;
  if (report.predictedRating != null) body.predictedRating = report.predictedRating;
  if (report.isAlpha !== undefined) body.isAlpha = report.isAlpha;

  const res = await fetch('/api/relic-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({
      error: `request failed (${res.status})`,
    }))) as { error?: string };
    if (res.status === 404) {
      throw new Error(
        "Reporting only works once deployed to Cloudflare Pages — the /api/relic-report endpoint isn't available in local dev.",
      );
    }
    throw new Error(errBody.error ?? `request failed (${res.status})`);
  }
}
