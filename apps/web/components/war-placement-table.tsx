'use client';

import { useMemo, useState } from 'react';
import {
  assignmentStateScore,
  effectiveRank,
  type Ascension,
  type Champion,
  type ChampionState,
  type Rank,
  type WarAssignment,
  type WarResult,
} from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';

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
}) {
  const editable = Boolean(onSwap && playerRosters && floor);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const floorTier = floor ? effectiveRank(floor.rank, floor.ascension) : 0;

  // championIds occupying a slot in this BG — any swap candidate must NOT be
  // in this set (except the slot being swapped out, handled per-cell).
  const placedChampionIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of result.assignments) s.add(a.championId);
    return s;
  }, [result.assignments]);

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
      <div className="flex flex-wrap gap-x-6 gap-y-2 items-baseline">
        <h3 className="editorial-heading text-xl">Placements</h3>
        <div className="text-sm text-[var(--color-ink-soft)]">
          {result.totalPlaced} placed
          {result.underfilled.length > 0 &&
            ` · ${result.underfilled.length} player${
              result.underfilled.length === 1 ? '' : 's'
            } underfilled`}
        </div>
      </div>

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
              return (
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
                            className="w-full text-sm border border-[var(--color-rule)] rounded px-2 py-1.5 bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
                            title="Swap this slot for another champion in this player’s roster"
                          >
                            <option value={a.championId}>
                              {champName} — R{a.rank} {a.ascension}
                              {a.sig > 0 ? ` · sig ${a.sig}` : ''}
                            </option>
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
                    return (
                      <td
                        key={i}
                        className="px-2 py-3 align-top max-w-[11rem]"
                      >
                        <div className="flex items-center gap-2">
                          <ChampionPortrait
                            name={champName}
                            klass={c?.class ?? 'Tech'}
                            portraitUrl={c?.portraitUrl ?? null}
                            size={40}
                          />
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
                      </td>
                    );
                  })}
                </tr>
              );
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
