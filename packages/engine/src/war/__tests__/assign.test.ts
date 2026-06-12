import { describe, expect, it } from 'vitest';
import { assignWar, type ChampionState, type WarPlayer } from '../../index.js';

/**
 * War assignment tests.
 *
 * These exercise the scarcity-first greedy assignment in isolation —
 * inputs are synthetic, intentionally minimal, and named to read like
 * the alliance scenarios they're modelling.
 */

function state(
  championId: string,
  rank: 3 | 4 | 5 | 6,
  ascension: 'A0' | 'A1' | 'A2',
  sig = 200,
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

function player(id: string, name: string, roster: ChampionState[]): WarPlayer {
  return { id, name, roster };
}

describe('assignWar — power-first greedy placement', () => {
  it('power-first places highest-tier champs before lower-tier rare ones', () => {
    // Alice owns 6 popular R5 A2 champs plus a rare R4 A0 (only she has it).
    // Bob owns the same 6 popular R5 A2s. Power-first must place all 6 R5
    // A2s (filling both players to 3 each) before ever considering the
    // rare R4 — the user's "best defence" is the strongest tier, not the
    // rarest champ. The rare-R4 gets squeezed only if a slot is free
    // after the strong tier is exhausted.
    const result = assignWar({
      defenderPool: new Set([
        'rare-modok',
        'pop-a',
        'pop-b',
        'pop-c',
        'pop-d',
        'pop-e',
        'pop-f',
      ]),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [
          state('rare-modok', 4, 'A0'),
          state('pop-a', 5, 'A2'),
          state('pop-b', 5, 'A2'),
          state('pop-c', 5, 'A2'),
          state('pop-d', 5, 'A2'),
          state('pop-e', 5, 'A2'),
          state('pop-f', 5, 'A2'),
        ]),
        player('p2', 'bob', [
          state('pop-a', 5, 'A2'),
          state('pop-b', 5, 'A2'),
          state('pop-c', 5, 'A2'),
          state('pop-d', 5, 'A2'),
          state('pop-e', 5, 'A2'),
          state('pop-f', 5, 'A2'),
        ]),
      ],
      slotsPerPlayer: 5,
    });

    // Power-first fills all alice's 5 slots with R5 A2s before considering
    // the rare R4, then bob picks up the spillover R5. The rare-R4 drops
    // because alice (its only owner) is now full — and that's the desired
    // trade-off: officers asked for "strongest defence", which can leave a
    // unique lower-tier meta unplaced.
    expect(result.totalPlaced).toBe(6);
    const aliceR5s = result.assignments.filter(
      (a) => a.playerId === 'p1' && a.rank === 5,
    );
    expect(aliceR5s).toHaveLength(5);
    const placedChamps = new Set(result.assignments.map((a) => a.championId));
    expect(placedChamps.has('rare-modok')).toBe(false);
  });

  it('within a tier, rarer champs are placed before common ones', () => {
    // Two R5 A2s in the pool — Modok owned by alice alone, Photon by both.
    // Power tier is identical, so the within-tier scarcity tiebreaker
    // should process Modok first and pin it to alice; Photon then goes
    // to whoever's left.
    const result = assignWar({
      defenderPool: new Set(['rare-modok', 'common-photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [
          state('rare-modok', 5, 'A2'),
          state('common-photon', 5, 'A2'),
        ]),
        player('p2', 'bob', [state('common-photon', 5, 'A2')]),
      ],
      slotsPerPlayer: 1,
    });

    expect(result.totalPlaced).toBe(2);
    const aliceChamps = result.assignments
      .filter((a) => a.playerId === 'p1')
      .map((a) => a.championId);
    expect(aliceChamps).toContain('rare-modok');
    const bobChamps = result.assignments
      .filter((a) => a.playerId === 'p2')
      .map((a) => a.championId);
    expect(bobChamps).toEqual(['common-photon']);
  });

  it('ascension breaks ties within the same rank', () => {
    // Both players have Photon at R5, alice at A2, bob at A0. Alice wins.
    const result = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [state('photon', 5, 'A2')]),
        player('p2', 'bob', [state('photon', 5, 'A0')]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.playerId).toBe('p1');
    expect(result.assignments[0]!.ascension).toBe('A2');
  });

  it('sig breaks ties within the same rank+ascension', () => {
    const result = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [state('photon', 5, 'A2', 100)]),
        player('p2', 'bob', [state('photon', 5, 'A2', 200)]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.playerId).toBe('p2');
    expect(result.assignments[0]!.sig).toBe(200);
  });

  it('effective rank beats raw rank — R4 A2 (effective 6) wins over R5 A0 (effective 5)', () => {
    // Power ladder: R4 A2 ≡ R5 A1 = effective-6, R5 A0 ≡ R4 A1 = effective-5.
    // alice's R4 A2 beats bob's R5 A0 because ascension counts as a full rank.
    const result = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [state('photon', 4, 'A2')]),
        player('p2', 'bob', [state('photon', 5, 'A0')]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.assignments[0]!.playerId).toBe('p1');
    expect(result.assignments[0]!.rank).toBe(4);
    expect(result.assignments[0]!.ascension).toBe('A2');
  });

  it('effective-rank ties resolve by sig — R5 A0 sig 200 beats R4 A1 sig 100 (both effective-5)', () => {
    const result = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [state('photon', 4, 'A1', 100)]),
        player('p2', 'bob', [state('photon', 5, 'A0', 200)]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.assignments[0]!.playerId).toBe('p2');
  });

  it('R6 sits at the top of the ladder — R6 A0 (effective 7) beats R5 A2 (effective 7) on sig, beats R5 A1 (effective 6) outright', () => {
    // Two effective-7 (R6 A0 vs R5 A2): sig breaks tie.
    const tied = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [state('photon', 5, 'A2', 100)]),
        player('p2', 'bob', [state('photon', 6, 'A0', 200)]),
      ],
      slotsPerPlayer: 5,
    });
    expect(tied.assignments[0]!.playerId).toBe('p2');

    // R6 A0 (7) > R5 A1 (6) outright.
    const clearWin = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [state('photon', 5, 'A1', 200)]),
        player('p2', 'bob', [state('photon', 6, 'A0', 0)]),
      ],
      slotsPerPlayer: 5,
    });
    expect(clearWin.assignments[0]!.playerId).toBe('p2');
    expect(clearWin.assignments[0]!.rank).toBe(6);
  });

  it('respects the state floor — champs below floor are filtered out', () => {
    // alice has Photon only at R3, bob has it at R5. Floor R4 A0 excludes alice.
    const result = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [state('photon', 3, 'A0')]),
        player('p2', 'bob', [state('photon', 5, 'A0')]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.totalPlaced).toBe(1);
    expect(result.assignments[0]!.playerId).toBe('p2');
  });

  it('floor uses ascension as the second axis within a rank', () => {
    // Floor R4 A1: an R4 A0 champ is below floor, R4 A1 meets it.
    const result = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A1' },
      players: [
        player('p1', 'alice', [state('photon', 4, 'A0')]),
        player('p2', 'bob', [state('photon', 4, 'A1')]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.totalPlaced).toBe(1);
    expect(result.assignments[0]!.playerId).toBe('p2');
  });

  it('caps each player at slotsPerPlayer', () => {
    // alice has 7 candidates, slotsPerPlayer = 5 → 5 assigned, 2 skipped.
    const champs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const result = assignWar({
      defenderPool: new Set(champs),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player(
          'p1',
          'alice',
          champs.map((id) => state(id, 5, 'A2')),
        ),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.totalPlaced).toBe(5);
    expect(result.assignments.filter((a) => a.playerId === 'p1')).toHaveLength(5);
  });

  it('never places the same champion twice', () => {
    // Both players have Photon. Should only be placed once total.
    const result = assignWar({
      defenderPool: new Set(['photon', 'modok']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [
          state('photon', 5, 'A2'),
          state('modok', 5, 'A2'),
        ]),
        player('p2', 'bob', [state('photon', 5, 'A2')]),
      ],
      slotsPerPlayer: 5,
    });

    const photonPlacements = result.assignments.filter(
      (a) => a.championId === 'photon',
    );
    expect(photonPlacements).toHaveLength(1);
  });

  it('reports underfilled players when the pool is too sparse', () => {
    // 2 players, 5 slots each = 10 total slots, but only 3 placeable champs.
    const result = assignWar({
      defenderPool: new Set(['a', 'b', 'c']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [
          state('a', 5, 'A2'),
          state('b', 5, 'A2'),
        ]),
        player('p2', 'bob', [state('c', 5, 'A2')]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.totalPlaced).toBe(3);
    expect(result.underfilled).toHaveLength(2);
    expect(result.underfilled.find((u) => u.playerId === 'p1')?.assigned).toBe(2);
    expect(result.underfilled.find((u) => u.playerId === 'p2')?.assigned).toBe(1);
  });

  it('reports champions in the pool with no eligible owner', () => {
    // Punisher is in the pool but nobody owns it ≥ floor.
    const result = assignWar({
      defenderPool: new Set(['photon', 'punisher']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [
          state('photon', 5, 'A2'),
          state('punisher', 3, 'A0'),
        ]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.unavailableChamps).toEqual(['punisher']);
  });

  it('ignores champions outside the defender pool', () => {
    // Alice has 5 champs, but only Photon is in the pool. Other 4 ignored.
    const result = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [
          state('photon', 5, 'A2'),
          state('hulkbuster', 5, 'A2'),
          state('venom', 5, 'A2'),
          state('mr-fantastic', 5, 'A2'),
          state('odin', 5, 'A2'),
        ]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.totalPlaced).toBe(1);
    expect(result.assignments[0]!.championId).toBe('photon');
  });

  it('full alliance scenario — 10 players, 50 placements, all unique', () => {
    // 60 champs in the pool, 10 players, each owns 10 of the 60 with
    // partial overlap. Should fill all 50 slots with 50 unique champs.
    const pool: string[] = [];
    for (let i = 0; i < 60; i++) pool.push(`c${i}`);
    const players: WarPlayer[] = [];
    for (let i = 0; i < 10; i++) {
      // Each player owns 12 champs in a rolling window so neighbours share 6
      const roster: ChampionState[] = [];
      for (let j = 0; j < 12; j++) {
        const champ = pool[(i * 6 + j) % 60]!;
        roster.push(state(champ, 5, 'A2'));
      }
      players.push(player(`p${i.toString().padStart(2, '0')}`, `player${i}`, roster));
    }

    const result = assignWar({
      defenderPool: new Set(pool),
      floor: { rank: 4, ascension: 'A0' },
      players,
      slotsPerPlayer: 5,
    });

    expect(result.totalPlaced).toBe(50);
    expect(result.underfilled).toHaveLength(0);
    const uniqueChamps = new Set(result.assignments.map((a) => a.championId));
    expect(uniqueChamps.size).toBe(50);
    for (let i = 0; i < 10; i++) {
      const pid = `p${i.toString().padStart(2, '0')}`;
      const count = result.assignments.filter((a) => a.playerId === pid).length;
      expect(count).toBe(5);
    }
  });

  it('deterministic: same inputs produce same outputs across runs', () => {
    const input = {
      defenderPool: new Set(['a', 'b', 'c', 'd']),
      floor: { rank: 4 as const, ascension: 'A0' as const },
      players: [
        player('p1', 'alice', [state('a', 5, 'A2'), state('b', 5, 'A2')]),
        player('p2', 'bob', [state('a', 5, 'A2'), state('c', 5, 'A2')]),
        player('p3', 'cara', [state('b', 5, 'A2'), state('d', 5, 'A2')]),
      ],
      slotsPerPlayer: 5,
    };

    const r1 = assignWar(input);
    const r2 = assignWar(input);
    expect(r1.assignments).toEqual(r2.assignments);
  });
});
