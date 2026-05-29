'use client';

import { useMemo, useState } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';
import type { IdentifiedCard } from '../lib/ocr/types';
import { ChampionPortrait } from './champion-portrait';
import { findCandidates } from '../lib/ocr/name-match';
import { deriveStateFromBHR } from '../lib/ocr/bhr-reverse';
import { FEEDBACK_FORM_URL } from '../lib/feedback';
import {
  addPortrait,
  loadPortraitStore,
  savePortraitStore,
  type PortraitStore,
} from '../lib/ocr/portrait-store';

type Props = {
  cards: IdentifiedCard[];
  champions: Champion[];
  onConfirm: (states: ChampionState[]) => void;
  onCancel: () => void;
};

type EditableState = {
  rank: 3 | 4 | 5;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
};

/**
 * Review-and-fix UI for OCR results. Each card from the pipeline is shown
 * with its auto-identified champion + state. The user can:
 *   - Accept the auto-pick (default for strong agreement)
 *   - Override the champion via dropdown (for partial/weak matches)
 *   - Adjust rank/sig/ascension if they were misread
 *   - Skip a card entirely if it shouldn't be imported
 *
 * On Import: saves the confirmed identifications to roster state AND stashes
 * the cropped portrait + hash into the user's local portrait store. The
 * portrait store improves identification accuracy on subsequent imports.
 */
