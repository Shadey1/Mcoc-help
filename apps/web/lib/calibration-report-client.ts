'use client';

import type { Ascension, Rank } from '@prestige-tools/engine';
import { bhrOverrideKey } from '@prestige-tools/engine';

/**
 * Client-side helpers for the calibration-report API.
 *
 * - `submitCalibrationReport()` POSTs one report to /api/calibration-report
 * - `loadReportedKeys()` / `markReported()` track which overrides the user
 *   has already submitted, so we never nag them twice for the same one.
 *
 * Submission is opt-in: the user clicks "share with mcoc.help" after saving
 * an override. No automatic submission, no background telemetry.
 */

const REPORTED_KEY = 'mcoc-help-bhr-reported-v1';

export type CalibrationReport = {
  championId: string;
  rank: Rank;
  sig: number;
  ascension: Ascension;
  predictedBhr: number;
  actualBhr: number;
};

export async function submitCalibrationReport(
  report: CalibrationReport,
): Promise<void> {
  const res = await fetch('/api/calibration-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      championId: report.championId,
      rank: report.rank,
      sig: report.sig,
      ascension: report.ascension,
      predictedBhr: report.predictedBhr,
      actualBhr: report.actualBhr,
      website: '',
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `request failed (${res.status})` })) as { error?: string };
    if (res.status === 404) {
      throw new Error(
        "Reporting only works once deployed to Cloudflare Pages — the /api/calibration-report endpoint isn't available in local dev.",
      );
    }
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
}

export function loadReportedKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(REPORTED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

export function markReported(report: CalibrationReport): void {
  if (typeof window === 'undefined') return;
  const key = bhrOverrideKey(
    report.championId,
    report.rank,
    report.sig,
    report.ascension,
  );
  const existing = loadReportedKeys();
  existing.add(key);
  window.localStorage.setItem(
    REPORTED_KEY,
    JSON.stringify([...existing]),
  );
}

export function isReported(
  championId: string,
  rank: Rank,
  sig: number,
  ascension: Ascension,
  reportedKeys: Set<string>,
): boolean {
  return reportedKeys.has(bhrOverrideKey(championId, rank, sig, ascension));
}
