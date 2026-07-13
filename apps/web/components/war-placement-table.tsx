'use client';

import { useMemo, useRef, useState } from 'react';
import {
  assignmentStateScore,
  effectiveRank,
  type Ascension,
  type Champion,
  type ChampionState,
  type Rank,
  type WarAssignment,
  type WarResult,
  type WarTier,
} from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';
import { WarPlacementExport } from './war-placement-export';

const TIER_BADGE_TEXT: Record<WarTier, string> = {
  strong: 'S',
  mid: 'M',
  base: 'B',
};
const TIER_BADGE_TITLE: Record<WarTier, string> = {
  strong: 'Strong — must-place meta defender',
  mid: 'Mid — preferred fill',
  base: 'Base — diversity gap-filler',
};
const TIER_BADGE_CLASS: Record<WarTier, string> = {
  strong: 'bg-[var(--color-marvel-impact)] text-white',
  mid: 'bg-[var(--color-ink)] text-[var(--color-paper)]',
  base: 'bg-[var(--color-ink-soft)] text-[var(--color-paper)]',
};

/**
 * Tier corner badge on a placed slot's portrait. One-letter, high-contrast,
 * intended for at-a-glance verification that Strong defenders made it in.
 */
function TierBadge({ tier }: { tier: WarTier }) {
  return (
    <span
      className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-medium flex items-center justify-center shadow-sm ${TIER_BADGE_CLASS[tier]}`}
      title={TIER_BADGE_TITLE[tier]}
      aria-label={TIER_BADGE_TITLE[tier]}
    >
      {TIER_BADGE_TEXT[tier]}
    </span>
  );
}

/**
 * War placement table — the output of assignWar().
 *
 * One row per alliance member, with their 5 placement slots shown as
 * portrait + name + state. Slots are sorted by descending rank tier within
 * each row so the strongest placement is leftmost. Empty slots (when a
 * player can't fill all 5 from the pool above the floor) show a dash and
 * count toward the underfill warning above.
 *
 * Below the table: unavailable-champion list — champs that were in the
 * pool but no player held at ≥ floor. Useful diagnostic for officers
 * deciding whether to lower the floor or expand the pool.
 */
export function WarPlacementTable({
  result,
  championLookup,
  slotsPerPlayer,
  playerRosters,
  floor,
  onSwap,
  bgLabel,
}: {
  result: WarResult;
  championLookup: Map<string, Champion>;
  slotsPerPlayer: number;
  /** Per-player roster lookup. Enables officer-driven manual swaps when set. */
  playerRosters?: Map<string, ChampionState[]>;
  /** Floor for swap eligibility — must match what produced `result`. */
  floor?: { rank: Rank; ascension: Ascension };
  /** Called when an officer swaps one of a player's placements for another
   *  champion from that player's roster. Required for manual editing. */
  onSwap?: (
    playerId: string,
    replacedChampionId: string,
    newState: ChampionState,
  ) => void;
  /** BG label ("BG1" / "BG2" / "BG3") for the export header and filename. */
  bgLabel?: string;
}) {
  const editable = Boolean(onSwap && playerRosters && floor);
  const canShowCopies = Boolean(playerRosters && floor);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  // Currently-open "who else owns this?" info panel. Anchored to a specific
  // player row + champion so the panel renders directly under that row and
  // the officer knows which placement they're inspecting alternatives for.
  const [openInfo, setOpenInfo] = useState<
    { playerId: string; championId: string } | null
  >(null);
  const floorTier = floor ? effectiveRank(floor.rank, floor.ascension) : 0;
  const printRef = useRef<HTMLDivElement | null>(null);

  // championIds occupying a slot in this BG — any swap candidate must NOT be
  // in this set (except the slot being swapped out, handled per-cell).
  const placedChampionIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of result.assignments) s.add(a.championId);
    return s;
  }, [result.assignments]);

  // championId → the player who currently holds the placement. Used by the
  // all-copies panel to badge each alternate as "currently placed" vs
  // "unplaced" vs "placed with {other}".
  const placementByChamp = useMemo(() => {
    const m = new Map<string, WarAssignment>();
    for (const a of result.assignments) m.set(a.championId, a);
    return m;
  }, [result.assignments]);

  // playerId → display name — for labelling alternates in the panel.
  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of result.assignments) m.set(a.playerId, a.playerName);
    for (const u of result.underfilled) m.set(u.playerId, u.playerName);
    return m;
  }, [result.assignments, result.underfilled]);

  // Group assignments by playerId. Engine already sorts them within-player by
  // state desc, so we can use the order as-is.
  const byPlayer = new Map<string, WarAssignment[]>();
  for (const a of result.assignments) {
    const list = byPlayer.get(a.playerId) ?? [];
    list.push(a);
    byPlayer.set(a.playerId, list);
  }

  // Players sorted by playerName; underfill catches anyone with < slotsPerPlayer.
  const playerIds = [...byPlayer.keys()];
  const underfilledIds = new Set(result.underfilled.map((u) => u.playerId));
  for (const u of result.underfilled) {
    if (!byPlayer.has(u.playerId)) byPlayer.set(u.playerId, []);
  }
  for (const id of byPlayer.keys()) {
    if (!playerIds.includes(id)) playerIds.push(id);
  }
  // Row order: strongest placement first (the user reads top-down expecting
  // "best defence first"). Within a player's row, slots are already sorted
  // state-desc by the engine, so [0] is that player's top placement. Fall
  // back to playerName when tier is tied (or for players with no placements).
  playerIds.sort((a, b) => {
    const aTop = byPlayer.get(a)?.[0];
    const bTop = byPlayer.get(b)?.[0];
    const aScore = aTop ? assignmentStateScore(aTop) : -Infinity;
    const bScore = bTop ? assignmentStateScore(bTop) : -Infinity;
    if (aScore !== bScore) return bScore - aScore;
    const an = aTop?.playerName ?? result.underfilled.find((u) => u.playerId === a)?.playerName ?? a;
    const bn = bTop?.playerName ?? result.underfilled.find((u) => u.playerId === b)?.playerName ?? b;
    return an.localeCompare(bn);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <h3 className="editorial-heading text-xl">
            {bgLabel ? `${bgLabel} placements` : 'Placements'}
          </h3>
          <div className="text-sm text-[var(--color-ink-soft)]">
            {result.totalPlaced} placed
            {result.underfilled.length > 0 &&
              ` · ${result.underfilled.length} player${
                result.underfilled.length === 1 ? '' : 's'
              } underfilled`}
          </div>
        </div>
        {bgLabel && (
          <WarPlacementExport
            result={result}
            championLookup={championLookup}
            slotsPerPlayer={slotsPerPlayer}
            bgLabel={bgLabel}
            printRef={printRef}
          />
        )}
      </div>

      <div ref={printRef} className="space-y-4 bg-[var(--color-paper-card)] p-4 rounded-lg border border-[var(--color-rule)]">

      {result.underfilled.length > 0 && (
        <div className="border border-[var(--color-marvel-impact)] bg-[var(--color-paper-soft)] rounded p-3 text-sm space-y-1">
          <div className="font-medium">Underfilled</div>
          <ul className="text-[var(--color-ink-soft)] space-y-0.5">
            {result.underfilled.map((u) => (
              <li key={u.playerId}>
                {u.playerName} — placed {u.assigned}/{u.needed}, needs{' '}
                {u.needed - u.assigned} more
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--color-ink-soft)] pt-1">
            Either expand your defender pool or lower the state floor and
            re-run.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-rule)]">
              <th className="text-left px-2 py-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)] w-32">
                Player
              </th>
              {Array.from({ length: slotsPerPlayer }, (_, i) => (
                <th
                  key={i}
                  className="text-left px-2 py-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]"
                >
                  Slot {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {playerIds.map((pid) => {
              const placements = byPlayer.get(pid) ?? [];
              const playerName =
                placements[0]?.playerName ??
                result.underfilled.find((u) => u.playerId === pid)?.playerName ??
                pid;
              const isUnderfilled = underfilledIds.has(pid);
              return [
                <tr
                  key={pid}
                  className="border-b border-[var(--color-rule)]/40"
                >
                  <td className="px-2 py-3 align-top w-32 max-w-32">
                    <div
                      className="font-medium text-sm truncate"
                      title={playerName}
                    >
                      {playerName}
                    </div>
                    <div
                      className={`text-xs ${
                        isUnderfilled
                          ? 'text-[var(--color-marvel-impact)]'
                          : 'text-[var(--color-ink-soft)]'
                      }`}
                    >
                      {placements.length}/{slotsPerPlayer}
                    </div>
                    {editable && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingPlayerId((cur) => (cur === pid ? null : pid))
                        }
                        className="text-[11px] text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline mt-1"
                        title={
                          editingPlayerId === pid
                            ? 'Stop editing this row'
                            : 'Swap in a different champion from this player’s roster'
                        }
                      >
                        {editingPlayerId === pid ? 'done' : 'edit'}
                      </button>
                    )}
                  </td>
                  {Array.from({ length: slotsPerPlayer }, (_, i) => {
                    const a = placements[i];
                    if (!a) {
                      return (
                        <td
                          key={i}
                          className="px-2 py-3 align-top text-xs text-[var(--color-ink-soft)] italic"
                        >
                          —
                        </td>
                      );
                    }
                    const c = championLookup.get(a.championId);
                    const champName = c?.name ?? a.championId;
                    const isEditingThisRow = editable && editingPlayerId === pid;
                    if (isEditingThisRow) {
                      const eligible = eligibleSwapsFor(
                        pid,
                        a.championId,
                        playerRosters,
                        placedChampionIds,
                        floorTier,
                      );
                      const closedLabel = `${champName} · R${a.rank}${a.ascension}`;
                      return (
                        <td
                          key={i}
                          className="px-2 py-3 align-top max-w-[11rem]"
                        >
                          <select
                            value={a.championId}
                            onChange={(e) => {
                              const next = eligible.find(
                                (s) => s.championId === e.target.value,
                              );
                              if (next && onSwap) {
                                onSwap(pid, a.championId, next);
                              }
                            }}
                            className="block w-full text-sm border border-[var(--color-rule)] rounded px-2 py-1.5 bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] truncate"
                            title={closedLabel}
                          >
                            {/* Currently-selected option gets the short label
                                so the closed display stays compact. Every
                                other option gets the full rank/asc/sig
                                breakdown so the open list is informative. On
                                swap, the newly-picked champ becomes the
                                selected one and instantly re-renders with
                                the short label. */}
                            <option value={a.championId}>{closedLabel}</option>
                            {eligible.map((state) => {
                              const oc = championLookup.get(state.championId);
                              const oname = oc?.name ?? state.championId;
                              return (
                                <option
                                  key={state.championId}
                                  value={state.championId}
                                >
                                  {oname} — R{state.rank} {state.ascension}
                                  {state.sig > 0 ? ` · sig ${state.sig}` : ''}
                                </option>
                              );
                            })}
                          </select>
                        </td>
                      );
                    }
                    const isOpen =
                      openInfo?.playerId === pid &&
                      openInfo?.championId === a.championId;
                    const cellContent = (
                      <div className="flex items-center gap-2">
                        <div className="relative shrink-0">
                          <ChampionPortrait
                            name={champName}
                            klass={c?.class ?? 'Tech'}
                            portraitUrl={c?.portraitUrl ?? null}
                            size={40}
                          />
                          <TierBadge tier={a.tier} />
                        </div>
                        <div className="min-w-0">
                          <div
                            className="text-sm font-medium truncate"
                            title={champName}
                          >
                            {champName}
                          </div>
                          <div className="text-[10px] font-mono text-[var(--color-ink-soft)]">
                            R{a.rank} {a.ascension}
                            {a.sig > 0 && ` · sig ${a.sig}`}
                          </div>
                        </div>
                      </div>
                    );
                    return (
                      <td
                        key={i}
                        className="px-2 py-3 align-top max-w-[11rem]"
                      >
                        {canShowCopies ? (
                          <button
                            type="button"
                            onClick={() =>
                              setOpenInfo((cur) =>
                                cur?.playerId === pid && cur?.championId === a.championId
                                  ? null
                                  : { playerId: pid, championId: a.championId },
                              )
                            }
                            aria-expanded={isOpen}
                            className={`w-full text-left rounded px-1 -mx-1 py-1 -my-1 cursor-pointer transition-colors ${
                              isOpen
                                ? 'bg-[var(--color-paper-soft)] ring-1 ring-[var(--color-marvel-editorial)]/40'
                                : 'hover:bg-[var(--color-paper-soft)]'
                            }`}
                            title={`Show other alliance copies of ${champName}`}
                          >
                            {cellContent}
                          </button>
                        ) : (
                          cellContent
                        )}
                      </td>
                    );
                  })}
                </tr>,
                openInfo?.playerId === pid && canShowCopies && playerRosters ? (
                  <tr key={`${pid}-info`} className="border-b border-[var(--color-rule)]/40">
                    <td
                      colSpan={slotsPerPlayer + 1}
                      className="px-2 py-3 bg-[var(--color-paper-soft)]/60"
                    >
                      <AllCopiesPanel
                        championId={openInfo.championId}
                        championLookup={championLookup}
                        playerRosters={playerRosters}
                        placementByChamp={placementByChamp}
                        playerNameById={playerNameById}
                        floorTier={floorTier}
                        anchorPlayerId={pid}
                        onClose={() => setOpenInfo(null)}
                      />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      {result.unavailableChamps.length > 0 && (
        <div className="text-xs text-[var(--color-ink-soft)] border-t border-[var(--color-rule)] pt-3">
          <span className="font-medium">In pool but unavailable: </span>
          {result.unavailableChamps
            .map((id) => championLookup.get(id)?.name ?? id)
            .join(', ')}
          <div className="mt-1 italic">
            No alliance member owns these at the current floor.
          </div>
        </div>
      )}

      {/* mcoc.help footer — always visible; anchors the export PNG so a
       *  shared image credits the source without extra chrome. */}
      <div className="flex items-baseline justify-end pt-2 border-t border-[var(--color-rule)]/60">
        <span className="editorial-heading text-xs text-[var(--color-ink-soft)] tracking-wider">
          mcoc.help
        </span>
      </div>
      </div>
    </div>
  );
}

/**
 * Read-only panel: click any placed defender to see every alliance copy of
 * that champion at ≥ floor, sorted strongest first. Marks the current
 * placement, tags stronger alternates for the officer's attention, and lets
 * them decide whether the algorithm's choice is the best available.
 *
 * No cross-player swap action here yet — the officer uses the existing
 * per-row "edit" affordance to orchestrate any shuffle. A one-click swap is
 * a follow-up (needs a designed conflict-resolution UI for evicting a slot
 * from the receiving player's row).
 */
function AllCopiesPanel({
  championId,
  championLookup,
  playerRosters,
  placementByChamp,
  playerNameById,
  floorTier,
  anchorPlayerId,
  onClose,
}: {
  championId: string;
  championLookup: Map<string, Champion>;
  playerRosters: Map<string, ChampionState[]>;
  placementByChamp: Map<string, WarAssignment>;
  playerNameById: Map<string, string>;
  floorTier: number;
  anchorPlayerId: string;
  onClose: () => void;
}) {
  const champ = championLookup.get(championId);
  const champName = champ?.name ?? championId;
  const currentPlacement = placementByChamp.get(championId);
  const currentTier = currentPlacement
    ? effectiveRank(currentPlacement.rank, currentPlacement.ascension)
    : 0;

  const copies: Array<{ playerId: string; state: ChampionState; tier: number }> = [];
  for (const [pid, roster] of playerRosters) {
    const state = roster.find((s) => s.championId === championId);
    if (!state) continue;
    const tier = effectiveRank(state.rank, state.ascension);
    if (tier < floorTier) continue;
    copies.push({ playerId: pid, state, tier });
  }
  copies.sort((a, b) => {
    if (a.tier !== b.tier) return b.tier - a.tier;
    if (a.state.sig !== b.state.sig) return b.state.sig - a.state.sig;
    return (playerNameById.get(a.playerId) ?? a.playerId).localeCompare(
      playerNameById.get(b.playerId) ?? b.playerId,
    );
  });

  const anchorState = copies.find((c) => c.playerId === anchorPlayerId)?.state;
  const anchorTier = anchorState
    ? effectiveRank(anchorState.rank, anchorState.ascension)
    : currentTier;
  const maxTier = copies[0]?.tier ?? 0;
  const hasStronger = maxTier > anchorTier;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <strong>{champName}</strong>{' '}
          <span className="text-[var(--color-ink-soft)]">
            — {copies.length} cop{copies.length === 1 ? 'y' : 'ies'} in this BG at ≥ floor
            {hasStronger && (
              <>
                {' '}·{' '}
                <span className="text-[var(--color-marvel-impact)]">
                  higher rank available
                </span>
              </>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline"
        >
          close
        </button>
      </div>
      {copies.length === 0 ? (
        <div className="text-xs italic text-[var(--color-ink-soft)]">
          No other copies at or above the current floor.
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {copies.map(({ playerId, state, tier }) => {
            const isCurrent =
              currentPlacement?.playerId === playerId;
            const isStrongerThanCurrent = tier > currentTier;
            const pname = playerNameById.get(playerId) ?? playerId;
            return (
              <li
                key={playerId}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none ${
                  isCurrent
                    ? 'border-[var(--color-marvel-editorial)] bg-[var(--color-marvel-editorial)]/10 text-[var(--color-marvel-editorial)] font-medium'
                    : isStrongerThanCurrent
                      ? 'border-[var(--color-marvel-impact)]/60 bg-[var(--color-marvel-impact)]/10 text-[var(--color-ink)]'
                      : 'border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink)]'
                }`}
                title={
                  isCurrent
                    ? 'Currently placed here'
                    : isStrongerThanCurrent
                      ? 'Stronger copy — consider swapping'
                      : 'Weaker or equal to current placement'
                }
              >
                <span className="font-medium">{pname}</span>
                <span className="font-mono text-[var(--color-ink-soft)]">
                  R{state.rank} {state.ascension}
                  {state.sig > 0 && ` s${state.sig}`}
                </span>
                {isCurrent && <span aria-hidden="true">·</span>}
                {isCurrent && <span>placed</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="text-[10px] text-[var(--color-ink-soft)] italic">
        Read-only — use the row&rsquo;s <em>edit</em> button to swap this
        player&rsquo;s slot, or manually shuffle across players.
      </div>
    </div>
  );
}

/**
 * Eligible swap targets for one slot: champs in the given player's roster at
 * ≥ floor, excluding everything already placed in this BG (except the slot
 * being swapped out itself, which is implicitly excluded by `championId !==
 * currentChampionId` since `placedChampionIds` contains it). Sorted by
 * effective tier desc, then name asc — strongest options first.
 */
function eligibleSwapsFor(
  playerId: string,
  currentChampionId: string,
  playerRosters: Map<string, ChampionState[]> | undefined,
  placedChampionIds: ReadonlySet<string>,
  floorTier: number,
): ChampionState[] {
  const roster = playerRosters?.get(playerId);
  if (!roster) return [];
  const list = roster.filter((s) => {
    if (s.championId === currentChampionId) return false;
    if (placedChampionIds.has(s.championId)) return false;
    if (effectiveRank(s.rank, s.ascension) < floorTier) return false;
    return true;
  });
  list.sort((a, b) => {
    const at = effectiveRank(a.rank, a.ascension);
    const bt = effectiveRank(b.rank, b.ascension);
    if (at !== bt) return bt - at;
    if (a.sig !== b.sig) return b.sig - a.sig;
    return a.championId.localeCompare(b.championId);
  });
  return list;
}
