import { describe, expect, it } from 'vitest';
import { solvePlacement } from '../solve.js';
import { ALL_NODES } from '../map.js';
import type {
  ChampionId,
  NodeNumber,
  PlaceInput,
  PlaceResult,
  PlayerId,
  SeasonPlan,
} from '../types.js';
import type { Ascension, ChampionState, Rank } from '../../../types.js';
import type { WarPlayer } from '../../types.js';

/**
 * Solver invariants. These are the guarantees the handover asks the engine
 * to hold — every one is a bug the officer would notice within a single war.
 *
 * The fixture: a 10-player BG (matching real war shape), each player owning
 * a rotating subset of a 60-champion pool. Rosters overlap enough that the
 * solver has real choices, sparse enough that some nodes go to lower picks.
 * The season file is a synthetic 50-node curation with 8 picks per node.
 */

// ── Fixture helpers ─────────────────────────────────────────────────────

/** Build a BG player at floor R4 A0 sig 200 for every champion in the
 *  passed set. Simple but sufficient — solvers care about ownership, not
 *  the individual states within it. */
function makePlayer(id: PlayerId, name: string, owned: readonly ChampionId[]): WarPlayer {
  const roster: ChampionState[] = owned.map((championId) => ({
    championId,
    rank: 5 as Rank,
    sig: 200,
    ascension: 'A2' as Ascension,
    stateConfirmed: true,
    addedVia: 'manual',
  }));
  return { id, name, roster };
}

const PLAYERS: readonly PlayerId[] = [
  'p1', 'p2', 'p3', 'p4', 'p5',
  'p6', 'p7', 'p8', 'p9', 'p10',
];

/** 60 champions — enough to fill 50 nodes with room for real choices,
 *  but tight enough that not every pick is available. */
const CHAMPS: readonly ChampionId[] = Array.from({ length: 60 }, (_, i) => `champ-${i + 1}`);

/** Cheap deterministic RNG so fixtures don't flake between machines. */
function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a BG where each player owns ~50% of the pool. */
function buildBg(): WarPlayer[] {
  const r = seededRng(69);
  return PLAYERS.map((id, i) =>
    makePlayer(
      id,
      `Player ${i + 1}`,
      CHAMPS.filter(() => r() < 0.5),
    ),
  );
}

/** Build a synthetic 50-node picks map: each node gets 8 champions
 *  drawn deterministically from the pool. */
function buildGuidePicks(seed = 42): Record<NodeNumber, ChampionId[]> {
  const r = seededRng(seed);
  const g: Record<NodeNumber, ChampionId[]> = {};
  for (const n of ALL_NODES) {
    const shuffled = [...CHAMPS].sort(() => r() - 0.5);
    g[n] = shuffled.slice(0, 8);
  }
  return g;
}

/** Default DV map — every champion is worth 70 unless overridden. */
function buildDefenderValues(): Map<ChampionId, number> {
  const m = new Map<ChampionId, number>();
  for (const c of CHAMPS) m.set(c, 70);
  return m;
}

function buildPlan(overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    season: 69,
    bg: 1,
    guidePicks: buildGuidePicks(),
    pickOverrides: {},
    keyNodes: new Set([48, 49, 50]),
    pins: {},
    excludedPlayers: new Set(),
    strict: false,
    ...overrides,
  };
}

function buildInput(overrides: Partial<PlaceInput> = {}): PlaceInput {
  return {
    plan: buildPlan(),
    players: buildBg(),
    floor: { rank: 4, ascension: 'A0' },
    defenderValues: buildDefenderValues(),
    ...overrides,
  };
}

// ── Invariant tests ─────────────────────────────────────────────────────