export function ConfirmationGrid({ cards, champions, onConfirm, onCancel }: Props) {
  const championLookup = useMemo(
    () => new Map(champions.map((c) => [c.id, c])),
    [champions],
  );

  const [overrides, setOverrides] = useState<Record<number, string>>({});
  // Default to importing the confident (green) cards and skipping the flagged
  // ones — the flagged cards are mostly name-less / ambiguous junk, so the
  // common path is "Import" without wading through them. Bulk buttons + the
  // per-card restore link let the user pull specific flagged cards back in.
  const [skipped, setSkipped] = useState<Set<number>>(
    () => new Set(cards.flatMap((c, i) => (c.match.agreement === 'strong' ? [] : [i]))),
  );
  const [stateEdits, setStateEdits] = useState<Record<number, EditableState>>(() =>
    Object.fromEntries(
      cards.map((c, i) => [
        i,
        {
          rank: (c.tile.derivedState?.rank ?? 4) as 3 | 4 | 5,
          sig: c.tile.derivedState?.sig ?? 200,
          ascension: c.tile.derivedState?.ascension ?? 'A0',
        },
      ]),
    ),
  );
  const [searchOpenFor, setSearchOpenFor] = useState<number | null>(null);

  function effectiveChampion(index: number): Champion | null {
    const overrideId = overrides[index];
    if (overrideId) return championLookup.get(overrideId) ?? null;
    return championLookup.get(cards[index]!.match.championId) ?? null;
  }

  function setRank(index: number, rank: 3 | 4 | 5) {
    setStateEdits((prev) => ({ ...prev, [index]: { ...prev[index]!, rank } }));
  }
  function setSig(index: number, sig: number) {
    setStateEdits((prev) => ({ ...prev, [index]: { ...prev[index]!, sig } }));
  }
  function setAscension(index: number, ascension: 'A0' | 'A1' | 'A2') {
    // We know the BHR, so re-derive (rank, sig) for the new ascension rather
    // than leaving stale values. Ascension shifts predicted BHR a lot, so the
    // matching rank/sig changes with it. Falls back to just setting ascension
    // if there's no BHR or no state lands within tolerance.
    const champ = effectiveChampion(index);
    const bhr = cards[index]!.tile.derivedState?.ocredBHR;
    if (champ?.ascendable && bhr) {
      const d = deriveStateFromBHR(champ, bhr, ascension, 500);
      if (d) {
        setStateEdits((prev) => ({
          ...prev,
          [index]: { rank: d.rank, sig: d.sig, ascension },
        }));
        return;
      }
    }
    setStateEdits((prev) => ({
      ...prev,
      [index]: { ...prev[index]!, ascension },
    }));
  }

  function pickOverride(index: number, championId: string) {
    setOverrides((prev) => ({ ...prev, [index]: championId }));
    setSearchOpenFor(null);
    // Re-derive (rank, sig, ascension) from the known BHR for the champion the
    // user just chose — picking the right champion is enough; the engine math
    // fills in the state.
    const champ = championLookup.get(championId);
    const bhr = cards[index]!.tile.derivedState?.ocredBHR;
    if (champ && bhr) {
      const asc = champ.ascendable ? (stateEdits[index]?.ascension ?? 'A0') : 'A0';
      const d = deriveStateFromBHR(champ, bhr, asc, 500);
      if (d) {
        setStateEdits((prev) => ({
          ...prev,
          [index]: { rank: d.rank, sig: d.sig, ascension: d.ascension },
        }));
      }
    }
  }

  function toggleSkip(index: number) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function setFlaggedSkipped(skip: boolean) {
    setSkipped((prev) => {
      const next = new Set(prev);
      cards.forEach((c, i) => {
        if (c.match.agreement === 'strong') return;
        if (skip) next.add(i);
        else next.delete(i);
      });
      return next;
    });
  }

  function handleConfirm() {
    const states: ChampionState[] = [];
    let store: PortraitStore = loadPortraitStore();
    let portraitsSaved = 0;

    for (let i = 0; i < cards.length; i++) {
      if (skipped.has(i)) continue;
      const champion = effectiveChampion(i);
      if (!champion) continue;
      const edit = stateEdits[i]!;
      const card = cards[i]!;

      states.push({
        championId: champion.id,
        rank: edit.rank,
        sig: edit.sig,
        ascension: champion.ascendable ? edit.ascension : 'A0',
        stateConfirmed: true,
        addedVia: 'screenshot',
      });

      // Stash the confirmed portrait — but only if we actually have a usable
      // hash + thumbnail (defensive in case pipeline skipped generation)
      if (card.tile.portraitHash && card.tile.portraitHash.length === 16) {
        store = addPortrait(store, champion.id, {
          hash: card.tile.portraitHash,
          capturedAt: new Date().toISOString(),
          thumbnailDataUrl: card.tile.thumbnailDataUrl ?? '',
        });
        portraitsSaved++;
      }
    }

    savePortraitStore(store);
    console.log(
      `[confirmation-grid] confirmed ${states.length} champions, saved ${portraitsSaved} portraits`,
    );
    onConfirm(states);
  }

  const validCount = cards.filter(
    (_, i) => !skipped.has(i) && effectiveChampion(i),
  ).length;
  const strongCount = cards.filter(
    (c, i) => !skipped.has(i) && c.match.agreement === 'strong' && !overrides[i],
  ).length;
  const flaggedCount = cards.filter(
    (c, i) => !skipped.has(i) && c.match.agreement !== 'strong' && !overrides[i],
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="editorial-heading text-lg">
          Review {cards.length} identified champions
        </h3>
        <div className="text-xs text-[var(--color-ink-soft)] space-x-3">
          <span className="text-green-700">{strongCount} confident</span>
          {flaggedCount > 0 && (
            <span className="text-amber-700">{flaggedCount} flagged</span>
          )}
          {skipped.size > 0 && <span>{skipped.size} skipped</span>}
        </div>
      </div>

      <div className="text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded p-2">
        Confident matches are kept; flagged (amber/red) ones are skipped by
        default — they&apos;re usually name-less or ambiguous. Click a name to
        fix a match, rank / sig / A* to edit state, or <strong>restore</strong>{' '}
        a flagged card to import it. Then <strong>Import</strong> below.{' '}
        <a
          href={FEEDBACK_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-marvel-impact)] underline hover:text-[var(--color-marvel-editorial)]"
        >
          Something wrong? Send anonymous feedback →
        </a>
      </div>

      {flaggedCount + skipped.size > 0 && (
        <div className="flex gap-2 text-xs items-center">
          <span className="text-[var(--color-ink-soft)]">Flagged cards:</span>
          <button
            type="button"
            onClick={() => setFlaggedSkipped(false)}
            className="px-2 py-1 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)]"
          >
            Accept all flagged
          </button>
          <button
            type="button"
            onClick={() => setFlaggedSkipped(true)}
            className="px-2 py-1 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)]"
          >
            Skip all flagged
          </button>
        </div>
      )}

      <ul className="border border-[var(--color-rule)] rounded divide-y divide-[var(--color-rule)] max-h-[60vh] overflow-y-auto">
        {cards.map((card, index) => {
          const champion = effectiveChampion(index);
          const isSkipped = skipped.has(index);
          const isOverridden = Boolean(overrides[index]);
          const agreement = isOverridden ? 'strong' : card.match.agreement;
          const edit = stateEdits[index]!;
          const isSearchOpen = searchOpenFor === index;

          return (
            <li
              key={index}
              className={`px-2 py-2 flex items-center gap-2 text-sm ${
                isSkipped ? 'opacity-40' : ''
              }`}
            >
              {/* Confidence indicator */}
              <div
                className={`w-2 self-stretch rounded ${
                  agreement === 'strong'
                    ? 'bg-green-500'
                    : agreement === 'partial'
                      ? 'bg-amber-400'
                      : 'bg-red-400'
                }`}
                title={`${agreement} match (confidence ${(card.match.confidence * 100).toFixed(0)}%)`}
              />

              {/* OCR'd portrait thumbnail (shows what the OCR actually saw,
                  alongside the official portrait — helps the user spot bad crops) */}
              {card.tile.thumbnailDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.tile.thumbnailDataUrl}
                  alt="OCR'd portrait"
                  className="w-9 h-9 rounded border border-[var(--color-rule)] flex-shrink-0"
                  title="What the OCR pipeline saw"
                />
              )}

              {/* Official portrait of the matched champion */}
              {champion && (
                <ChampionPortrait
                  name={champion.name}
                  klass={champion.class}
                  portraitUrl={champion.portraitUrl ?? null}
                  size={36}
                  showClassOverlay={Boolean(champion.portraitUrl)}
                />
              )}

              {/* Name (clickable to override) */}
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setSearchOpenFor(isSearchOpen ? null : index)}
                  className="font-medium text-left hover:underline truncate block w-full"
                  title="Click to change"
                >
                  {champion?.name ?? '— no match —'}
                </button>
                {card.tile.derivedState && (
                  <div className="text-[10px] text-[var(--color-ink-soft)] truncate">
                    BHR {card.tile.derivedState.ocredBHR.toLocaleString()} →
                    R{card.tile.derivedState.rank} sig {card.tile.derivedState.sig}{' '}
                    {card.tile.derivedState.ascension}
                    {card.tile.derivedState.absError > 30 && (
                      <span className="text-amber-700">
                        {' '}
                        (±{card.tile.derivedState.absError})
                      </span>
                    )}
                  </div>
                )}
                {!isOverridden && !card.tile.derivedState && card.tile.nameText && (
                  <div className="text-[10px] text-[var(--color-ink-soft)] truncate">
                    OCR&apos;d: &ldquo;{card.tile.nameText}&rdquo;
                  </div>
                )}
              </div>

              {/* State editors */}
              <div className="flex items-center gap-1 text-xs numeric">
                <select
                  value={edit.rank}
                  onChange={(e) => setRank(index, Number(e.target.value) as 3 | 4 | 5)}
                  className="px-1 py-0.5 border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
                >
                  <option value={3}>R3</option>
                  <option value={4}>R4</option>
                  <option value={5}>R5</option>
                </select>
                <select
                  value={edit.sig}
                  onChange={(e) => setSig(index, Number(e.target.value))}
                  className="px-1 py-0.5 border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
                >
                  {[0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {champion?.ascendable && (
                  <select
                    value={edit.ascension}
                    onChange={(e) =>
                      setAscension(index, e.target.value as 'A0' | 'A1' | 'A2')
                    }
                    className="px-1 py-0.5 border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
                  >
                    <option value="A0">A0</option>
                    <option value="A1">A1</option>
                    <option value="A2">A2</option>
                  </select>
                )}
              </div>

              <button
                type="button"
                onClick={() => toggleSkip(index)}
                className="text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-marvel-impact)] flex-shrink-0"
              >
                {isSkipped ? 'restore' : 'skip'}
              </button>

              {/* Inline name picker */}
              {isSearchOpen && (
                <ChampionPicker
                  initialQuery={card.tile.nameText || ''}
                  champions={champions}
                  alternatives={card.match.alternatives}
                  onPick={(id) => pickOverride(index, id)}
                  onClose={() => setSearchOpenFor(null)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={validCount === 0}
          className="px-4 py-2 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Import {validCount} {validCount === 1 ? 'champion' : 'champions'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ChampionPicker({
  initialQuery,
  champions,
  alternatives,
  onPick,
  onClose,
}: {
  initialQuery: string;
  champions: Champion[];
  alternatives: Array<{ championId: string; championName: string; score: number }>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);

  const candidates = useMemo(() => {
    if (query.trim().length === 0) {
      const altSet = new Set(alternatives.map((a) => a.championId));
      const altList = alternatives
        .map((a) => champions.find((c) => c.id === a.championId))
        .filter((c): c is Champion => Boolean(c));
      const others = champions.filter((c) => !altSet.has(c.id)).slice(0, 20);
      return [...altList, ...others];
    }
    return findCandidates(query, champions).slice(0, 10);
  }, [query, champions, alternatives]);

  return (
    <div className="absolute right-0 z-10 bg-[var(--color-paper)] border border-[var(--color-rule)] rounded shadow-lg w-64 max-h-64 overflow-y-auto p-2 space-y-1">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search champions…"
        autoFocus
        className="w-full px-2 py-1 border border-[var(--color-rule)] rounded text-sm"
      />
      <ul className="text-xs">
        {candidates.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className="w-full text-left px-2 py-1 hover:bg-[var(--color-paper-soft)] rounded"
            >
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClose}
        className="text-[10px] text-[var(--color-ink-soft)] underline px-2"
      >
        cancel
      </button>
    </div>
  );
}
