import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { solvePlacement } from '../solve.js';
import type {
  ChampionId,
  NodeNumber,
  PlaceInput,
  PlayerId,
  SeasonPlan,
} from '../types.js';
import type { Ascension, Champion, ChampionState, Rank } from '../../../types.js';
import type { WarPlayer } from '../../types.js';

/**
 * Real-roster smoke test. The point (from the challenge in the alpha
 * kick-off): the mockup's solver has only ever seen synthetic random
 * rosters. This test runs it against a plausible-shape BG built from
 * the actual seed + real season-69 guide picks + committed defender
 * values, so pathological cases are caught here rather than by war
 * officers.
 *
 * The BG shape mirrors a real X-Men Namor-style alliance:
 *   - Two players own 90+ eligible champions (whales, R5 sig 200 A2)
 *   - Five own 60–80 (regulars, mix of R5 A2 and R5 A1)
 *   - Three own 40–55 (developing, R4 A2 with a smattering of R5)
 * That gives natural scarcity — the top defenders overlap, the mid
 * ones don't.
 *
 * We are NOT asserting exact placements. We're asserting invariants
 * hold at a realistic scale.
 */

// Deterministic RNG — the smoke test must be reproducible on CI, on
// Windows, and on macOS. Same seed everywhere.
function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SeedFile = { champions: Champion[] };
type SeasonFile = {
  season: number;
  nodes: { node: number; buffs: string[]; guideDefenders: string[]; topPicks?: number }[];
  defaultKeyNodes: number[];
};
type DvFile = { values: Record<string, number> };

// Resolve paths relative to the repo root — vitest runs the engine
// tests with cwd=packages/engine, so we walk up two levels.
const REPO_ROOT = resolve(process.cwd(), '..', '..');
function readJson<T>(relPath: string): T {
  const p = resolve(REPO_ROOT, relPath);
  return JSON.parse(readFileSync(p, 'utf-8')) as T;
}

function buildRealisticBg(): {
  players: WarPlayer[];
  eligibleChampionIds: ChampionId[];
} {
  const seed = readJson<SeedFile>('data/champions/seed.json');
  // Active 7-star with prestige — the only ones the engine will accept.
  const active = seed.champions.filter(
    (c) => c.sevenStarReleased !== false && c.prestige !== undefined,
  );
  const eligible = active.map((c) => c.id);
  const r = seededRng(42069);
  // 10 players; ownership rate varies to create realistic scarcity.
  const ownershipRates = [0.90, 0.88, 0.75, 0.72, 0.70, 0.68, 0.65, 0.52, 0.48, 0.42];
  const players: WarPlayer[] = ownershipRates.map((rate, i) => {
    const roster: ChampionState[] = [];
    for (const c of active) {
      if (r() < rate) {
        // Whales top-half get more A2 states; developing get more A0.
        const isWhale = i < 4;
        const canAscend = c.ascendable ?? false;
        const ascRoll = r();
        const ascension: Ascension = canAscend
          ? isWhale
            ? ascRoll < 0.65
              ? 'A2'
              : ascRoll < 0.9
                ? 'A1'
                : 'A0'
            : ascRoll < 0.35
              ? 'A2'
              : ascRoll < 0.7
                ? 'A1'
                : 'A0'
          : 'A0';
        const rankRoll = r();
        const rank: Rank = (isWhale
          ? rankRoll < 0.6
            ? 5
            : 4
          : rankRoll < 0.3
            ? 5
            : rankRoll < 0.85
              ? 4
              : 3) as Rank;
        const sig = Math.floor(r() * 21) * 10; // 0..200 in 10s
        roster.push({
          championId: c.id,
          rank,
          sig,
          ascension,
          stateConfirmed: true,
          addedVia: 'manual',
        });
      }
    }
    return {
      id: `xmn-${i + 1}`,
      name: `X-Men ${i + 1}`,
      roster,
    };
  });
  return { players, eligibleChampionIds: eligible };
}