describe('season solver invariants', () => {
  it('never places a champion twice', () => {
    const r = solvePlacement(buildInput());
    const seen = new Set<ChampionId>();
    for (const pl of Object.values(r.placements)) {
      expect(seen.has(pl.championId)).toBe(false);
      seen.add(pl.championId);
    }
  });

  it('never places more than 5 per player (default slotsPerPlayer)', () => {
    const r = solvePlacement(buildInput());
    const counts = new Map<PlayerId, number>();
    for (const pl of Object.values(r.placements)) {
      counts.set(pl.playerId, (counts.get(pl.playerId) ?? 0) + 1);
    }
    for (const c of counts.values()) expect(c).toBeLessThanOrEqual(5);
  });

  it('every placement is owned by the player placing it', () => {
    const input = buildInput();
    const owned = new Map<PlayerId, Set<ChampionId>>();
    for (const p of input.players) {
      owned.set(p.id, new Set(p.roster.map((s) => s.championId)));
    }
    const r = solvePlacement(input);
    for (const pl of Object.values(r.placements)) {
      expect(owned.get(pl.playerId)?.has(pl.championId)).toBe(true);
    }
  });

  it('honours a with-player pin', () => {
    const players = buildBg();
    const ownerP = players.find((p) =>
      p.roster.some((s: ChampionState) => s.championId === 'champ-3'),
    )!;
    const plan = buildPlan({
      pins: { 12: { championId: 'champ-3', playerId: ownerP.id } },
    });
    const r = solvePlacement(buildInput({ plan, players }));
    expect(r.placements[12]?.championId).toBe('champ-3');
    expect(r.placements[12]?.playerId).toBe(ownerP.id);
    expect(r.placements[12]?.pinned).toBe(true);
  });

  it('honours an any-owner pin', () => {
    // champ-7 must go to node 25, whoever owns it.
    const plan = buildPlan({ pins: { 25: { championId: 'champ-7', playerId: null } } });
    const r = solvePlacement(buildInput({ plan }));
    expect(r.placements[25]?.championId).toBe('champ-7');
    expect(r.placements[25]?.pinned).toBe(true);
  });

  it('strict mode never places an unlisted champion', () => {
    const plan = buildPlan({ strict: true });
    const r = solvePlacement(buildInput({ plan }));
    for (const [nStr, pl] of Object.entries(r.placements)) {
      const n = Number(nStr) as NodeNumber;
      const picks = plan.guidePicks[n] ?? [];
      if (picks.length > 0 && !pl.pinned) {
        // rank -1 (unlisted, dv fallback) must not appear in strict mode
        expect(pl.pickRank).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is deterministic for the same input', () => {
    const r1 = solvePlacement(buildInput());
    const r2 = solvePlacement(buildInput());
    expect(placementsSummary(r1)).toEqual(placementsSummary(r2));
  });

  it('reports an impossible pin instead of throwing', () => {
    // Pin champ-42 to node 5 with a player who doesn't own it.
    const players = buildBg();
    const nonOwner = players.find(
      (p) => !p.roster.some((s: ChampionState) => s.championId === 'champ-42'),
    )!;
    const plan = buildPlan({
      pins: { 5: { championId: 'champ-42', playerId: nonOwner.id } },
    });
    // Should not throw; the invalid pin is dropped and node 5 solves normally.
    const r = solvePlacement(buildInput({ plan, players }));
    // Either node 5 got some champion (pin dropped) or it's in unfilled — never crash.
    expect(() => solvePlacement(buildInput({ plan, players }))).not.toThrow();
    expect(r.placements[5] || r.unfilled.some((u) => u.node === 5)).toBeTruthy();
  });

  it('a re-run with no changes produces zero moved nodes', () => {
    const first = solvePlacement(buildInput());
    const plan = buildPlan({ lastPlacement: first.placements });
    const second = solvePlacement(buildInput({ plan }));
    expect(second.moved).toEqual([]);
  });
});

describe('season solver behaviour', () => {
  it('fills 50 of 50 when the pool comfortably covers demand', () => {
    // Every player owns every champion — no scarcity anywhere.
    const players: WarPlayer[] = PLAYERS.map((id, i) =>
      makePlayer(id, `Player ${i + 1}`, CHAMPS),
    );
    const r = solvePlacement(buildInput({ players }));
    expect(Object.keys(r.placements).length).toBe(50);
    expect(r.unfilled).toEqual([]);
  });

  it('prefers a top-pick placement over a lower-pick one when both are legal', () => {
    // Node 1's top pick is champ-X owned by p1; node 2's top pick is also
    // champ-X. Only one node can have champ-X — it should go to the KEY node.
    const plan = buildPlan({
      guidePicks: {
        1: ['champ-1', 'champ-2'],
        50: ['champ-1', 'champ-3'], // 50 is key
      },
      keyNodes: new Set([50]),
    });
    // Ensure at least one player owns each candidate
    const players: WarPlayer[] = [
      makePlayer('a', 'A', ['champ-1', 'champ-2', 'champ-3']),
    ];
    // Reduce slots so the solver has to choose
    const r = solvePlacement(buildInput({ plan, players, slotsPerPlayer: 5 }));
    expect(r.placements[50]?.championId).toBe('champ-1');
    // Node 1 falls back to champ-2 (its 2nd pick)
    expect(r.placements[1]?.championId).toBe('champ-2');
  });

  it('a contested champion goes to the node where the guide highlights it', () => {
    // champ-1 is node 1's first pick (an alternate there) and node 2's
    // second pick (top tier there). By list position alone node 1 wins it:
    // 100 + 82 beats 91 + 82. The tier bonus flips that.
    const guidePicks = {
      1: ['champ-1', 'champ-9', 'champ-2'],
      2: ['champ-8', 'champ-1', 'champ-3'],
    };
    const players: WarPlayer[] = [makePlayer('a', 'A', ['champ-1', 'champ-2', 'champ-3'])];
    const flat = solvePlacement(buildInput({ plan: buildPlan({ guidePicks, keyNodes: new Set() }), players }));
    expect(flat.placements[1]?.championId).toBe('champ-1');

    const tiered = solvePlacement(
      buildInput({ plan: buildPlan({ guidePicks, guideTopPicks: { 1: 0, 2: 2 }, keyNodes: new Set() }), players }),
    );
    expect(tiered.placements[2]?.championId).toBe('champ-1');
    expect(tiered.placements[1]?.championId).toBe('champ-2');
  });

  it('excluded players contribute zero placements', () => {
    const players = buildBg();
    const plan = buildPlan({ excludedPlayers: new Set(['p1']) });
    const r = solvePlacement(buildInput({ players, plan }));
    for (const pl of Object.values(r.placements)) {
      expect(pl.playerId).not.toBe('p1');
    }
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

function placementsSummary(r: PlaceResult): string {
  return Object.entries(r.placements)
    .map(([n, pl]) => `${n}:${pl.championId}:${pl.playerId}`)
    .sort()
    .join(',');
}
