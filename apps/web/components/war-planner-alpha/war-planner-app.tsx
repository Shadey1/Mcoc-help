'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  solvePlacement,
  seasonWhereLabel,
  seasonPathOf,
  explainPlacement,
  type BgIndex,
  type Champion,
  type ChampionId,
  type NodeNumber,
  type NodePlacement,
  type PlaceResult,
  type PlayerId,
  type SeasonPlan,
  type WarPlayer,
} from '@prestige-tools/engine';
import type { Season } from '../../../../data/aw/season-69.schema';
import { defenderValueMap } from '../../lib/war-planner-data';
import { SeasonMap } from './season-map';
import {
  addPick,
  clearAllPicks,
  clearPin,
  isEditedFromGuide,
  movePick,
  newPlan,
  picksAt,
  removePick,
  resetAllPicks,
  resetNodePicks,
  setNodePicks,
  setPin,
  setStrict,
  toggleKeyNode,
  togglePlayerExcluded,
} from './plan-model';
import { fetchShare } from '../../lib/share-client';

/**
 * Season war planner root — Alpha.
 *
 * State model:
 *   plansByBg[bg]      — the editable SeasonPlan for each BG
 *   playersByBg[bg]    — loaded WarPlayer[] for each BG (from share links)
 *   floor              — minimum eligible state (reuses diversity tool ladder)
 *   activeBg           — current BG being edited
 *   result             — last solve output for the active BG; drives ring
 *                        styling, per-node result cards, and the map reveal
 *   selectedNode       — the node open in the Node tab
 *
 * The solve function is called explicitly when the officer presses
 * "Place defence"; small state edits (add a pick, toggle key) don't
 * auto-solve — an unsolved edit clears the last result to make it obvious
 * a re-solve is required. Mirrors the mockup's UX.
 *
 * Roster loading uses `fetchShare(id)` for each pasted share ID. Failed
 * loads surface as row-level errors and don't block a partial solve.
 */

type WarPlannerAppProps = {
  champions: Champion[];
  season: Season;
};

type Tab = 'node' | 'placement' | 'battlegroup';

type RosterRow = {
  input: string;
  status: 'idle' | 'loading' | 'ok' | 'error';
  playerId?: PlayerId;
  playerName?: string;
  error?: string;
  roster?: WarPlayer['roster'];
};

const BG_LABELS: Record<BgIndex, string> = { 1: 'BG1', 2: 'BG2', 3: 'BG3' };
const BG_INDICES: readonly BgIndex[] = [1, 2, 3];

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

function shareIdFrom(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/([A-Za-z0-9]{8})(?:$|[^A-Za-z0-9])/);
  return m ? m[1]! : null;
}

function emptyRosterRows(): RosterRow[] {
  return Array.from({ length: 10 }, () => ({ input: '', status: 'idle' as const }));
}

