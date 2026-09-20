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
import type { Season } from '../../../../data/aw/season.schema';
import { defenderValueMap } from '../../lib/war-planner-data';
import { SeasonMap } from './season-map';
import {
  addPick,
  clearAllPicks,
  clearPin,
  guideTopPicks,
  isEditedFromGuide,
  movePick,
  newPlan,
  picksAt,
  removePick,
  reorderPick,
  resetAllPicks,
  resetNodePicks,
  setNodePicks,
  setPin,
  setStrict,
  toggleKeyNode,
} from './plan-model';
import { fetchShare } from '../../lib/share-client';
import { fetchSharedBg } from '../../lib/share-bg-client';
import { extractShareId } from '../war-share-input';
import { readSharedBgs, writeSharedBg } from '../../lib/war-bgs-shared';
import {
  createSharedPlan,
  fetchSharedPlan,
  updateSharedPlan,
  type PlanPayload,
  type StoredPlanPublic,
} from '../../lib/war-plan-client';
import { deliverPng, renderMapExport, renderPlayerExport } from './export';
import {
  cachePlan,
  clearDraftPlan,
  readCachedPlan,
  readDeleteToken,
  readDraftPlan,
  saveDeleteToken,
  writeDraftPlan,
} from '../../lib/war-plan-storage';
import {
  clearDvOverride,
  overlayDvOverrides,
  readDvOverrides,
  writeDvOverride,
  type DvOverrides,
} from '../../lib/dv-overrides';

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
  const dvSeed = useMemo(() => defenderValueMap(), []);

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
  const [planShare, setPlanShare] = useState<{ id: string; version: number; canEdit: boolean } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictPayload, setConflictPayload] = useState<StoredPlanPublic | null>(null);
  const [exportModal, setExportModal] = useState<{ dataUrl: string; alt: string } | null>(null);
  /** Set by any local mutation; cleared by save success and by
   *  hydration. Drives the little red dot on the Save button. */
  const [dirty, setDirty] = useState(false);
  /** Officer-tweaked defender values. Layered on top of the seed at
   *  solve time; editing here writes through to localStorage and marks
   *  the plan dirty so the officer knows to re-save. */
  const [dvOverrides, setDvOverrides] = useState<DvOverrides>({});
  useEffect(() => {
    setDvOverrides(readDvOverrides());
  }, []);
  const dvMap = useMemo(() => overlayDvOverrides(dvSeed, dvOverrides), [dvSeed, dvOverrides]);

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
      setPlansByBg((prev) => {
        const nextPlan = mutator(prev[activeBg]!);
        // Write through to the per-BG draft cache so a refresh doesn't
        // wipe the edit. Roster share ids live in the war-bgs-shared
        // bridge, not the draft, so we leave that field empty here.
        writeDraftPlan(activeBg, { ...planToPayload(nextPlan), rosterShareIds: [] });
        return { ...prev, [activeBg]: nextPlan };
      });
      setDirty(true);
      invalidate();
    },
    [activeBg, invalidate],
  );

  /** Set a dv override for a champion. Marks the plan dirty because
   *  changing dv shifts placements — the officer should re-solve. */
  const editDv = useCallback((championId: string, value: number) => {
    writeDvOverride(championId, value);
    setDvOverrides((prev) => ({ ...prev, [championId]: Math.max(0, Math.min(100, Math.round(value))) }));
    setDirty(true);
  }, []);

  const resetDv = useCallback((championId: string) => {
    clearDvOverride(championId);
    setDvOverrides((prev) => {
      const next = { ...prev };
      delete next[championId];
      return next;
    });
    setDirty(true);
  }, []);

  // ── URL-driven plan hydration ───────────────────────────────────────
  // On mount, if `?plan=<id>` is present, fetch the plan and hydrate.
  // Cached copy renders instantly; the fresh copy replaces it once the
  // network round-trip returns. Any error surfaces as a save-status
  // string rather than blocking the whole page.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('plan');
    if (id && /^[A-Za-z0-9]{8}$/.test(id)) {
      const cached = readCachedPlan(id);
      if (cached) hydrateFromPayload(id, cached.payload, cached.version, false);
      void (async () => {
        try {
          const fresh = await fetchSharedPlan(id);
          cachePlan(id, fresh);
          hydrateFromPayload(id, planPayloadFromStored(fresh), fresh.version, true);
          setDirty(false);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setSaveError(`Could not load plan ${id}: ${msg}`);
        }
      })();
      return;
    }
    // No plan in the URL — restore per-BG drafts from the last edit
    // session (each BG cached independently so switching BGs mid-edit
    // preserves the others). Drafts are best-effort; a schema drift on
    // the season file just re-defaults them.
    ([1, 2, 3] as const).forEach((bg) => {
      const draft = readDraftPlan(bg);
      if (!draft) return;
      setPlansByBg((prev) => ({ ...prev, [bg]: planFromPayload(season, draft) }));
    });
    // No plan in the URL — fall back to the shared BG rosters set on
    // the BG rosters tab. Per-BG merge only: hydrate a BG only if
    // shared has non-empty content for it, so a partially populated
    // shared store doesn't wipe rows the officer pasted directly here.
    const shared = readSharedBgs();
    if (!shared) return;
    ([0, 1, 2] as const).forEach((bgIdx) => {
      const bgRows = shared.bgs[bgIdx]!;
      if (!bgRows.some((r) => r.url.trim())) return;
      const bg = (bgIdx + 1) as BgIndex;
      const rows: RosterRow[] = bgRows.slice(0, 10).map((r) => ({
        input: r.url,
        status: 'loading',
        playerName: r.name?.trim() || undefined,
      }));
      while (rows.length < 10) rows.push({ input: '', status: 'idle' });
      setRostersByBg((prev) => ({ ...prev, [bg]: rows }));
      bgRows.forEach((r, i) => {
        if (r.url.trim()) void loadRow(bg, i, r.url);
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Bulk-hydrate one BG's plan state + roster inputs from a plan payload.
  const hydrateFromPayload = useCallback(
    (id: string, payload: PlanPayload, version: number, isFresh: boolean) => {
      const bg = payload.bg;
      setActiveBg(bg);
      setPlansByBg((prev) => ({ ...prev, [bg]: planFromPayload(season, payload) }));
      const rows: RosterRow[] = payload.rosterShareIds.map((shareId) => ({
        input: shareId,
        status: 'loading',
      }));
      while (rows.length < 10) rows.push({ input: '', status: 'idle' });
      setRostersByBg((prev) => ({ ...prev, [bg]: rows }));
      // Kick off individual roster loads in parallel.
      payload.rosterShareIds.forEach((shareId, i) => {
        void loadRow(bg, i, shareId);
      });
      const token = readDeleteToken(id);
      setPlanShare({ id, version, canEdit: Boolean(token) });
      if (isFresh) {
        setSaveStatus('saved');
        setDirty(false);
      }
    },
    [season],
  );

  // ── Save / update ───────────────────────────────────────────────────
  const savePlan = useCallback(async () => {
    setSaveStatus('saving');
    setSaveError(null);
    const rosterShareIds = rosterRows
      .filter((r) => r.status === 'ok' && r.playerId)
      .map((r) => r.playerId!);
    const playerNames: Record<string, string> = {};
    for (const r of rosterRows) {
      if (r.playerId && r.playerName) playerNames[r.playerId] = r.playerName;
    }
    const payload: PlanPayload = {
      ...planToPayload(plan),
      rosterShareIds,
      playerNames,
      lastPlacement: result ? placementsToPayload(result.placements) : undefined,
    };
    try {
      if (planShare?.canEdit) {
        const token = readDeleteToken(planShare.id);
        if (!token) {
          setSaveStatus('error');
          setSaveError('Missing edit token; cannot update this plan.');
          return;
        }
        const res = await updateSharedPlan(planShare.id, token, planShare.version, payload);
        if ('conflict' in res) {
          setSaveStatus('conflict');
          setConflictPayload(res.currentPayload);
          setSaveError(
            `Someone else saved v${res.currentVersion} while you were editing v${planShare.version}. Discard your edits or overwrite theirs — see the Battlegroup tab.`,
          );
          setTab('battlegroup');
          return;
        }
        setPlanShare({ id: res.id, version: res.version, canEdit: true });
        setSaveStatus('saved');
        setConflictPayload(null);
        setDirty(false);
        clearDraftPlan(activeBg);
      } else {
        const res = await createSharedPlan(payload);
        saveDeleteToken(res.id, res.deleteToken);
        setPlanShare({ id: res.id, version: res.version, canEdit: true });
        setSaveStatus('saved');
        setConflictPayload(null);
        setDirty(false);
        clearDraftPlan(activeBg);
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('plan', res.id);
          window.history.replaceState({}, '', url.toString());
        }
      }
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [plan, planShare, result, rosterRows, activeBg]);

  // ── Conflict recovery ──────────────────────────────────────────────
  const discardMyEdits = useCallback(() => {
    if (!conflictPayload || !planShare) return;
    hydrateFromPayload(planShare.id, planPayloadFromStored(conflictPayload), conflictPayload.version, false);
    setSaveStatus('saved');
    setSaveError(null);
    setConflictPayload(null);
    setDirty(false);
    clearDraftPlan(activeBg);
  }, [conflictPayload, planShare, hydrateFromPayload, activeBg]);

  const overwriteTheirs = useCallback(async () => {
    if (!planShare?.canEdit) return;
    const token = readDeleteToken(planShare.id);
    if (!token) return;
    setSaveStatus('saving');
    setSaveError(null);
    const rosterShareIds = rosterRows
      .filter((r) => r.status === 'ok' && r.playerId)
      .map((r) => r.playerId!);
    const playerNames: Record<string, string> = {};
    for (const r of rosterRows) {
      if (r.playerId && r.playerName) playerNames[r.playerId] = r.playerName;
    }
    // baseVersion must be the current server version, not our stale one,
    // so the server accepts the force write without a mismatched check.
    const currentServerVersion = conflictPayload?.version ?? planShare.version;
    const payload: PlanPayload = {
      ...planToPayload(plan),
      rosterShareIds,
      playerNames,
      lastPlacement: result ? placementsToPayload(result.placements) : undefined,
    };
    try {
      const res = await updateSharedPlan(planShare.id, token, currentServerVersion, payload, { force: true });
      if ('conflict' in res) {
        setSaveStatus('conflict');
        setSaveError('Server rejected the force write — someone saved again during the recovery. Try once more.');
        setConflictPayload(res.currentPayload);
        return;
      }
      setPlanShare({ id: res.id, version: res.version, canEdit: true });
      setSaveStatus('saved');
      setConflictPayload(null);
      setDirty(false);
      clearDraftPlan(activeBg);
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [plan, planShare, conflictPayload, result, rosterRows, activeBg]);

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

  /** Write the current BG's roster rows through to the shared BG store
   *  so the diversity tool sees the same rosters next time it mounts. */
  const syncBgToShared = useCallback((bg: BgIndex, rows: RosterRow[]): void => {
    const flat = rows.map((r) => ({
      url: r.input,
      name: r.playerName ?? '',
    }));
    writeSharedBg((bg - 1) as 0 | 1 | 2, flat);
  }, []);

  const handleRowChange = useCallback(
    (rowIdx: number, next: string) => {
      const bg = activeBg;
      setRostersByBg((prev) => {
        const rows = [...prev[bg]!];
        rows[rowIdx] = { ...rows[rowIdx]!, input: next };
        syncBgToShared(bg, rows);
        return { ...prev, [bg]: rows };
      });
      void loadRow(bg, rowIdx, next);
    },
    [activeBg, loadRow, syncBgToShared],
  );

  /** Rename a loaded player. Only meaningful once the roster is 'ok';
   *  writes to rosterRows so the map / placement / exports reflect it,
   *  and the plan share persists it via `playerNames`. */
  const renamePlayer = useCallback(
    (rowIdx: number, name: string) => {
      const bg = activeBg;
      setRostersByBg((prev) => {
        const rows = [...prev[bg]!];
        rows[rowIdx] = { ...rows[rowIdx]!, playerName: name };
        syncBgToShared(bg, rows);
        return { ...prev, [bg]: rows };
      });
    },
    [activeBg, syncBgToShared],
  );

  /** Load a BG share (from the diversity tool at /war): one 8-char id
   *  that expands into up to 10 roster shares. Each roster row then
   *  hydrates in parallel exactly like a direct paste would. */
  const [bgShareStatus, setBgShareStatus] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'error'; msg: string } | { status: 'ok'; label: string | null; count: number }
  >({ status: 'idle' });
  const loadBgShare = useCallback(
    async (raw: string) => {
      const id = extractShareId(raw);
      if (!id) {
        setBgShareStatus({ status: 'error', msg: 'Not a share id.' });
        return;
      }
      setBgShareStatus({ status: 'loading' });
      try {
        const payload = await fetchSharedBg(id);
        const bg = activeBg;
        const newRows: RosterRow[] = payload.rows.slice(0, 10).map((r) => ({
          input: r.url,
          status: 'loading',
          // Preserve the officer-set name from the BG bundle so we
          // don't clobber it if the individual share's label is blank.
          playerName: r.name?.trim() || undefined,
        }));
        while (newRows.length < 10) newRows.push({ input: '', status: 'idle' });
        setRostersByBg((prev) => ({ ...prev, [bg]: newRows }));
        syncBgToShared(bg, newRows);
        // Kick off each row's load; loadRow uses the pasted string to
        // extract the roster share id, so passing r.url works verbatim.
        payload.rows.slice(0, 10).forEach((r, i) => {
          void loadRow(bg, i, r.url);
        });
        setBgShareStatus({
          status: 'ok',
          label: payload.label,
          count: payload.rows.length,
        });
      } catch (e) {
        setBgShareStatus({
          status: 'error',
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [activeBg, loadRow, syncBgToShared],
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
  const championPortraitFor = useCallback(
    (id: ChampionId): string | null => championById.get(id)?.portraitUrl ?? null,
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

  // ── Exports ─────────────────────────────────────────────────────────
  const runExport = useCallback(
    async (kind: 'map' | 'player') => {
      if (!result) return;
      const activePlayers = players
        .filter((p) => !plan.excludedPlayers.has(p.id))
        .map((p) => ({ id: p.id, name: p.name }));
      const deps = {
        bg: activeBg,
        placements: result.placements,
        unfilled: result.unfilled.map((u) => u.node),
        championNameFor,
        championShortFor,
        championPortraitFor,
        playerNameFor,
        playerOrder: activePlayers,
      };
      const cv =
        kind === 'map'
          ? await renderMapExport(deps, season.season)
          : await renderPlayerExport(deps, season.season);
      const filename = `bg${activeBg}-defence-${kind === 'map' ? 'map' : 'players'}.png`;
      const title = `BG${activeBg} defence — ${kind === 'map' ? 'map' : 'by player'}`;
      const delivery = await deliverPng(cv, filename, title);
      if (delivery.kind === 'modal') {
        setExportModal({ dataUrl: delivery.dataUrl, alt: title });
      }
    },
    [
      result,
      players,
      plan.excludedPlayers,
      activeBg,
      season.season,
      championNameFor,
      championShortFor,
      championPortraitFor,
      playerNameFor,
    ],
  );

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
          Place
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
                season={season}
                selectedNode={selectedNode}
                result={result}
                players={players}
                champions={champions}
                championById={championById}
                championIdByName={championIdByName}
                explanationLookup={explanationLookup}
                mutatePlan={mutatePlan}
                playerNameFor={playerNameFor}
                dvSeed={dvSeed}
                dvOverrides={dvOverrides}
                onEditDv={editDv}
                onResetDv={resetDv}
              />
            )}
            {tab === 'placement' && (
              <PlacementPanel
                plan={plan}
                result={result}
                players={players}
                championById={championById}
                playerNameFor={playerNameFor}
                onExport={runExport}
              />
            )}
            {tab === 'battlegroup' && (
              <BattlegroupPanel
                rosterRows={rosterRows}
                onRowChange={handleRowChange}
                onRenamePlayer={renamePlayer}
                onLoadBgShare={loadBgShare}
                bgShareStatus={bgShareStatus}
                plan={plan}
                planShare={planShare}
                saveStatus={saveStatus}
                saveError={saveError}
                conflictPayload={conflictPayload}
                dirty={dirty}
                onSave={savePlan}
                onDiscardMyEdits={discardMyEdits}
                onOverwriteTheirs={overwriteTheirs}
              />
            )}
          </div>
        </aside>
      </div>

      {exportModal && (
        <ExportModal
          dataUrl={exportModal.dataUrl}
          alt={exportModal.alt}
          onClose={() => setExportModal(null)}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Export modal — last-resort fallback when Web Share and download both
// fail (iOS Safari in-app browsers, etc.). Long-press to save.
// ─────────────────────────────────────────────────────────────────────────

function ExportModal({
  dataUrl,
  alt,
  onClose,
}: {
  dataUrl: string;
  alt: string;
  onClose: () => void;
}) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Exported defence image"
      className="fixed inset-0 bg-black/80 flex items-start justify-center p-5 overflow-auto z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-3xl w-full">
        <div className="flex justify-between items-center gap-3 mb-2 text-sm text-white/70">
          <span>Long-press (mobile) or right-click the image to save it.</span>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm bg-white/10 border border-white/20 rounded hover:bg-white/20 text-white"
          >
            Close
          </button>
        </div>
        <img src={dataUrl} alt={alt} className="w-full h-auto rounded" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Node panel
// ─────────────────────────────────────────────────────────────────────────

type NodePanelProps = {
  plan: SeasonPlan;
  season: Season;
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
  dvSeed: ReadonlyMap<ChampionId, number>;
  dvOverrides: DvOverrides;
  onEditDv: (championId: string, value: number) => void;
  onResetDv: (championId: string) => void;
};

function NodePanel({
  plan,
  season,
  selectedNode,
  result,
  players,
  champions,
  championById,
  championIdByName,
  explanationLookup,
  mutatePlan,
  playerNameFor,
  dvSeed,
  dvOverrides,
  onEditDv,
  onResetDv,
}: NodePanelProps) {
  const [addPickInput, setAddPickInput] = useState('');
  const [pinChampInput, setPinChampInput] = useState('');
  const [pinPlayer, setPinPlayer] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  // Drag-reorder state for the picks list. dragFrom is the index the
  // officer picked up; dragOver is the index currently under the cursor.
  // The ▲▼ buttons remain the keyboard/touch fallback — HTML5 drag has
  // no mobile support without extra polyfills.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Reset transient inputs when the selected node changes so a leftover
  // pick doesn't spill into the next node's UI.
  useEffect(() => {
    setAddPickInput('');
    setPinChampInput('');
    setPinPlayer('');
    setPinMsg(null);
    setDragFrom(null);
    setDragOver(null);
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
  const buffs =
    season.nodes.find((n) => n.node === selectedNode)?.buffs ?? [];

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

      {/* Active node buffs — the pills that live on this node this season */}
      {buffs.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mt-3">
          {buffs.map((b, i) => (
            <li
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-paper-soft)] border border-[var(--color-rule)] text-[var(--color-ink-soft)]"
            >
              {b}
            </li>
          ))}
        </ul>
      )}

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
          <div className="relative min-w-0">
            <input
              type="text"
              list="owned-champion-list"
              value={pinChampInput}
              onChange={(e) => {
                setPinChampInput(e.target.value);
                setPinMsg(null);
              }}
              placeholder="Champion (owned only)"
              aria-label="Champion to pin"
              className="w-full min-w-0 pl-2 pr-7 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
            />
            {pinChampInput && (
              <button
                type="button"
                onClick={() => {
                  setPinChampInput('');
                  setPinPlayer('');
                  setPinMsg(null);
                }}
                aria-label="Clear champion"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] text-sm leading-none"
              >
                ×
              </button>
            )}
          </div>
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
            const isDragging = dragFrom === i;
            // Highlight the drop target with a thick top border when the
            // dragged item would land above it, bottom when it'd land
            // below. Same-index over-events collapse to no highlight.
            const isDropTarget =
              dragFrom !== null && dragOver === i && dragFrom !== i;
            const insertBelow = isDropTarget && dragFrom !== null && dragFrom < i;
            return (
              <li
                key={`${c}-${i}`}
                draggable
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox refuses to start a drag without setData.
                  e.dataTransfer.setData('text/plain', String(i));
                }}
                onDragOver={(e) => {
                  if (dragFrom === null || dragFrom === i) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOver !== i) setDragOver(i);
                }}
                onDragLeave={() => {
                  if (dragOver === i) setDragOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null && dragFrom !== i) {
                    const from = dragFrom;
                    mutatePlan((p) => reorderPick(p, selectedNode, from, i));
                  }
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
                className={`grid grid-cols-[16px_22px_1fr_auto_auto] items-center gap-2 py-1.5 border-b border-[var(--color-rule)] transition-opacity ${
                  isDragging ? 'opacity-40' : ''
                } ${
                  isDropTarget && !insertBelow
                    ? 'border-t-2 border-t-[var(--color-marvel-impact)]'
                    : ''
                } ${
                  isDropTarget && insertBelow
                    ? 'border-b-2 border-b-[var(--color-marvel-impact)]'
                    : ''
                }`}
              >
                <span
                  className="text-[var(--color-ink-soft)] opacity-60 cursor-grab active:cursor-grabbing select-none text-center"
                  aria-hidden="true"
                  title="Drag to reorder"
                >
                  ⋮⋮
                </span>
                <span className="text-right text-xs text-[var(--color-ink-soft)] font-serif">
                  {i + 1}
                </span>
                <span className="text-sm">
                  {championById.get(c)?.name ?? c}
                  {!isEditedFromGuide(plan, selectedNode) &&
                    i < (plan.guideTopPicks?.[selectedNode] ?? 0) && (
                      <span
                        className="ml-1 text-[11px] text-[var(--color-ink-soft)]"
                        role="img"
                        aria-label="guide top pick"
                        title="The guide highlights this as one of its best picks for the node, so the planner favours placing it here."
                      >
                        ★
                      </span>
                    )}
                </span>
                <span className="flex items-center gap-2">
                  <DvChip
                    championId={c}
                    seed={dvSeed.get(c) ?? 50}
                    override={dvOverrides[c]}
                    onEdit={onEditDv}
                    onReset={onResetDv}
                  />
                  <span
                    className={`text-xs ${ownCount === 0 ? 'text-[var(--color-marvel-editorial)]' : 'text-[var(--color-ink-soft)]'}`}
                  >
                    {ownCount === 0 ? 'nobody owns' : `${ownCount} own`}
                  </span>
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
        <div className="relative mt-2">
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
            className="w-full pl-2 pr-7 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          />
          {addPickInput && (
            <button
              type="button"
              onClick={() => setAddPickInput('')}
              aria-label="Clear"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] text-sm leading-none"
            >
              ×
            </button>
          )}
        </div>
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

      {/* Champion datalists. `champion-list` (all 7-stars) drives the
          add-defender input — officers curate picks from the full pool,
          including champs nobody in the BG owns. `owned-champion-list`
          drives the pin input so the officer can't pin someone who
          isn't in the BG. */}
      <datalist id="champion-list">
        {champions.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <datalist id="owned-champion-list">
        {champions
          .filter((c) => (ownersMap.get(c.id)?.length ?? 0) > 0)
          .map((c) => (
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

/**
 * Inline defender-value chip. Shows the effective dv (seed or override)
 * and, on click, becomes a numeric input for the officer to tweak. The
 * change persists to localStorage and applies globally — a champion's dv
 * is the same across every node they appear on.
 *
 * Yellow ring signals an active override so it's obvious which values
 * have been touched from the seed.
 */
function DvChip({
  championId,
  seed,
  override,
  onEdit,
  onReset,
}: {
  championId: string;
  seed: number;
  override: number | undefined;
  onEdit: (championId: string, value: number) => void;
  onReset: (championId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const effective = override ?? seed;
  const [draft, setDraft] = useState<string>(String(effective));
  useEffect(() => {
    setDraft(String(override ?? seed));
  }, [seed, override]);
  const hasOverride = override !== undefined && override !== seed;

  const commit = (): void => {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n)) {
      setDraft(String(effective));
      setEditing(false);
      return;
    }
    onEdit(championId, n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="number"
        min={0}
        max={100}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(String(effective));
            setEditing(false);
          }
        }}
        aria-label={`Defender value for ${championId}`}
        className="w-12 px-1 py-0.5 text-xs border border-[var(--color-marvel-impact)] rounded bg-[var(--color-paper)] focus:outline-none numeric"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      onContextMenu={(e) => {
        if (!hasOverride) return;
        e.preventDefault();
        onReset(championId);
      }}
      title={
        hasOverride
          ? `dv ${effective} (override, was ${seed}). Click to edit; right-click to reset.`
          : `dv ${effective}. Click to override for the whole alliance.`
      }
      className={`text-xs px-1.5 py-0.5 rounded numeric ${
        hasOverride
          ? 'bg-[color-mix(in_srgb,#d9a93f_20%,transparent)] text-[var(--color-ink)] border border-[#d9a93f]/60'
          : 'text-[var(--color-ink-soft)] border border-transparent hover:border-[var(--color-rule)]'
      }`}
    >
      dv {effective}
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
  onExport,
}: {
  plan: SeasonPlan;
  result: PlaceResult | null | undefined;
  players: WarPlayer[];
  championById: Map<ChampionId, Champion>;
  playerNameFor: (id: PlayerId) => string;
  onExport: (kind: 'map' | 'player') => Promise<void>;
}) {
  const copyBtnRef = useRef<HTMLButtonElement | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  if (!result) {
    return (
      <div>
        <h2 className="editorial-heading text-2xl mb-1">Not placed yet</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Load rosters and hit <strong>Place</strong> to see who puts
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
          onClick={() => void onExport('map')}
          className="px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
        >
          Export map
        </button>
        <button
          type="button"
          onClick={() => void onExport('player')}
          className="px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
        >
          Export by player
        </button>
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
  onRenamePlayer,
  onLoadBgShare,
  bgShareStatus,
  plan,
  planShare,
  saveStatus,
  saveError,
  conflictPayload,
  dirty,
  onSave,
  onDiscardMyEdits,
  onOverwriteTheirs,
}: {
  rosterRows: RosterRow[];
  onRowChange: (rowIdx: number, next: string) => void;
  onRenamePlayer: (rowIdx: number, name: string) => void;
  onLoadBgShare: (raw: string) => void;
  bgShareStatus:
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; msg: string }
    | { status: 'ok'; label: string | null; count: number };
  plan: SeasonPlan;
  planShare: { id: string; version: number; canEdit: boolean } | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'conflict' | 'error';
  saveError: string | null;
  conflictPayload: StoredPlanPublic | null;
  dirty: boolean;
  onSave: () => void;
  onDiscardMyEdits: () => void;
  onOverwriteTheirs: () => void;
}) {
  const okCount = rosterRows.filter((r) => r.status === 'ok').length;
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [bgShareInput, setBgShareInput] = useState('');

  const planUrl =
    planShare && typeof window !== 'undefined'
      ? `${window.location.origin}/war-planner/?plan=${planShare.id}`
      : null;

  const copyLink = async () => {
    if (!planUrl) return;
    try {
      await navigator.clipboard.writeText(planUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
    setTimeout(() => setCopyStatus('idle'), 1600);
  };

  return (
    <div>
      <h2 className="editorial-heading text-2xl mb-0.5">Battlegroup {plan.bg}</h2>
      <p className="text-sm text-[var(--color-ink-soft)]">
        {okCount} of 10 rosters loaded. Paste roster share IDs individually,
        or import a whole BG bundle from the diversity tool below.
      </p>

      {/* Save / share block */}
      <div className="mt-4 p-3 border border-[var(--color-rule)] rounded-md bg-[var(--color-paper-soft)]">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saveStatus === 'saving'}
            className="relative px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)] disabled:opacity-40"
          >
            {planShare?.canEdit
              ? saveStatus === 'saving'
                ? 'Saving…'
                : 'Save changes'
              : saveStatus === 'saving'
                ? 'Sharing…'
                : 'Save & share plan'}
            {dirty && saveStatus !== 'saving' && (
              <span
                aria-label="Unsaved changes"
                title="Unsaved changes"
                className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[var(--color-marvel-impact)] border-2 border-[var(--color-paper-soft)]"
              />
            )}
          </button>
          {planShare && (
            <>
              <span className="text-xs text-[var(--color-ink-soft)] font-mono">
                id: {planShare.id} · v{planShare.version}
              </span>
              <button
                type="button"
                onClick={copyLink}
                className="text-xs px-2 py-1 border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
              >
                {copyStatus === 'copied'
                  ? 'Copied'
                  : copyStatus === 'error'
                    ? 'Copy failed'
                    : 'Copy link'}
              </button>
            </>
          )}
        </div>
        {saveStatus === 'saved' && planShare && (
          <p className="text-xs text-[var(--color-ink-soft)] mt-2">
            Saved. Anyone with the link opens this plan; officers with the edit
            token stored here can save further changes.
          </p>
        )}
        {saveStatus === 'conflict' && conflictPayload && (
          <div className="mt-2 p-2.5 border border-[var(--color-marvel-editorial)] rounded bg-[var(--color-paper)]">
            <p className="text-xs text-[var(--color-marvel-editorial)] font-medium mb-1">
              Version conflict
            </p>
            <p className="text-xs text-[var(--color-ink-soft)] mb-2">
              {saveError} Server v{conflictPayload.version} was last saved{' '}
              {new Date(conflictPayload.updatedAt).toLocaleString()}.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onDiscardMyEdits}
                className="text-xs px-2 py-1 border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
              >
                Discard my edits, use theirs
              </button>
              <button
                type="button"
                onClick={onOverwriteTheirs}
                className="text-xs px-2 py-1 border border-[var(--color-marvel-editorial)] text-[var(--color-marvel-editorial)] rounded hover:bg-[var(--color-marvel-editorial)] hover:text-white"
              >
                Overwrite theirs with mine
              </button>
            </div>
          </div>
        )}
        {saveStatus === 'error' && saveError && (
          <p className="text-xs text-[var(--color-marvel-editorial)] mt-2">{saveError}</p>
        )}
        {!planShare && (
          <p className="text-xs text-[var(--color-ink-soft)] mt-2 opacity-70">
            Save the current plan (guide edits, pins, key nodes, roster refs) to
            KV. You get a short URL other officers can open on any device.
          </p>
        )}
      </div>

      {/* Load a shared BG bundle from the diversity tool (/war). One id
          expands into up to 10 individual roster share loads — same
          share endpoint both tools use, so an officer sets BGs up once
          and reuses across both. */}
      <div className="mt-4 p-3 border border-[var(--color-rule)] rounded-md bg-[var(--color-paper-soft)]">
        <label className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
          Import BG bundle from /war
        </label>
        <div className="flex gap-2 mt-1.5">
          <input
            type="text"
            value={bgShareInput}
            onChange={(e) => setBgShareInput(e.target.value)}
            placeholder="BG share id or URL — e.g. VT9GPSaZ"
            aria-label="BG share id"
            className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          />
          <button
            type="button"
            onClick={() => {
              if (!bgShareInput.trim()) return;
              onLoadBgShare(bgShareInput);
            }}
            disabled={bgShareStatus.status === 'loading' || !bgShareInput.trim()}
            className="px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)] disabled:opacity-40"
          >
            {bgShareStatus.status === 'loading' ? 'Loading…' : 'Load BG'}
          </button>
        </div>
        {bgShareStatus.status === 'ok' && (
          <p className="text-xs text-[var(--color-ink-soft)] mt-1.5">
            Loaded {bgShareStatus.count} rosters
            {bgShareStatus.label ? ` from "${bgShareStatus.label}"` : ''}.
            Individual loads below.
          </p>
        )}
        {bgShareStatus.status === 'error' && (
          <p className="text-xs text-[var(--color-marvel-editorial)] mt-1.5">
            {bgShareStatus.msg}
          </p>
        )}
      </div>

      <ul className="mt-4 space-y-1.5">
        {rosterRows.map((row, i) => (
          <RosterRowInput
            key={i}
            index={i}
            row={row}
            onChange={(next) => onRowChange(i, next)}
            onRename={(name) => onRenamePlayer(i, name)}
          />
        ))}
      </ul>
    </div>
  );
}

function RosterRowInput({
  index,
  row,
  onChange,
  onRename,
}: {
  index: number;
  row: RosterRow;
  onChange: (next: string) => void;
  onRename: (name: string) => void;
}) {
  // Local buffer for the name field so we don't fire a rename on every
  // keystroke; commit onBlur / Enter.
  const [nameDraft, setNameDraft] = useState<string>('');
  useEffect(() => {
    setNameDraft(row.playerName ?? '');
  }, [row.playerName, row.status]);

  const commitName = (): void => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    if (trimmed !== row.playerName) onRename(trimmed);
  };

  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
      <input
        type="text"
        value={row.input}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Player ${index + 1} — share id or URL`}
        aria-label={`Player ${index + 1} share`}
        className={`flex-1 min-w-0 px-2 py-1.5 text-sm border rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] ${
          row.status === 'error'
            ? 'border-[var(--color-marvel-impact)]'
            : 'border-[var(--color-rule)]'
        }`}
      />
      {row.status === 'ok' ? (
        <div className="flex items-center gap-1.5 sm:w-56">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Player name"
            aria-label={`Player ${index + 1} name`}
            className="flex-1 min-w-0 px-2 py-1 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          />
          <span className="text-xs text-[var(--color-ink-soft)] opacity-70 whitespace-nowrap">
            {row.roster?.length ?? 0}
          </span>
        </div>
      ) : (
        <div className="text-xs sm:w-56 text-[var(--color-ink-soft)] truncate">
          {row.status === 'loading' && 'loading…'}
          {row.status === 'error' && (
            <span className="text-[var(--color-marvel-editorial)]">
              {row.error?.slice(0, 60)}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Plan ↔ payload converters (localStorage + API shape ↔ engine shape)
// ─────────────────────────────────────────────────────────────────────────

function planToPayload(plan: SeasonPlan): Omit<PlanPayload, 'rosterShareIds'> {
  const pickOverrides: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(plan.pickOverrides)) {
    pickOverrides[k] = [...v];
  }
  const pins: PlanPayload['pins'] = {};
  for (const [k, v] of Object.entries(plan.pins)) {
    pins[k] = { championId: v.championId, playerId: v.playerId };
  }
  return {
    bg: plan.bg,
    season: plan.season,
    pickOverrides,
    keyNodes: [...plan.keyNodes],
    pins,
    excludedPlayers: [...plan.excludedPlayers],
    strict: plan.strict,
  };
}

function planFromPayload(season: Season, payload: PlanPayload): SeasonPlan {
  const guide: Record<number, string[]> = {};
  for (const n of season.nodes) guide[n.node] = [...n.guideDefenders];
  const pickOverrides: Record<number, string[]> = {};
  for (const [k, v] of Object.entries(payload.pickOverrides)) {
    pickOverrides[Number(k)] = [...v];
  }
  const pins: SeasonPlan['pins'] = {};
  for (const [k, v] of Object.entries(payload.pins)) {
    pins[Number(k)] = { championId: v.championId, playerId: v.playerId };
  }
  const lastPlacement: SeasonPlan['lastPlacement'] | undefined = payload.lastPlacement
    ? Object.fromEntries(
        Object.entries(payload.lastPlacement).map(([k, v]) => [Number(k), v]),
      )
    : undefined;
  return {
    season: payload.season,
    bg: payload.bg,
    guidePicks: guide,
    guideTopPicks: guideTopPicks(season),
    pickOverrides,
    keyNodes: new Set(payload.keyNodes),
    pins,
    excludedPlayers: new Set(payload.excludedPlayers),
    strict: payload.strict,
    lastPlacement,
  };
}

function planPayloadFromStored(stored: StoredPlanPublic): PlanPayload {
  const { createdAt: _c, updatedAt: _u, expiresAt: _e, version: _v, label, ...rest } = stored;
  void _c; void _u; void _e; void _v;
  return { ...rest, label: label ?? undefined };
}

function placementsToPayload(
  placements: Record<NodeNumber, NodePlacement>,
): PlanPayload['lastPlacement'] {
  const out: NonNullable<PlanPayload['lastPlacement']> = {};
  for (const [k, v] of Object.entries(placements)) {
    out[k] = {
      championId: v.championId,
      playerId: v.playerId,
      pickRank: v.pickRank,
      pinned: v.pinned,
    };
  }
  return out;
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