function loadSeasonPlan(): SeasonPlan {
  const season = readJson<SeasonFile>('data/aw/season-69.json');
  const guidePicks: Record<NodeNumber, ChampionId[]> = {};
  const guideTopPicks: Record<NodeNumber, number> = {};
  for (const n of season.nodes) {
    guidePicks[n.node] = [...n.guideDefenders];
    if (n.topPicks !== undefined) guideTopPicks[n.node] = n.topPicks;
  }
  return {
    season: season.season,
    bg: 1,
    guidePicks,
    guideTopPicks,
    pickOverrides: {},
    keyNodes: new Set(season.defaultKeyNodes),
    pins: {},
    excludedPlayers: new Set(),
    strict: false,
  };
}

function loadDefenderValues(): Map<ChampionId, number> {
  const dv = readJson<DvFile>('data/aw/defender-values.json');
  return new Map(Object.entries(dv.values));
}

describe('season solver — realistic X-Men BG shape', () => {
  const { players } = buildRealisticBg();
  const plan = loadSeasonPlan();
  const defenderValues = loadDefenderValues();
  const input: PlaceInput = {
    plan,
    players,
    floor: { rank: 4, ascension: 'A0' },
    defenderValues,
  };
  const t0 = performance.now();
  const result = solvePlacement(input);
  const elapsed = performance.now() - t0;

  it('completes in under 100ms on a real-shape BG', () => {
    expect(elapsed).toBeLessThan(100);
  });

  it('places at least 45 of 50 nodes at the R4 A0 floor', () => {
    // Realistic BGs almost always fill 50/50; a fixture at 45 is a
    // sensible lower bar. Below that, the tier map or ownership rate
    // is off, which is worth flagging.
    expect(Object.keys(result.placements).length).toBeGreaterThanOrEqual(45);
  });

  it('guide tiers put more nodes on a best-tier pick than list order alone', () => {
    const onTopTier = (r: typeof result): number =>
      Object.entries(r.placements).filter(
        ([node, pl]) => pl.pickRank >= 0 && pl.pickRank < (plan.guideTopPicks?.[Number(node) as NodeNumber] ?? 0),
      ).length;
    const flat = solvePlacement({ ...input, plan: { ...plan, guideTopPicks: undefined } });
    const moved = Object.keys(result.placements).filter(
      (n) => result.placements[Number(n) as NodeNumber]?.championId !== flat.placements[Number(n) as NodeNumber]?.championId,
    ).length;
    console.log(`best-tier placements: ${onTopTier(result)} with guide tiers, ${onTopTier(flat)} without; ${moved} nodes differ`);
    expect(onTopTier(result)).toBeGreaterThanOrEqual(onTopTier(flat));
  });

  it('never places a champion twice', () => {
    const seen = new Set<ChampionId>();
    for (const pl of Object.values(result.placements)) {
      expect(seen.has(pl.championId)).toBe(false);
      seen.add(pl.championId);
    }
  });

  it('never places more than 5 per player', () => {
    const counts = new Map<PlayerId, number>();
    for (const pl of Object.values(result.placements)) {
      counts.set(pl.playerId, (counts.get(pl.playerId) ?? 0) + 1);
    }
    for (const c of counts.values()) expect(c).toBeLessThanOrEqual(5);
  });

  it('every placement is owned by the placer', () => {
    const owned = new Map<PlayerId, Set<ChampionId>>();
    for (const p of players) {
      owned.set(p.id, new Set(p.roster.map((s) => s.championId)));
    }
    for (const pl of Object.values(result.placements)) {
      expect(owned.get(pl.playerId)?.has(pl.championId)).toBe(true);
    }
  });

  it('is deterministic across two runs with the same input', () => {
    const r2 = solvePlacement(input);
    expect(summarise(result.placements)).toEqual(summarise(r2.placements));
  });

  it('a re-solve with the prior placement produces zero moved nodes', () => {
    const plan2: SeasonPlan = { ...plan, lastPlacement: result.placements };
    const r2 = solvePlacement({ ...input, plan: plan2 });
    expect(r2.moved).toEqual([]);
  });
});

function summarise(placements: Record<NodeNumber, unknown>): string {
  return Object.entries(placements)
    .map(([n, v]) => `${n}:${JSON.stringify(v)}`)
    .sort()
    .join('|');
}