export function WarPlannerApp({ champions, season }: WarPlannerAppProps) {
  const championById = useMemo(() => {
    const m = new Map<ChampionId, Champion>();
    for (const c of champions) m.set(c.id, c);
    return m;
  }, [champions]);
  const championIdByName = useMemo(() => {
    const m = new Map<string, ChampionId>();
    for (const c of champions) m.set(c.name.toLowerCase(), c.id);
    return m;
  }, [champions]);
  const dvMap = useMemo(() => defenderValueMap(), []);

  const [activeBg, setActiveBg] = useState<BgIndex>(1);
  const [plansByBg, setPlansByBg] = useState<Record<BgIndex, SeasonPlan>>(() => ({
    1: newPlan(season, 1),
    2: newPlan(season, 2),
    3: newPlan(season, 3),
  }));
  const [rostersByBg, setRostersByBg] = useState<Record<BgIndex, RosterRow[]>>(() => ({
    1: emptyRosterRows(),
    2: emptyRosterRows(),
    3: emptyRosterRows(),
  }));
  const [resultByBg, setResultByBg] = useState<Record<BgIndex, PlaceResult | null>>({
    1: null,
    2: null,
    3: null,
  });
  const [floorRank, setFloorRank] = useState<4 | 5 | 6>(4);
  const [floorAsc, setFloorAsc] = useState<'A0' | 'A1' | 'A2'>('A0');
  const [tab, setTab] = useState<Tab>('node');
  const [selectedNode, setSelectedNode] = useState<NodeNumber | null>(null);

  const plan = plansByBg[activeBg]!;
  const result = resultByBg[activeBg];
  const rosterRows = rostersByBg[activeBg]!;

  // Convert loaded roster rows into WarPlayers for the engine.
  const players: WarPlayer[] = useMemo(() => {
    return rosterRows
      .filter((r) => r.status === 'ok' && r.playerId && r.roster)
      .map((r) => ({
        id: r.playerId!,
        name: r.playerName ?? r.playerId!,
        roster: r.roster!,
      }));
  }, [rosterRows]);

  const moved = useMemo(() => new Set(result?.moved ?? []), [result]);

  // ── Solve trigger ───────────────────────────────────────────────────
  const solve = useCallback(() => {
    if (players.length === 0) return;
    const nextResult = solvePlacement({
      plan: { ...plan, lastPlacement: result?.placements },
      players,
      floor: { rank: floorRank, ascension: floorAsc },
      defenderValues: dvMap,
    });
    setResultByBg((prev) => ({ ...prev, [activeBg]: nextResult }));
    if (tab === 'battlegroup') setTab('placement');
  }, [plan, players, result, floorRank, floorAsc, dvMap, activeBg, tab]);

  // An edit that changes what the solver would return invalidates the
  // previous result — the officer needs to re-press "Place defence" to
  // see the effect. This mirrors the mockup: `invalidate()` clears
  // `state.result` on any pick/pin/key/exclude change.
  const invalidate = useCallback(() => {
    setResultByBg((prev) => ({ ...prev, [activeBg]: null }));
  }, [activeBg]);

  const mutatePlan = useCallback(
    (mutator: (p: SeasonPlan) => SeasonPlan) => {
      setPlansByBg((prev) => ({ ...prev, [activeBg]: mutator(prev[activeBg]!) }));
      invalidate();
    },
    [activeBg, invalidate],
  );

  // ── Roster loading ──────────────────────────────────────────────────
  const loadRow = useCallback(
    async (bg: BgIndex, rowIdx: number, input: string) => {
      const id = shareIdFrom(input);
      if (!id) {
        setRostersByBg((prev) => {
          const rows = [...prev[bg]!];
          rows[rowIdx] = { input, status: 'idle' };
          return { ...prev, [bg]: rows };
        });
        return;
      }
      setRostersByBg((prev) => {
        const rows = [...prev[bg]!];
        rows[rowIdx] = { input, status: 'loading' };
        return { ...prev, [bg]: rows };
      });
      try {
        const payload = await fetchShare(id);
        const playerId = id;
        const playerName = payload.label?.trim() || `Player ${rowIdx + 1}`;
        setRostersByBg((prev) => {
          const rows = [...prev[bg]!];
          rows[rowIdx] = {
            input,
            status: 'ok',
            playerId,
            playerName,
            roster: payload.champions,
          };
          return { ...prev, [bg]: rows };
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setRostersByBg((prev) => {
          const rows = [...prev[bg]!];
          rows[rowIdx] = { input, status: 'error', error: msg };
          return { ...prev, [bg]: rows };
        });
      }
    },
    [],
  );

  const handleRowChange = useCallback(
    (rowIdx: number, next: string) => {
      const bg = activeBg;
      setRostersByBg((prev) => {
        const rows = [...prev[bg]!];
        rows[rowIdx] = { ...rows[rowIdx]!, input: next };
        return { ...prev, [bg]: rows };
      });
      void loadRow(bg, rowIdx, next);
    },
    [activeBg, loadRow],
  );

  // ── Callbacks passed to map ─────────────────────────────────────────
  const championNameFor = useCallback(
    (id: ChampionId): string => championById.get(id)?.name ?? id,
    [championById],
  );
  const championShortFor = useCallback(
    (id: ChampionId): string => {
      const c = championById.get(id);
      if (!c) return id;
      // Prefer surname if the full name is >12 chars — matches the
      // mockup's `short` fallback trick without needing a bespoke field.
      if (c.name.length <= 12) return c.name;
      const parts = c.name.split(/[\s-]+/);
      return parts.length > 1 ? parts[parts.length - 1]! : c.name;
    },
    [championById],
  );
  const playerNameFor = useCallback(
    (id: PlayerId): string => {
      const row = rosterRows.find((r) => r.playerId === id);
      return row?.playerName ?? id;
    },
    [rosterRows],
  );

  const onSelectNode = useCallback((n: NodeNumber) => {
    setSelectedNode(n);
    setTab('node');
  }, []);

  // Explanation trace map for the node panel — computed lazily per solve.
  const explanationLookup = useMemo(() => {
    if (!result) return null;
    const placementsByChampion = new Map<
      ChampionId,
      { node: NodeNumber; playerId: PlayerId }
    >();
    for (const [nStr, pl] of Object.entries(result.placements)) {
      placementsByChampion.set(pl.championId, {
        node: Number(nStr) as NodeNumber,
        playerId: pl.playerId,
      });
    }
    const owners = new Map<ChampionId, PlayerId[]>();
    for (const p of players) {
      for (const s of p.roster) {
        const list = owners.get(s.championId);
        if (list) list.push(p.id);
        else owners.set(s.championId, [p.id]);
      }
    }
    return { placementsByChampion, owners };
  }, [result, players]);

  return (
    <section className="space-y-4">
      {/* Top control bar */}
      <div className="flex flex-wrap items-center gap-3 py-3 border-y border-[var(--color-rule)]">
        <div className="inline-flex rounded-md border border-[var(--color-rule)] overflow-hidden">
          {BG_INDICES.map((bg) => (
            <button
              key={bg}
              type="button"
              onClick={() => setActiveBg(bg)}
              aria-pressed={activeBg === bg}
              className={`px-3 py-1.5 text-sm ${
                activeBg === bg
                  ? 'bg-[var(--color-paper-soft)] text-[var(--color-ink)] font-medium'
                  : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-soft)]'
              }`}
            >
              {BG_LABELS[bg]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => mutatePlan(resetAllPicks)}
          className="px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded-md hover:border-[var(--color-marvel-impact)] hover:text-[var(--color-marvel-impact)]"
        >
          Reset all to guide picks
        </button>
        <button
          type="button"
          onClick={() => mutatePlan(clearAllPicks)}
          className="px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded-md hover:border-[var(--color-marvel-impact)] hover:text-[var(--color-marvel-impact)]"
        >
          Clear all picks
        </button>
        <label className="inline-flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={plan.strict}
            onChange={(e) => mutatePlan((p) => setStrict(p, e.target.checked))}
            className="accent-[var(--color-marvel-impact)]"
          />
          Only use listed picks
        </label>
        <FloorSelector
          rank={floorRank}
          asc={floorAsc}
          onChange={(r, a) => {
            setFloorRank(r);
            setFloorAsc(a);
            invalidate();
          }}
        />
        <button
          type="button"
          onClick={solve}
          disabled={players.length === 0}
          className="ml-auto px-4 py-2 text-sm font-medium bg-[var(--color-marvel-impact)] text-white rounded-md hover:bg-[var(--color-marvel-editorial)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Place defence
        </button>
      </div>

      {/* Roster health banner */}
      {players.length === 0 && (
        <div className="border border-dashed border-[var(--color-rule)] rounded-md p-4 text-sm text-[var(--color-ink-soft)]">
          Load BG rosters below or in the <strong>Battlegroup</strong> tab. Paste
          share IDs or full <code>/r/?share=…</code> URLs, one per player.
        </div>
      )}

      {/* Two-column layout: map on the left, sticky panel on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
        <SeasonMap
          plan={plan}
          placements={result?.placements ?? null}
          moved={moved}
          selectedNode={selectedNode}
          onSelectNode={onSelectNode}
          championNameFor={championNameFor}
          championShortFor={championShortFor}
          playerNameFor={playerNameFor}
        />
        <aside className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] flex flex-col">
          <div className="flex border-b border-[var(--color-rule)]" role="tablist">
            {(['node', 'placement', 'battlegroup'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2.5 text-sm ${
                  tab === t
                    ? 'text-[var(--color-ink)] font-medium border-b-2 border-[var(--color-marvel-editorial)] -mb-px'
                    : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
                }`}
              >
                {t === 'node' ? 'Node' : t === 'placement' ? 'Placement' : 'Battlegroup'}
              </button>
            ))}
          </div>
          <div className="p-4 overflow-y-auto">
            {tab === 'node' && (
              <NodePanel
                plan={plan}
                selectedNode={selectedNode}
                result={result}
                players={players}
                champions={champions}
                championById={championById}
                championIdByName={championIdByName}
                explanationLookup={explanationLookup}
                mutatePlan={mutatePlan}
                playerNameFor={playerNameFor}
              />
            )}
            {tab === 'placement' && (
              <PlacementPanel
                plan={plan}
                result={result}
                players={players}
                championById={championById}
                playerNameFor={playerNameFor}
              />
            )}
            {tab === 'battlegroup' && (
              <BattlegroupPanel
                rosterRows={rosterRows}
                onRowChange={handleRowChange}
                plan={plan}
                mutatePlan={mutatePlan}
              />
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Node panel
// ─────────────────────────────────────────────────────────────────────────

type NodePanelProps = {
  plan: SeasonPlan;
  selectedNode: NodeNumber | null;
  result: PlaceResult | null | undefined;
  players: WarPlayer[];
  champions: Champion[];
  championById: Map<ChampionId, Champion>;
  championIdByName: Map<string, ChampionId>;
  explanationLookup: {
    placementsByChampion: Map<ChampionId, { node: NodeNumber; playerId: PlayerId }>;
    owners: Map<ChampionId, PlayerId[]>;
  } | null;
  mutatePlan: (m: (p: SeasonPlan) => SeasonPlan) => void;
  playerNameFor: (id: PlayerId) => string;
};

function NodePanel({
  plan,
  selectedNode,
  result,
  players,
  champions,
  championById,
  championIdByName,
  explanationLookup,
  mutatePlan,
  playerNameFor,
}: NodePanelProps) {
  const [addPickInput, setAddPickInput] = useState('');
  const [pinChampInput, setPinChampInput] = useState('');
  const [pinPlayer, setPinPlayer] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  // Reset transient inputs when the selected node changes so a leftover
  // pick doesn't spill into the next node's UI.
  useEffect(() => {
    setAddPickInput('');
    setPinChampInput('');
    setPinPlayer('');
    setPinMsg(null);
  }, [selectedNode]);

  const ownersMap = useMemo(() => {
    const m = new Map<ChampionId, PlayerId[]>();
    for (const p of players) {
      for (const s of p.roster) {
        const list = m.get(s.championId);
        if (list) list.push(p.id);
        else m.set(s.championId, [p.id]);
      }
    }
    return m;
  }, [players]);

  if (selectedNode === null) {
    return (
      <div>
        <h2 className="editorial-heading text-2xl mb-1">Pick a node</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Tap any node on the map to see the guide&apos;s picks, reorder them,
          or pin a defender there.
        </p>
        <p className="text-xs text-[var(--color-ink-soft)] mt-3 opacity-70">
          Key nodes get first claim when two nodes want the same defender. Pins
          beat everything.
        </p>
      </div>
    );
  }

  const picks = picksAt(plan, selectedNode);
  const nodeResult = result?.placements[selectedNode];
  const pin = plan.pins[selectedNode];
  const pathBuff = seasonPathOf(selectedNode);
  const location = seasonWhereLabel(selectedNode);

  const resolveByName = (raw: string): ChampionId | null =>
    championIdByName.get(raw.trim().toLowerCase()) ?? null;

  const explanation =
    result && nodeResult && explanationLookup
      ? explainPlacement(
          selectedNode,
          nodeResult.pickRank,
          plan,
          explanationLookup.placementsByChampion,
          explanationLookup.owners,
        )
      : [];

  return (
    <div>
      <h2 className="editorial-heading text-2xl mb-0.5">Node {selectedNode}</h2>
      <p className="text-sm text-[var(--color-ink-soft)]">
        {location}
        {pathBuff !== null ? ` — path ${pathBuff}` : ''}
      </p>
      {/* Key toggle */}
      <label className="inline-flex items-center gap-2 text-sm text-[var(--color-ink-soft)] mt-3">
        <input
          type="checkbox"
          checked={plan.keyNodes.has(selectedNode)}
          onChange={() => mutatePlan((p) => toggleKeyNode(p, selectedNode))}
          className="accent-[var(--color-marvel-impact)]"
        />
        Key node
      </label>

      {/* Pin block */}
      <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mt-5 mb-2">
        Pin a defender
      </h3>
      {pin ? (
        <div className="flex justify-between items-center gap-2 p-2.5 bg-[var(--color-paper-soft)] rounded-md border-l-4 border-[#d9a93f]">
          <div className="text-sm">
            <strong>{championById.get(pin.championId)?.name ?? pin.championId}</strong>
            <span className="text-[var(--color-ink-soft)] text-xs ml-2">
              {pin.playerId != null
                ? `${playerNameFor(pin.playerId)}'s copy`
                : 'whoever has a free slot'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => mutatePlan((p) => clearPin(p, selectedNode))}
            className="text-xs px-2 py-1 border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
          >
            Unpin
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
          <input
            type="text"
            list="champion-list"
            value={pinChampInput}
            onChange={(e) => {
              setPinChampInput(e.target.value);
              setPinMsg(null);
            }}
            placeholder="Champion"
            aria-label="Champion to pin"
            className="min-w-0 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          />
          <select
            value={pinPlayer}
            onChange={(e) => setPinPlayer(e.target.value)}
            aria-label="Whose copy"
            className="px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
          >
            <option value="">Any owner</option>
            {(() => {
              const c = resolveByName(pinChampInput);
              if (!c) return null;
              return (ownersMap.get(c) ?? []).map((pid) => (
                <option key={pid} value={pid}>
                  {playerNameFor(pid)}
                </option>
              ));
            })()}
          </select>
          <button
            type="button"
            onClick={() => {
              const c = resolveByName(pinChampInput);
              if (!c) {
                setPinMsg('Pick a champion from the list.');
                return;
              }
              const owners = ownersMap.get(c) ?? [];
              if (owners.length === 0) {
                setPinMsg(`Nobody in the BG owns ${championById.get(c)?.name ?? c}.`);
                return;
              }
              const playerId = pinPlayer || null;
              if (playerId !== null && !owners.includes(playerId)) {
                setPinMsg('That player does not own the champion.');
                return;
              }
              mutatePlan((p) => setPin(p, selectedNode, { championId: c, playerId }));
              setPinChampInput('');
              setPinPlayer('');
              setPinMsg(null);
            }}
            className="px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
          >
            Pin
          </button>
          <p className="col-span-3 text-xs text-[var(--color-ink-soft)] opacity-70 mt-1">
            {pinMsg ?? 'Overrides picks and the planner. Everything else re-places around it.'}
          </p>
        </div>
      )}

      {/* Picks list */}
      <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mt-5 mb-2">
        Picks, in order of preference{' '}
        <span className="opacity-70">
          {picks.length} of 8{picks.length > 0 && (isEditedFromGuide(plan, selectedNode) ? ', edited' : ', from guide')}
        </span>
      </h3>
      {picks.length > 0 ? (
        <ol className="border-t border-[var(--color-rule)]">
          {picks.map((c, i) => {
            const ownCount = ownersMap.get(c)?.length ?? 0;
            return (
              <li
                key={`${c}-${i}`}
                className="grid grid-cols-[22px_1fr_auto_auto] items-center gap-2 py-1.5 border-b border-[var(--color-rule)]"
              >
                <span className="text-right text-xs text-[var(--color-ink-soft)] font-serif">
                  {i + 1}
                </span>
                <span className="text-sm">{championById.get(c)?.name ?? c}</span>
                <span
                  className={`text-xs ${ownCount === 0 ? 'text-[var(--color-marvel-editorial)]' : 'text-[var(--color-ink-soft)]'}`}
                >
                  {ownCount === 0 ? 'nobody owns' : `${ownCount} own`}
                </span>
                <span className="flex gap-0.5">
                  <IconButton
                    label={`Pin ${championById.get(c)?.name ?? c} here`}
                    onClick={() => {
                      if (ownCount === 0) return;
                      mutatePlan((p) => setPin(p, selectedNode, { championId: c, playerId: null }));
                    }}
                    title="Pin here"
                  >
                    ⌘
                  </IconButton>
                  <IconButton
                    label="Move up"
                    disabled={i === 0}
                    onClick={() => mutatePlan((p) => movePick(p, selectedNode, i, -1))}
                  >
                    ▲
                  </IconButton>
                  <IconButton
                    label="Move down"
                    disabled={i === picks.length - 1}
                    onClick={() => mutatePlan((p) => movePick(p, selectedNode, i, +1))}
                  >
                    ▼
                  </IconButton>
                  <IconButton
                    label="Remove"
                    onClick={() => mutatePlan((p) => removePick(p, selectedNode, i))}
                  >
                    ✕
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-[var(--color-ink-soft)] italic">
          No picks. The planner fills this node from what&apos;s left.
        </p>
      )}
      {picks.length < 8 && (
        <input
          type="text"
          list="champion-list"
          value={addPickInput}
          onChange={(e) => setAddPickInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const c = resolveByName(addPickInput);
              if (c) {
                mutatePlan((p) => addPick(p, selectedNode, c));
                setAddPickInput('');
              }
            }
          }}
          placeholder="Add a defender"
          aria-label="Add a defender"
          className="w-full mt-2 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
        />
      )}
      {isEditedFromGuide(plan, selectedNode) && (
        <button
          type="button"
          onClick={() => mutatePlan((p) => resetNodePicks(p, selectedNode))}
          className="mt-2 text-xs px-2 py-1 border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
        >
          Reset to guide picks
        </button>
      )}

      {/* Result card */}
      {result && (
        <div
          className={`mt-5 p-3 rounded-md border-l-4 ${
            !nodeResult
              ? 'bg-[var(--color-paper-soft)] border-[var(--color-marvel-impact)]'
              : nodeResult.pinned
                ? 'bg-[var(--color-paper-soft)] border-[#d9a93f]'
                : nodeResult.pickRank >= 0
                  ? 'bg-[var(--color-paper-soft)] border-[#d9a93f]'
                  : 'bg-[var(--color-paper-soft)] border-[var(--color-rule)]'
          }`}
        >
          {!nodeResult ? (
            <>
              <div className="font-serif text-xl">Unfilled</div>
              <div className="text-sm text-[var(--color-ink-soft)]">
                {result.unfilled.find((u) => u.node === selectedNode)?.reason ??
                  'No eligible champion with a free slot.'}
              </div>
            </>
          ) : (
            <>
              <div className="font-serif text-xl">
                {championById.get(nodeResult.championId)?.name ?? nodeResult.championId}
              </div>
              <div className="text-sm text-[var(--color-ink-soft)]">
                {playerNameFor(nodeResult.playerId)} places it,{' '}
                {nodeResult.pinned
                  ? 'pinned'
                  : nodeResult.pickRank >= 0
                    ? `${ORDINAL[nodeResult.pickRank] ?? nodeResult.pickRank + 'th'} choice`
                    : nodeResult.pickRank === -1
                      ? 'not on the list'
                      : "planner's choice"}
              </div>
              {explanation.length > 0 && (
                <ul className="list-disc pl-5 mt-2 text-xs text-[var(--color-ink-soft)] space-y-0.5">
                  {explanation.slice(0, 4).map((line, i) => (
                    <li key={i}>
                      {ORDINAL[line.pickIndex] ?? `${line.pickIndex + 1}th`}{' '}
                      pick {championById.get(line.championId)?.name ?? line.championId}
                      {line.reason === 'placed-elsewhere' && (
                        <>
                          : placed on node {line.placedNode} by{' '}
                          {playerNameFor(line.placedBy!)}
                        </>
                      )}
                      {line.reason === 'nobody-owns' && ': nobody in the BG has them'}
                      {line.reason === 'no-free-slot' &&
                        ": owners' five slots were worth more elsewhere"}
                    </li>
                  ))}
                </ul>
              )}
              {!pin && (
                <button
                  type="button"
                  onClick={() =>
                    mutatePlan((p) =>
                      setPin(p, selectedNode, {
                        championId: nodeResult.championId,
                        playerId: nodeResult.playerId,
                      }),
                    )
                  }
                  className="mt-2 text-xs px-2 py-1 border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
                >
                  Pin this placement
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Champion datalist shared across the pin + add inputs. */}
      <datalist id="champion-list">
        {champions.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  label,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className="w-6 h-6 rounded text-xs text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Placement panel
// ─────────────────────────────────────────────────────────────────────────

function PlacementPanel({
  plan,
  result,
  players,
  championById,
  playerNameFor,
}: {
  plan: SeasonPlan;
  result: PlaceResult | null | undefined;
  players: WarPlayer[];
  championById: Map<ChampionId, Champion>;
  playerNameFor: (id: PlayerId) => string;
}) {
  const copyBtnRef = useRef<HTMLButtonElement | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  if (!result) {
    return (
      <div>
        <h2 className="editorial-heading text-2xl mb-1">Not placed yet</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Load rosters and press <strong>Place defence</strong> to see who puts
          what where.
        </p>
      </div>
    );
  }

  const vals = Object.values(result.placements);
  const first = vals.filter((v) => v.pickRank === 0).length;
  const lower = vals.filter((v) => v.pickRank > 0).length;
  const auto = vals.filter((v) => v.pickRank < 0 && !v.pinned).length;
  const miss = result.unfilled.length;

  const copyForChat = async () => {
    const lines = players
      .filter((p) => !plan.excludedPlayers.has(p.id))
      .map((p) => {
        const mine = Object.entries(result.placements)
          .filter(([, v]) => v.playerId === p.id)
          .sort(([a], [b]) => Number(b) - Number(a))
          .map(([n, v]) => `${n} ${championById.get(v.championId)?.name ?? v.championId}`)
          .join(', ');
        return `${p.name}: ${mine}`;
      });
    const txt = `BG${plan.bg} defence\n${lines.join('\n')}`;
    try {
      await navigator.clipboard.writeText(txt);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
    setTimeout(() => setCopyStatus('idle'), 1600);
  };

  return (
    <div>
      <h2 className="editorial-heading text-2xl mb-0.5">Placement</h2>
      <p className="text-sm text-[var(--color-ink-soft)]">
        BG{plan.bg}, no duplicates.
      </p>
      <div className="grid grid-cols-4 gap-2 mt-3">
        <Stat n={first} label="first choice" />
        <Stat n={lower} label="lower pick" />
        <Stat n={auto} label="planner" />
        <Stat n={miss} label="unfilled" tone={miss > 0 ? 'warn' : 'neutral'} />
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          ref={copyBtnRef}
          onClick={copyForChat}
          className="px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
        >
          {copyStatus === 'copied'
            ? 'Copied'
            : copyStatus === 'error'
              ? 'Copy failed'
              : 'Copy for chat'}
        </button>
      </div>

      {result.moved.length > 0 && (
        <>
          <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mt-5 mb-2">
            Moved by your last change
          </h3>
          <ol className="text-sm space-y-0.5">
            {[...result.moved]
              .sort((a, b) => b - a)
              .map((n) => {
                const before = plan.lastPlacement?.[n];
                const after = result.placements[n];
                return (
                  <li key={n} className="flex gap-2">
                    <b className="w-8 text-right text-[#d9a93f]">{n}</b>
                    <span className="text-[var(--color-ink-soft)]">
                      {before ? championById.get(before.championId)?.name : 'empty'} →{' '}
                      {after
                        ? `${championById.get(after.championId)?.name} (${playerNameFor(after.playerId)})`
                        : 'empty'}
                    </span>
                  </li>
                );
              })}
          </ol>
        </>
      )}

      <div className="mt-5 space-y-2">
        {players
          .filter((p) => !plan.excludedPlayers.has(p.id))
          .map((p) => {
            const mine = Object.entries(result.placements)
              .filter(([, v]) => v.playerId === p.id)
              .sort(([a], [b]) => Number(b) - Number(a));
            return (
              <div
                key={p.id}
                className="border-t border-[var(--color-rule)] pt-2"
              >
                <div className="flex justify-between items-center text-sm">
                  <strong>{p.name}</strong>
                  <span className="text-xs text-[var(--color-ink-soft)] opacity-70">
                    {mine.length} of 5
                  </span>
                </div>
                <ol className="text-sm text-[var(--color-ink-soft)]">
                  {mine.map(([n, v]) => (
                    <li key={n} className="flex gap-2">
                      <b className="w-8 text-right text-[var(--color-ink)]">{n}</b>
                      <span>{championById.get(v.championId)?.name ?? v.championId}</span>
                      <span className="ml-auto text-xs opacity-70">
                        {v.pinned
                          ? 'pinned'
                          : v.pickRank >= 0
                            ? ORDINAL[v.pickRank] ?? `${v.pickRank + 1}th`
                            : v.pickRank === -1
                              ? 'off list'
                              : 'planner'}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function Stat({
  n,
  label,
  tone = 'neutral',
}: {
  n: number;
  label: string;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <div className="bg-[var(--color-paper-soft)] rounded-md p-2.5">
      <div
        className={`font-serif text-2xl leading-tight ${
          tone === 'warn' && n > 0 ? 'text-[var(--color-marvel-editorial)]' : ''
        }`}
      >
        {n}
      </div>
      <div className="text-[11px] text-[var(--color-ink-soft)]">{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Battlegroup panel
// ─────────────────────────────────────────────────────────────────────────

function BattlegroupPanel({
  rosterRows,
  onRowChange,
  plan,
  mutatePlan,
}: {
  rosterRows: RosterRow[];
  onRowChange: (rowIdx: number, next: string) => void;
  plan: SeasonPlan;
  mutatePlan: (m: (p: SeasonPlan) => SeasonPlan) => void;
}) {
  const okCount = rosterRows.filter((r) => r.status === 'ok').length;
  return (
    <div>
      <h2 className="editorial-heading text-2xl mb-0.5">Battlegroup {plan.bg}</h2>
      <p className="text-sm text-[var(--color-ink-soft)]">
        {okCount} of 10 rosters loaded. Paste share IDs or full{' '}
        <code>/r/?share=…</code> URLs.
      </p>
      <ul className="mt-4 space-y-1.5">
        {rosterRows.map((row, i) => {
          const excluded = row.playerId
            ? plan.excludedPlayers.has(row.playerId)
            : false;
          return (
            <li key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={row.input}
                onChange={(e) => onRowChange(i, e.target.value)}
                placeholder={`Player ${i + 1} — share ID or URL`}
                aria-label={`Player ${i + 1} share`}
                className={`flex-1 min-w-0 px-2 py-1.5 text-sm border rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] ${
                  row.status === 'error'
                    ? 'border-[var(--color-marvel-impact)]'
                    : row.status === 'ok'
                      ? 'border-[var(--color-rule)]'
                      : 'border-[var(--color-rule)]'
                }`}
              />
              <div className="text-xs w-32 text-[var(--color-ink-soft)] truncate">
                {row.status === 'loading' && 'loading…'}
                {row.status === 'ok' && (
                  <>
                    <span className="text-[var(--color-ink)]">
                      {row.playerName}
                    </span>{' '}
                    <span className="opacity-70">
                      ({row.roster?.length} champs)
                    </span>
                  </>
                )}
                {row.status === 'error' && (
                  <span className="text-[var(--color-marvel-editorial)]">
                    {row.error?.slice(0, 40)}
                  </span>
                )}
              </div>
              {row.status === 'ok' && row.playerId && (
                <label className="flex items-center gap-1 text-xs text-[var(--color-ink-soft)]">
                  <input
                    type="checkbox"
                    checked={excluded}
                    onChange={() =>
                      mutatePlan((p) => togglePlayerExcluded(p, row.playerId!))
                    }
                    className="accent-[var(--color-marvel-impact)]"
                  />
                  absent
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Floor selector — matches the diversity tool's ladder
// ─────────────────────────────────────────────────────────────────────────

function FloorSelector({
  rank,
  asc,
  onChange,
}: {
  rank: 4 | 5 | 6;
  asc: 'A0' | 'A1' | 'A2';
  onChange: (rank: 4 | 5 | 6, asc: 'A0' | 'A1' | 'A2') => void;
}) {
  const options: Array<{ label: string; rank: 4 | 5 | 6; asc: 'A0' | 'A1' | 'A2' }> = [
    { label: 'R4 min', rank: 4, asc: 'A0' },
    { label: 'R4 A1 / R5 A0', rank: 4, asc: 'A1' },
    { label: 'R4 A2 / R5 A1', rank: 4, asc: 'A2' },
    { label: 'R5 A2 / R6 A0', rank: 5, asc: 'A2' },
    { label: 'R6 A2', rank: 6, asc: 'A2' },
  ];
  const value = `${rank}-${asc}`;
  return (
    <label className="inline-flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
      <span>Floor</span>
      <select
        value={value}
        onChange={(e) => {
          const opt = options.find((o) => `${o.rank}-${o.asc}` === e.target.value)!;
          onChange(opt.rank, opt.asc);
        }}
        className="px-2 py-1 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
      >
        {options.map((o) => (
          <option key={`${o.rank}-${o.asc}`} value={`${o.rank}-${o.asc}`}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
