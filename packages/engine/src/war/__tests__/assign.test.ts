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
  rank: 3 | 4 | 5,
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

describe('assignWar — scarcity-first greedy placement', () => {
  it('scarcity-first locks rare champs in before slot caps eat them', () => {
    // Without scarcity-first, a naive rank-tier greedy would fill alice's
    // 5 slots with her 5 popular R5A2 champs and skip her rare R4A0 — the
    // rank tier of a popular R5 always beats a rare R4. Scarcity-first
    // processes the rare champion first (only alice owns it) so it gets
    // locked in before the popular ones eat her slot budget.
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

    const aliceChamps = result.assignments
      .filter((a) => a.playerId === 'p1')
      .map((a) => a.championId);
    expect(aliceChamps).toContain('rare-modok');
    expect(aliceChamps).toHaveLength(5);
    // Bob takes the popular ones alice couldn't fit.
    expect(result.totalPlaced).toBe(7);
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

  it('higher rank always beats lower regardless of ascension', () => {
    // alice has R4 A2 (1.16x), bob has R5 A0 (1.0x). Rank wins.
    const result = assignWar({
      defenderPool: new Set(['photon']),
      floor: { rank: 4, ascension: 'A0' },
      players: [
        player('p1', 'alice', [state('photon', 4, 'A2')]),
        player('p2', 'bob', [state('photon', 5, 'A0')]),
      ],
      slotsPerPlayer: 5,
    });

    expect(result.assignments[0]!.playerId).toBe('p2');
    expect(result.assignments[0]!.rank).toBe(5);
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
