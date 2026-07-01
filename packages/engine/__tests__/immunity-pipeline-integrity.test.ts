import { describe, expect, it } from 'vitest';
import locksJson from '../../../data/immunities/_locks.json' with { type: 'json' };
import { IMMUNITY_EFFECTS } from '../src/immunities.js';

/**
 * Pipeline integrity tests.
 *
 * These assertions guard the invariants of data/immunities/_locks.json —
 * everything the reconciliation script MUST enforce before writing.
 * If the reconcile logic regresses in a way that leaks a flag-conflict
 * into the shipped locks, or produces a band outside the four-signal
 * model, these tests light up before a bad file lands in production.
 */

type LockRow = {
  band: string;
  value?: number;
  qual?: string;
  partner?: string;
  confidence: string;
  _review?: true;
};

type LocksFile = {
  generated: string;
  chartDated: string;
  _meta: Record<string, number | string>;
  champions: Record<string, Record<string, LockRow>>;
};

const locks = locksJson as unknown as LocksFile;

const ALLOWED_BANDS = new Set(['immune', 'resist', 'mechanic', 'synergy']);
const ALLOWED_MECHANIC_QUAL = new Set(['Purify', 'Duration']);
const ALLOWED_CONFIDENCE = new Set(['lock-3src', 'lock-2src']);
const TRACKED_EFFECTS = new Set<string>(IMMUNITY_EFFECTS);

describe('pipeline integrity — _locks.json', () => {
  it('has a top-level generated date and chartDated string', () => {
    expect(typeof locks.generated).toBe('string');
    expect(typeof locks.chartDated).toBe('string');
  });

  it('has _meta counters that sum to cellsTotal', () => {
    const m = locks._meta as {
      cellsTotal: number;
      cellsLocked: number;
      cellsInReviewQueue: number;
    };
    expect(m.cellsLocked + m.cellsInReviewQueue).toBe(m.cellsTotal);
  });

  it('every lock row uses a lock-* confidence tier', () => {
    // Handover §Tests 1 — no flag-* leakage.
    for (const [champ, effects] of Object.entries(locks.champions)) {
      for (const [eff, row] of Object.entries(effects)) {
        expect(
          ALLOWED_CONFIDENCE.has(row.confidence),
          `${champ}/${eff} confidence=${row.confidence}`,
        ).toBe(true);
      }
    }
  });

  it('every lock row uses a valid four-signal band', () => {
    for (const [champ, effects] of Object.entries(locks.champions)) {
      for (const [eff, row] of Object.entries(effects)) {
        expect(
          ALLOWED_BANDS.has(row.band),
          `${champ}/${eff} band=${row.band}`,
        ).toBe(true);
      }
    }
  });

  it('resist rows carry an integer value', () => {
    for (const [champ, effects] of Object.entries(locks.champions)) {
      for (const [eff, row] of Object.entries(effects)) {
        if (row.band !== 'resist') continue;
        expect(
          typeof row.value === 'number' && Number.isFinite(row.value),
          `${champ}/${eff} resist without numeric value`,
        ).toBe(true);
      }
    }
  });

  it('mechanic rows use only Purify or Duration', () => {
    for (const [champ, effects] of Object.entries(locks.champions)) {
      for (const [eff, row] of Object.entries(effects)) {
        if (row.band !== 'mechanic') continue;
        expect(
          ALLOWED_MECHANIC_QUAL.has(row.qual ?? ''),
          `${champ}/${eff} mechanic qual=${row.qual}`,
        ).toBe(true);
      }
    }
  });

  it('every effect key is in the tracked 13-effect vocabulary', () => {
    // Handover §Tests 2 — no out-of-scope effects leak through.
    for (const [champ, effects] of Object.entries(locks.champions)) {
      for (const eff of Object.keys(effects)) {
        expect(
          TRACKED_EFFECTS.has(eff),
          `${champ} carries out-of-vocab effect ${eff}`,
        ).toBe(true);
      }
    }
  });

  it('no _review flag on a 3src lock (only 2src-resist should carry it)', () => {
    for (const [champ, effects] of Object.entries(locks.champions)) {
      for (const [eff, row] of Object.entries(effects)) {
        if (!row._review) continue;
        expect(
          row.confidence,
          `${champ}/${eff} _review with confidence=${row.confidence}`,
        ).toBe('lock-2src');
      }
    }
  });
});
