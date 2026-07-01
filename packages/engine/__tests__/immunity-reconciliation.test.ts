import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESIST_TOLERANCE,
  reconcile,
  votesAgree,
  type Vote,
} from '../src/immunity-reconciliation.js';

describe('votesAgree', () => {
  it('agrees on identical immune votes', () => {
    expect(
      votesAgree(
        { source: 'abilityText', band: 'immune' },
        { source: 'fixture', band: 'immune' },
      ),
    ).toBe(true);
  });
  it('disagrees on immune vs resist even at 150%', () => {
    // The load-bearing four-signal distinction: taking zero damage isn't
    // the same as immune, because the debuff still applies under resist.
    expect(
      votesAgree(
        { source: 'abilityText', band: 'immune' },
        { source: 'chart', band: 'resist', value: 150 },
      ),
    ).toBe(false);
  });
  it('agrees on resist values within ±5', () => {
    expect(
      votesAgree(
        { source: 'abilityText', band: 'resist', value: 80 },
        { source: 'chart', band: 'resist', value: 85 },
      ),
    ).toBe(true);
  });
  it('disagrees on resist values >±5', () => {
    expect(
      votesAgree(
        { source: 'abilityText', band: 'resist', value: 80 },
        { source: 'chart', band: 'resist', value: 90 },
      ),
    ).toBe(false);
  });
  it('agrees on mechanic band + same qual', () => {
    expect(
      votesAgree(
        { source: 'chart', band: 'mechanic', qual: 'Purify' },
        { source: 'fixture', band: 'mechanic', qual: 'Purify' },
      ),
    ).toBe(true);
  });
  it('disagrees on mechanic band with different qual', () => {
    expect(
      votesAgree(
        { source: 'chart', band: 'mechanic', qual: 'Purify' },
        { source: 'fixture', band: 'mechanic', qual: 'Duration' },
      ),
    ).toBe(false);
  });
  it('agrees on synergy with the same partner (case + punctuation fuzzed)', () => {
    expect(
      votesAgree(
        { source: 'chart', band: 'synergy', partner: 'Storm (Pyramid X)' },
        { source: 'fixture', band: 'synergy', partner: 'storm pyramid x' },
      ),
    ).toBe(true);
  });
});

describe('reconcile — locking tiers', () => {
  it('locks-3src when three sources agree on band + value within tol', () => {
    const r = reconcile([
      { source: 'abilityText', band: 'resist', value: 80 },
      { source: 'chart', band: 'resist', value: 80 },
      { source: 'auntm', band: 'resist', value: 80 },
    ])!;
    expect(r.confidence).toBe('lock-3src');
    expect(r.verdict).toEqual({ band: 'resist', value: 80 });
  });
  it('locks-2src on two agreeing sources', () => {
    const r = reconcile([
      { source: 'abilityText', band: 'resist', value: 80 },
      { source: 'chart', band: 'resist', value: 80 },
    ])!;
    expect(r.confidence).toBe('lock-2src');
  });
  it('locks-2src averages resist values within tolerance', () => {
    const r = reconcile([
      { source: 'abilityText', band: 'resist', value: 80 },
      { source: 'chart', band: 'resist', value: 85 },
    ])!;
    expect(r.confidence).toBe('lock-2src');
    // (80 + 85) / 2 = 82.5 → rounds to 83.
    expect(r.verdict.value).toBe(83);
  });
  it('reviewFlag on 2src resist locks (soft flag for the array)', () => {
    const r = reconcile([
      { source: 'abilityText', band: 'resist', value: 80 },
      { source: 'chart', band: 'resist', value: 80 },
    ])!;
    expect(r.reviewFlag).toBe(true);
  });
  it('no reviewFlag on 2src immune locks', () => {
    const r = reconcile([
      { source: 'abilityText', band: 'immune' },
      { source: 'chart', band: 'immune' },
    ])!;
    expect(r.reviewFlag).toBeFalsy();
  });
});

describe('reconcile — flagging tiers', () => {
  it('flag-single when only one source has an opinion', () => {
    const r = reconcile([{ source: 'chart', band: 'immune' }])!;
    expect(r.confidence).toBe('flag-single');
  });
  it('flag-conflict on band disagreement (immune vs resist)', () => {
    // The reconciliation exists specifically for this class of failure.
    // A single champion misclassified across sources becomes a lethal
    // path recommendation. Never auto-resolves.
    const r = reconcile([
      { source: 'abilityText', band: 'immune' },
      { source: 'chart', band: 'resist', value: 150 },
    ])!;
    expect(r.confidence).toBe('flag-conflict');
    expect(r.note).toMatch(/Conflict/);
  });
  it('flag-conflict on resist value beyond tolerance', () => {
    const r = reconcile([
      { source: 'abilityText', band: 'resist', value: 80 },
      { source: 'chart', band: 'resist', value: 100 },
    ])!;
    expect(r.confidence).toBe('flag-conflict');
  });
});

describe('reconcile — freshness', () => {
  it('flag-stale-only when the only source is structurally stale for this champion', () => {
    // auntm is frozen at 2024; a 2026-released champion cannot be covered.
    const r = reconcile(
      [{ source: 'auntm', band: 'resist', value: 60 }],
      { releaseYear: 2026 },
    )!;
    expect(r.confidence).toBe('flag-stale-only');
  });
  it('non-stale source rides through to lock-single (as flag-single, not stale)', () => {
    // Same shape but with abilityText — never stale — collapses to
    // flag-single, not stale-only.
    const r = reconcile(
      [{ source: 'abilityText', band: 'resist', value: 60 }],
      { releaseYear: 2026 },
    )!;
    expect(r.confidence).toBe('flag-single');
  });
  it('stale source does not count toward a 2src lock', () => {
    // auntm (stale) + abilityText (fresh) agreeing on the same value on
    // a 2026 champ: abilityText is the only non-stale voice, so it
    // collapses to flag-single, not lock-2src.
    const r = reconcile(
      [
        { source: 'abilityText', band: 'immune' },
        { source: 'auntm', band: 'immune' },
      ],
      { releaseYear: 2026 },
    )!;
    expect(r.confidence).toBe('flag-single');
  });
});

describe('DEFAULT_RESIST_TOLERANCE', () => {
  it('is 5 percentage points', () => {
    // Hard-coded expectation so a silent change in the constant lights up
    // the test suite (this drives what the pipeline treats as consensus).
    expect(DEFAULT_RESIST_TOLERANCE).toBe(5);
  });
});
