'use client';

import { useState } from 'react';
import {
  calculateBHR,
  type Ascension,
  type Champion,
  type Rank,
} from '@prestige-tools/engine';

const SIG_ANCHORS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200] as const;
const RANKS: Rank[] = [3, 4, 5];

/**
 * Full BHR lookup table for a champion — sig anchor × rank, with ascension
 * toggle. Uses the engine's calculateBHR so values match what the rest of
 * the site computes (including R3/R4 derivation when only R5 is seeded).
 *
 * Non-ascendable champions get the toggle hidden — they don't have A1/A2
 * states to show.
 */
export function BhrReferenceTable({ champion }: { champion: Champion }) {
  const [asc, setAsc] = useState<Ascension>(champion.ascendable ? 'A2' : 'A0');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="editorial-heading text-xl">BHR reference</h2>
        {champion.ascendable && (
          <div className="inline-flex border border-[var(--color-rule)] rounded overflow-hidden text-xs">
            {(['A0', 'A1', 'A2'] as Ascension[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setAsc(option)}
                className={`px-3 py-1.5 ${
                  asc === option
                    ? 'bg-[var(--color-marvel-impact)] text-white font-medium'
                    : 'bg-[var(--color-paper)] hover:bg-[var(--color-paper-soft)] text-[var(--color-ink-soft)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-[var(--color-ink-soft)]">
        Every sig anchor × rank at {asc}. Sig levels in between interpolate
        smoothly (PCHIP) and round to the nearest 10 BHR — matching the in-game
        display.
      </p>
      <div className="overflow-x-auto border border-[var(--color-rule)] rounded">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]">
            <tr>
              <th className="text-left p-3 font-medium">Sig</th>
              {RANKS.map((r) => (
                <th key={r} className="text-right p-3 font-medium">
                  R{r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="numeric">
            {SIG_ANCHORS.map((sig) => (
              <tr
                key={sig}
                className={`border-t border-[var(--color-rule)]/40 ${
                  sig === 0 || sig === 200
                    ? 'bg-[var(--color-paper-soft)]/40'
                    : ''
                }`}
              >
                <td className="p-2 px-3 font-medium">{sig}</td>
                {RANKS.map((r) => {
                  let bhr: number | null;
                  try {
                    bhr = calculateBHR(champion, {
                      championId: champion.id,
                      rank: r,
                      sig,
                      ascension: asc,
                      stateConfirmed: true,
                      addedVia: 'manual',
                    });
                  } catch {
                    bhr = null;
                  }
                  const isCeiling = r === 5 && sig === 200;
                  return (
                    <td
                      key={r}
                      className={`p-2 px-3 text-right ${
                        isCeiling
                          ? 'text-[var(--color-marvel-editorial)] font-medium'
                          : ''
                      }`}
                    >
                      {bhr === null ? '—' : bhr.toLocaleString()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
