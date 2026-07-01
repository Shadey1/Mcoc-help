/**
 * Immunity data reconciliation.
 *
 * Every (champion, effect) cell gets zero-or-more opinions from independent
 * sources. Reconcile them into a single verdict + confidence tier that the
 * pipeline uses to decide whether a value ships (`_locks.json`) or falls
 * into the human-review queue (`_review-queue.md`).
 *
 * The design premise, per the handover: a war-defence planner ships a bad
 * path when immunity data is wrong. Consensus ships; single-source flags.
 * Band disagreements (immune vs resist 150%) are never auto-resolved —
 * that's exactly the "player dies on a path" case, so it always ends up
 * in the queue.
 *
 * Independence matters. Two derivations of the same underlying dataset
 * (e.g. MCOCHUB pill tags and MCOCHUB kit-text parse) are ONE source,
 * not two. Callers must dedupe before passing to reconcile().
 */

import type { EffectName, ImmunityBand } from './immunities.js';

// ─── Source identity + freshness ───────────────────────────────────────

/**
 * Sources currently wired into the pipeline. Extend when auntm.ai
 * fetching lands; the reconciler doesn't care about the specific
 * source name, only about identity and freshness.
 */
export type SourceName = 'abilityText' | 'fixture' | 'chart' | 'auntm';

/**
 * Per-source structural coverage window. If a champion's release year
 * is after `staleAfter`, this source cannot cover them and its silence
 * on an effect isn't informative. Freshness is on the source, not the
 * value — the value is either present or absent.
 *
 * - abilityText: always current (scraped live from MCOCHUB)
 * - fixture: hand-curated snapshot — treat as always current for our
 *   purposes; it's small and we control it
 * - chart: dated per the GuiaMTC transcription source
 * - auntm: MCOC's community wiki was frozen mid-2024
 */
export type SourceFreshness = {
  /** Year after which this source doesn't cover new champions. null = always current. */
  staleAfter: number | null;
};

export const DEFAULT_FRESHNESS: Record<SourceName, SourceFreshness> = {
  abilityText: { staleAfter: null },
  fixture: { staleAfter: null },
  chart: { staleAfter: 2026 },
  auntm: { staleAfter: 2024 },
};

// ─── Vote shape ────────────────────────────────────────────────────────

/**
 * One source's opinion on one (champion, effect) cell. `band` mirrors the
 * four-signal model; `value` is only meaningful for resist bands and
 * carries the integer percentage.
 */
export type Vote = {
  source: SourceName;
  band: ImmunityBand['band'];
  /** For resist bands: percentage as an integer. */
  value?: number;
  /** For mechanic bands: which mechanic. */
  qual?: 'Purify' | 'Duration';
  /** For synergy bands: the partner name (display, not slug). */
  partner?: string;
};

// ─── Verdict + confidence ──────────────────────────────────────────────

/**
 * Confidence tiers, ordered least-to-most-trustworthy. `lock-*` tiers
 * ship to `_locks.json`; `flag-*` tiers ship to the review queue only.
 */
export type Confidence =
  | 'lock-3src'
  | 'lock-2src'
  | 'flag-single'
  | 'flag-conflict'
  | 'flag-stale-only';

export type Verdict = {
  band: ImmunityBand['band'];
  value?: number;
  qual?: 'Purify' | 'Duration';
  partner?: string;
};

export type Reconciled = {
  verdict: Verdict;
  confidence: Confidence;
  votes: Vote[];
  /** Set on lock-2src when the human should still verify (e.g. resist %). */
  reviewFlag?: boolean;
  /** Human-readable diagnosis populated on flag-* tiers. */
  note?: string;
};

// ─── Comparison ────────────────────────────────────────────────────────

/** Default resist-tolerance: within this many percentage points counts as agreement. */
export const DEFAULT_RESIST_TOLERANCE = 5;

/**
 * Same-band comparison with optional tolerance on resist values. Two
 * votes agree iff they carry the same band AND, for resist, the numeric
 * value is within `tol` percentage points. Immune vs ≥100%-resist never
 * agree — that's the load-bearing distinction of the four-signal model
 * (both take zero damage but debuff still applies under resist, so
 * mastery/node triggers still fire).
 */
export function votesAgree(a: Vote, b: Vote, tol = DEFAULT_RESIST_TOLERANCE): boolean {
  if (a.band !== b.band) return false;
  if (a.band === 'resist') {
    const av = a.value ?? 0;
    const bv = b.value ?? 0;
    return Math.abs(av - bv) <= tol;
  }
  if (a.band === 'mechanic') return (a.qual ?? '') === (b.qual ?? '');
  if (a.band === 'synergy')
    return normalisePartner(a.partner) === normalisePartner(b.partner);
  return true;
}

