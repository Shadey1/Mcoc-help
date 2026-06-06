import { describe, expect, it } from 'vitest';
import {
  planSteps,
  type Champion,
  type ChampionState,
} from '../src/index.js';

function makeChampion(
  id: string,
  name: string,
  klass: Champion['class'],
  rank5Sig0: number,
  rank5Sig200: number,
  ascendable = true,
): Champion {
  return {
    id,
    name,
    class: klass,
    ascendable,
    prestige: {
      rank5: { '0': rank5Sig0, '200': rank5Sig200 },
    },
    sigCurve: null,
    tags: [],
    portraitUrl: null,
    sevenStarReleased: true,
  };
}

function makeState(
  championId: string,
  rank: 3 | 4 | 5,
  sig: number,
  ascension: 'A0' | 'A1' | 'A2',
): ChampionState {
  return {
    championId,
    rank,
    sig,
    ascension,
    stateConfirmed: true,
    addedVia: 'manual',
  };
}

describe('planSteps — greedy multi-step planner', () => {
  it('returns up to targetSteps steps with monotonically rising cumulative delta', () => {
    // 30 baseline champions at R5 sig 200 with LOW BHR (fill top-30 but
    // form a low cutoff). Two boosters with HIGHER ceiling at R4 sig 200 —
    // ranking them up displaces baseline entries from top-30.
    const champions: Champion[] = [];
    const states: ChampionState[] = [];
    for (let i = 0; i < 30; i++) {
      const c = makeChampion(`c${i}`, `Champ${i}`, 'Tech', 25000, 35000, false);
      champions.push(c);
      states.push(makeState(`c${i}`, 5, 200, 'A0'));
    }
    // Higher-ceiling boosters — rank-up R4→R5 takes them above the cutoff.
    champions.push(makeChampion('booster1', 'Booster 1', 'Tech', 35000, 45000, false));
    states.push(makeState('booster1', 4, 200, 'A0'));
    champions.push(makeChampion('booster2', 'Booster 2', 'Tech', 35000, 45000, false));
    states.push(makeState('booster2', 4, 200, 'A0'));

    const lookup = new Map(champions.map((c) => [c.id, c]));
    const plan = planSteps(states, lookup, 5);

    expect(plan.length).toBeGreaterThan(0);
    expect(plan.length).toBeLessThanOrEqual(5);

    // Indices are 1-based and sequential.
    for (let i = 0; i < plan.length; i++) {
      expect(plan[i]!.index).toBe(i + 1);
    }

    // Cumulative delta is monotonically non-decreasing.
    let prev = 0;
    for (const step of plan) {
      expect(step.cumulativeDelta).toBeGreaterThanOrEqual(prev);
      prev = step.cumulativeDelta;
    }
  });

  it('skips deferred (ascend-first) rank-up moves on A0-ascendable champions', () => {
    // 30 baseline champions + one A0-ascendable champion at R4 sig 200.
    // Its rank-up move is deferred (should ascend first); the planner
    // should surface the ascend, not the rank-up.
    const champions: Champion[] = [];
    const states: ChampionState[] = [];
    for (let i = 0; i < 30; i++) {
      const c = makeChampion(`c${i}`, `Champ${i}`, 'Tech', 30000, 40000, false);
      champions.push(c);
      states.push(makeState(`c${i}`, 5, 200, 'A0'));
    }
    champions.push(makeChampion('ascendable-r4', 'Asc R4', 'Tech', 30000, 40000, true));
    states.push(makeState('ascendable-r4', 4, 200, 'A0'));

    const lookup = new Map(champions.map((c) => [c.id, c]));
    const plan = planSteps(states, lookup, 5);

    // First move surfaced for the ascendable champ should be an ascend,
    // not the rank-up (which is deferred).
    const firstMoveForAsc = plan.find(
      (s) => s.move.move.championId === 'ascendable-r4',
    );
    if (firstMoveForAsc) {
      expect(firstMoveForAsc.move.move.kind).not.toBe('rank-up');
    }
  });

  it('stops early when no positive-delta non-deferred move exists', () => {
    // Roster with all champions already fully developed — no moves available.
    const champions: Champion[] = [];
    const states: ChampionState[] = [];
    for (let i = 0; i < 5; i++) {
      const c = makeChampion(`c${i}`, `Champ${i}`, 'Tech', 30000, 40000, false);
      champions.push(c);
      states.push(makeState(`c${i}`, 5, 200, 'A0'));
    }
    const lookup = new Map(champions.map((c) => [c.id, c]));
    const plan = planSteps(states, lookup, 10);

    // No positive moves available (everyone at R5 sig 200, no ascensions
    // possible since none are ascendable in this setup).
    expect(plan).toEqual([]);
  });

  it('targetSteps = 0 returns an empty array', () => {
    const champion = makeChampion('c0', 'C0', 'Tech', 30000, 40000, false);
    const lookup = new Map([['c0', champion]]);
    const plan = planSteps([makeState('c0', 4, 200, 'A0')], lookup, 0);
    expect(plan).toEqual([]);
  });

  it('each step\'s cumulativeDelta equals the sum of top30Deltas up to and including that step', () => {
    const champions: Champion[] = [];
    const states: ChampionState[] = [];
    for (let i = 0; i < 30; i++) {
      const c = makeChampion(`c${i}`, `Champ${i}`, 'Tech', 25000, 35000, false);
      champions.push(c);
      states.push(makeState(`c${i}`, 5, 200, 'A0'));
    }
    champions.push(makeChampion('booster', 'Booster', 'Tech', 35000, 45000, false));
    states.push(makeState('booster', 4, 200, 'A0'));

    const lookup = new Map(champions.map((c) => [c.id, c]));
    const plan = planSteps(states, lookup, 5);

    let running = 0;
    for (const step of plan) {
      running += step.move.top30Delta;
      expect(step.cumulativeDelta).toBe(running);
    }
  });
});