function normalisePartner(p: string | undefined): string {
  return (p ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── Reconciliation ────────────────────────────────────────────────────

export type ReconcileOptions = {
  /** Champion's release year — used to score staleness. Missing → treat as never-stale. */
  releaseYear?: number;
  /** Per-source freshness table. Defaults to DEFAULT_FRESHNESS. */
  freshness?: Record<SourceName, SourceFreshness>;
  /** Tolerance for resist-value agreement (percentage points). */
  resistTolerance?: number;
};

/**
 * Reconcile a set of per-source votes for one (champion, effect) cell
 * into a single verdict + confidence tier.
 *
 * Rules, applied in order:
 *  1. No votes → nothing to do (caller shouldn't call in that case).
 *  2. All non-stale votes agree on band (+ value within tol):
 *      - 3+ votes → lock-3src
 *      - 2 votes  → lock-2src
 *      - 1 vote   → flag-single (or flag-stale-only if that source is
 *                    structurally stale for this champion)
 *  3. Votes disagree on band, or on resist value beyond tolerance:
 *      - flag-conflict; verdict picks the strongest current-source
 *        opinion (chart/fixture over abilityText when they disagree,
 *        modulo the freshness override)
 */
export function reconcile(
  votes: readonly Vote[],
  opts: ReconcileOptions = {},
): Reconciled | null {
  if (votes.length === 0) return null;
  const freshness = opts.freshness ?? DEFAULT_FRESHNESS;
  const tol = opts.resistTolerance ?? DEFAULT_RESIST_TOLERANCE;

  // Tag each vote with a stale flag based on champ release vs source cutoff.
  const enriched = votes.map((v) => {
    const cutoff = freshness[v.source]?.staleAfter ?? null;
    const stale =
      cutoff !== null && opts.releaseYear !== undefined && opts.releaseYear > cutoff;
    return { v, stale };
  });

  // Group votes into consensus buckets. Two votes are in the same bucket
  // when votesAgree(). Order matters for representative selection but
  // not for tier calculation.
  const buckets: Array<{ representative: Vote; members: Vote[] }> = [];
  for (const { v } of enriched) {
    const bucket = buckets.find((b) => votesAgree(b.representative, v, tol));
    if (bucket) bucket.members.push(v);
    else buckets.push({ representative: v, members: [v] });
  }

  // Single agreed bucket = consensus (with some structural handling for stale).
  if (buckets.length === 1) {
    const only = buckets[0]!;
    const nonStale = only.members.filter(
      (m) => !enriched.find((e) => e.v === m)!.stale,
    );
    if (nonStale.length === 0) {
      // Every vote is stale — champion released after every source's cutoff.
      return {
        verdict: representativeVerdict(only.members),
        confidence: 'flag-stale-only',
        votes: only.members,
        note: 'Only stale sources have data for this champion.',
      };
    }
    const n = nonStale.length;
    const confidence: Confidence =
      n >= 3 ? 'lock-3src' : n >= 2 ? 'lock-2src' : 'flag-single';
    const reviewFlag = confidence === 'lock-2src' && nonStale[0]!.band === 'resist';
    return {
      verdict: representativeVerdict(nonStale),
      confidence,
      votes: only.members,
      reviewFlag,
      note:
        confidence === 'flag-single'
          ? `Only ${nonStale[0]!.source} has this cell.`
          : undefined,
    };
  }

  // Multi-bucket = conflict. Pick a verdict from the "strongest" bucket
  // by trust-order + non-stale + size, and surface the conflict.
  const trustOrder: SourceName[] = ['fixture', 'chart', 'abilityText', 'auntm'];
  buckets.sort((a, b) => {
    const aTrust = Math.min(
      ...a.members.map((m) => trustOrder.indexOf(m.source)),
    );
    const bTrust = Math.min(
      ...b.members.map((m) => trustOrder.indexOf(m.source)),
    );
    if (aTrust !== bTrust) return aTrust - bTrust;
    return b.members.length - a.members.length;
  });
  const winner = buckets[0]!;
  return {
    verdict: representativeVerdict(winner.members),
    confidence: 'flag-conflict',
    votes: enriched.map((e) => e.v),
    note: describeConflict(buckets),
  };
}

function representativeVerdict(members: readonly Vote[]): Verdict {
  const v = members[0]!;
  const out: Verdict = { band: v.band };
  if (v.band === 'resist') {
    // Median-ish value across the bucket (arithmetic mean rounded).
    const vals = members
      .map((m) => m.value ?? 0)
      .filter((x) => Number.isFinite(x));
    const sum = vals.reduce((a, b) => a + b, 0);
    out.value = vals.length > 0 ? Math.round(sum / vals.length) : 0;
  } else if (v.band === 'mechanic') {
    out.qual = v.qual;
  } else if (v.band === 'synergy') {
    out.partner = v.partner;
  }
  return out;
}

function describeConflict(
  buckets: Array<{ representative: Vote; members: Vote[] }>,
): string {
  const parts = buckets.map((b) => {
    const sources = b.members.map((m) => m.source).join('+');
    const shape = describeVote(b.representative);
    return `${sources}=${shape}`;
  });
  return `Conflict: ${parts.join(' vs ')}`;
}

function describeVote(v: Vote): string {
  if (v.band === 'immune') return 'immune';
  if (v.band === 'resist') return `${v.value ?? '?'}%`;
  if (v.band === 'mechanic') return v.qual ?? 'mechanic';
  return `syn:${v.partner ?? '?'}`;
}
