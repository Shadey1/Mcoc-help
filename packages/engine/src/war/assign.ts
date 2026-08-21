import type { Ascension, ChampionState } from '../types.js';
import type {
  WarAssignment,
  WarInput,
  WarPlayerId,
  WarResult,
  WarStateFloor,
  WarTier,
  WarUnderfilledPlayer,
} from './types.js';

/**
 * Base power for an unascended rank. R6 sits a full ascension step above R5
 * because in-game R5 A2 and R6 A0 are equivalent power tiers — going up
 * from R5 max takes a big jump (dual T6 catalysts) that's worth two
 * ascension-equivalents, not one.
 *
 * R1/R2 are out of scope for war (no defenders sit there) but the table
 * carries placeholder values for type completeness.
 */
const RANK_BASE: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 7 };
const ASC_TIER: Record<Ascension, number> = { A0: 0, A1: 1, A2: 2 };

/**
 * Effective power tier on the in-game ladder:
 *   R4 < R4 A1 ≡ R5 A0 < R4 A2 ≡ R5 A1 < R5 A2 ≡ R6 A0 < R6 A1 < R6 A2.
 * Computed as RANK_BASE[rank] + ascension level. Tied tiers (R4 A1 and
 * R5 A0, etc.) are deliberately interchangeable; sig breaks the tie.
 */
export function effectiveRank(rank: number, ascension: Ascension): number {
  return (RANK_BASE[rank] ?? rank) + ASC_TIER[ascension];
}

/**
 * True if the state meets-or-exceeds the floor by effective rank.
 * E.g. floor R5 (effective 5) accepts R4 A1 (5), R4 A2 (6), R5 A0 (5),
 * R5 A1 (6), R5 A2 (7) — but rejects R4 A0 (4).
 */
function meetsFloor(state: ChampionState, floor: WarStateFloor): boolean {
  return (
    effectiveRank(state.rank, state.ascension) >=
    effectiveRank(floor.rank, floor.ascension)
  );
}

/**
 * Score a state for the output sort within a player's row. Effective rank
 * dominates, sig is the within-tier tiebreaker. Exposed so callers can
 * mirror the engine's row order.
 */
export function assignmentStateScore(a: WarAssignment): number {
  return effectiveRank(a.rank, a.ascension) * 1_000 + a.sig;
}

/**
 * Placement weight for the max-weight matching. Encodes STRICT lex order:
 *   L1 — Total S count.        (dominates all lower levels)
 *   L2 — Total S effective-rank sum.
 *   L3 — Total M count.
 *   L4 — Total M effective-rank sum.
 *   L5 — Total B count.
 *   L6 — Total B effective-rank sum.
 *   L7 — Sig sum (global minor tiebreak).
 *
 * Per placement, weight decomposes as `TIER_WEIGHT[t] + EFF_WEIGHT[t] * eff
 * + sig`. Coefficients are cascaded so any level-N change dominates the
 * summed max of all lower levels — verified in the range analysis below.
 *
 * The interpretation:
 *   - "Highest-ranked S defenders first, no matter what" (alliance rule):
 *     boosting one S placement's effective rank by 1 (+EFF_S = +2e7)
 *     dominates losing an entire M placement (-TIER_M = -1e5). The old
 *     tier-composition scheme would reject that trade; this one accepts
 *     it, because the alliance officer's preference is stronger meta
 *     defenders on the board even if a filler slot drops to Base.
 *   - Within a tier, effective rank still beats sig — sig is a global
 *     minor tiebreak, not a lex level of its own.
 *
 * Range analysis (safe int budget 2^53 ≈ 9e15):
 *   Max S count ≤ 30, max eff = 8 → max S state per placement = 8 * 2e7
 *   = 1.6e8; max sum = 30 * (1e10 + 1.6e8) ≈ 3.05e11. Max M sum ≈ 1.08e7,
 *   max B sum ≈ 8e4. Grand total ≤ ~3e11 — well within safe range.
 */
const TIER_WEIGHT: Record<WarTier, number> = {
  strong: 10_000_000_000, // L1: dominates all S state + all M + all B
  mid: 100_000,           // L3: dominates all M state + all B
  base: 1,                // L5: dominates all B state
};
const EFF_WEIGHT: Record<WarTier, number> = {
  strong: 20_000_000, // L2: > any M/B change combined (max ≈ 1.1e7)
  mid: 1_000,         // L4: > any B change combined (max ≈ 800)
  base: 100,          // L6: > sig contributions
};

function placementWeight(championTier: WarTier, state: ChampionState): number {
  return (
    TIER_WEIGHT[championTier] +
    EFF_WEIGHT[championTier] * effectiveRank(state.rank, state.ascension) +
    state.sig
  );
}

type Candidate = {
  playerId: WarPlayerId;
  state: ChampionState;
};

/**
 * Min-cost max-flow bipartite matching.
 *
 * Structure:
 *   - Source (node 0)
 *   - Champion nodes (1 .. N)
 *   - Slot nodes    (N+1 .. N+M)  — one per (player, slotIndex)
 *   - Sink (N+M+1)
 *
 * Edges:
 *   Source → Champion i           cap 1, cost 0
 *   Champion i → Slot(p, k)       cap 1, cost -placementWeight(i, p's state)
 *                                  (edge exists only if p owns i at ≥ floor)
 *   Slot(p, k) → Sink             cap 1, cost 0
 *
 * SPFA (Bellman-Ford queue variant) finds the shortest-cost augmenting
 * path each iteration; since our costs are negative-weight-encoded, the
 * shortest path is the highest-weight placement/rearrangement. Iterates
 * until no more augmenting paths exist. Result is max-cardinality (every
 * slot filled that structurally can be) AND max-weight within that
 * cardinality (the specific matching optimises tier + state).
 *
 * Determinism: edges are added in a fixed order (champions sorted by id,
 * owners within a champion sorted by playerId, slots numbered 0..k-1).
 * SPFA processes nodes in FIFO queue order, edges in adjacency-list order.
 * Same input → same edge order → same augmenting sequence → same result.
 *
 * Runtime O(V·E·flow) with a small constant. At realistic war scale
 * (~200 nodes, ~2K edges, ~50 flow) this is well under 10M ops.
 */
class MinCostMaxFlow {
  private readonly n: number;
  private readonly head: number[];
  private readonly next: number[] = [];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly cost: number[] = [];

  constructor(n: number) {
    this.n = n;
    this.head = new Array(n).fill(-1);
  }

  addEdge(u: number, v: number, capacity: number, cost: number): void {
    this.to.push(v);
    this.cap.push(capacity);
    this.cost.push(cost);
    this.next.push(this.head[u]!);
    this.head[u] = this.to.length - 1;

    this.to.push(u);
    this.cap.push(0);
    this.cost.push(-cost);
    this.next.push(this.head[v]!);
    this.head[v] = this.to.length - 1;
  }

  /** Returns { flow, cost, prevEdge } for reconstructing the matching. */
  solve(source: number, sink: number): { flow: number; cost: number } {
    let totalFlow = 0;
    let totalCost = 0;
    const dist = new Array(this.n).fill(Infinity);
    const prevNode = new Array(this.n).fill(-1);
    const prevEdge = new Array(this.n).fill(-1);
    const inQueue = new Array(this.n).fill(false);

    while (true) {
      dist.fill(Infinity);
      prevNode.fill(-1);
      prevEdge.fill(-1);
      inQueue.fill(false);
      dist[source] = 0;

      const queue: number[] = [source];
      inQueue[source] = true;
      let head = 0;
      while (head < queue.length) {
        const u = queue[head++]!;
        inQueue[u] = false;
        for (let e = this.head[u]!; e !== -1; e = this.next[e]!) {
          if (this.cap[e]! <= 0) continue;
          const nd = dist[u]! + this.cost[e]!;
          const v = this.to[e]!;
          if (nd < dist[v]!) {
            dist[v] = nd;
            prevNode[v] = u;
            prevEdge[v] = e;
            if (!inQueue[v]) {
              queue.push(v);
              inQueue[v] = true;
            }
          }
        }
      }

      if (dist[sink] === Infinity) break;

      // Unit capacities everywhere — bottleneck is always 1.
      let v = sink;
      while (v !== source) {
        const e = prevEdge[v]!;
        this.cap[e]!--;
        this.cap[e ^ 1]!++;
        v = prevNode[v]!;
      }
      totalFlow++;
      totalCost += dist[sink]!;
    }

    return { flow: totalFlow, cost: totalCost };
  }

  /**
   * After solve(), walk the residual graph to recover which slot each
   * champion flows into. Returns a Map of championNodeIndex → slotNodeIndex.
   */
  recoverMatching(
    championNodes: number[],
    isChampionEdge: (edgeIndex: number) => boolean,
  ): Map<number, number> {
    const matching = new Map<number, number>();
    for (const c of championNodes) {
      for (let e = this.head[c]!; e !== -1; e = this.next[e]!) {
        // Forward edge from champion to slot was used if capacity dropped to 0.
        if (this.cap[e] === 0 && isChampionEdge(e)) {
          matching.set(c, this.to[e]!);
          break;
        }
      }
    }
    return matching;
  }
}

/**
 * War defence placement — maximum-weight bipartite matching.
 *
 * Optimisation criteria, in strict lex priority:
 *   1. NO DUPLICATES — each champion appears at most once across the table.
 *   2. ABOVE FLOOR — every placement is at or above the effective-tier
 *      floor selected by the officer.
 *   3. MAX CARDINALITY — fill every slot the pool/roster intersection
 *      structurally allows.
 *   4. TIER COMPOSITION — within max cardinality, prefer more Strong
 *      placements over more Mid, and more Mid over more Base. Enforced
 *      by TIER_STRIDE dominating any state-score change.
 *   5. HIGHEST-STATE OWNER WINS — for each placed champion, pick the owner
 *      with the highest effective rank (R6 > R5 A2 ≡ R6 A0 > R5 A1 > …).
 *      Sig breaks ties within an effective rank.
 *   6. FAIR SLOT DISTRIBUTION — a same-tier redistribution post-pass
 *      evens out per-player slot counts without dropping any placement's
 *      tier or effective rank.
 *
 * Bug this replaces (Jannik's report, Aug 2026): the old Kuhn's-based
 * greedy could give Nico Minoru to a R4 owner while the sole R5 owner
 * of Nico (Jannik) sat with M-tier R4 filler in their row. Max cardinality
 * was correct (50/50) but the specific matching chosen within the max
 * was arbitrary — Kuhn's doesn't optimise for tier or state. Min-cost
 * max-flow with negated placement-weight makes cardinality primary and
 * weight secondary, which is exactly the lex order above.
 *
 * Runtime is O(V·E·flow), trivial at war scale. See MinCostMaxFlow above
 * for the graph structure.
 */
export function assignWar(input: WarInput): WarResult {
  const slotsPerPlayer = input.slotsPerPlayer ?? 5;

  // Group eligible (player, state) pairs by champion id.
  const candidatesByChamp = new Map<string, Candidate[]>();
  for (const player of input.players) {
    for (const state of player.roster) {
      if (!input.defenderPool.has(state.championId)) continue;
      if (!meetsFloor(state, input.floor)) continue;
      const existing = candidatesByChamp.get(state.championId);
      if (existing) {
        existing.push({ playerId: player.id, state });
      } else {
        candidatesByChamp.set(state.championId, [{ playerId: player.id, state }]);
      }
    }
  }

  const tierFor = (championId: string): WarTier =>
    input.defenderPool.get(championId) ?? 'mid';

  const playerNameLookup = new Map<WarPlayerId, string>();
  for (const p of input.players) playerNameLookup.set(p.id, p.name);

  // Deterministic node numbering. Champions sorted by id; players sorted by
  // id; slots numbered 0..k-1 per player. Same input → same edge order →
  // same augmenting sequence in SPFA.
  const championIds = [...candidatesByChamp.keys()].sort();
  const playerIds = input.players.map((p) => p.id).slice().sort();

  const SOURCE = 0;
  const championNodeOf = new Map<string, number>();
  championIds.forEach((id, i) => championNodeOf.set(id, 1 + i));

  const slotNodeOf = new Map<string, number>(); // "playerId::slotIndex" -> node
  let slotNodeCounter = 1 + championIds.length;
  for (const pid of playerIds) {
    for (let k = 0; k < slotsPerPlayer; k++) {
      slotNodeOf.set(`${pid}::${k}`, slotNodeCounter++);
    }
  }
  const SINK = slotNodeCounter;
  const totalNodes = SINK + 1;

  const mcmf = new MinCostMaxFlow(totalNodes);

  // Source → Champion. cap 1, cost 0. Order matters for determinism —
  // sorted championIds already.
  for (const id of championIds) {
    mcmf.addEdge(SOURCE, championNodeOf.get(id)!, 1, 0);
  }

  // Champion → Slot. cap 1, cost -placementWeight. Add owners in
  // playerId asc order (matches playerIds sort), slot k asc.
  // Track which edges came out of a champion (for matching recovery).
  const isChampionEdgeSet = new Set<number>();
  for (const id of championIds) {
    const champNode = championNodeOf.get(id)!;
    const tier = tierFor(id);
    const owners = candidatesByChamp.get(id)!;
    // Sort owners by playerId asc for determinism (edge insertion order).
    const sortedOwners = owners.slice().sort((a, b) =>
      a.playerId.localeCompare(b.playerId),
    );
    for (const owner of sortedOwners) {
      const w = placementWeight(tier, owner.state);
      for (let k = 0; k < slotsPerPlayer; k++) {
        const slotNode = slotNodeOf.get(`${owner.playerId}::${k}`)!;
        // The forward-edge index in the MCMF internal edge array is
        // determined by the addEdge call sequence — record it now.
        const forwardEdgeIndex = (mcmf as unknown as { to: number[] }).to.length;
        mcmf.addEdge(champNode, slotNode, 1, -w);
        isChampionEdgeSet.add(forwardEdgeIndex);
      }
    }
  }

  // Slot → Sink. cap 1, cost 0.
  for (const [, slotNode] of slotNodeOf) {
    mcmf.addEdge(slotNode, SINK, 1, 0);
  }

  mcmf.solve(SOURCE, SINK);

  // Recover the matching: for each champion node, find the slot node it
  // flowed into by scanning outgoing edges with cap = 0.
  const championNodes = championIds.map((id) => championNodeOf.get(id)!);
  const matching = mcmf.recoverMatching(championNodes, (e) => isChampionEdgeSet.has(e));

  // Reverse the slot-node lookup for reconstruction.
  const nodeToSlotKey = new Map<number, string>();
  for (const [key, node] of slotNodeOf) nodeToSlotKey.set(node, key);

  const assignments: WarAssignment[] = [];
  const slotsUsed = new Map<WarPlayerId, number>();
  for (const p of input.players) slotsUsed.set(p.id, 0);

  const championIdByNode = new Map<number, string>();
  for (const [id, node] of championNodeOf) championIdByNode.set(node, id);

  for (const [champNode, slotNode] of matching) {
    const champId = championIdByNode.get(champNode)!;
    const slotKey = nodeToSlotKey.get(slotNode)!;
    const sepIdx = slotKey.lastIndexOf('::');
    const playerId = slotKey.slice(0, sepIdx);
    const owners = candidatesByChamp.get(champId)!;
    const owner = owners.find((o) => o.playerId === playerId);
    if (!owner) continue;

    assignments.push({
      playerId,
      playerName: playerNameLookup.get(playerId) ?? playerId,
      championId: champId,
      rank: owner.state.rank,
      ascension: owner.state.ascension,
      sig: owner.state.sig,
      tier: tierFor(champId),
    });
    slotsUsed.set(playerId, (slotsUsed.get(playerId) ?? 0) + 1);
  }

  // Same-effective-rank slot rebalance. MCMF can leave the distribution
  // uneven when many co-owned same-tier placements are structurally
  // interchangeable (e.g. 6 champs everyone owns at R5 A2 → could all
  // land on one player). This pass moves placements between over- and
  // under-filled players without dropping tier or effective rank, so
  // total weight is preserved (up to ±sig per swap).
  redistributeForFairness(assignments, candidatesByChamp, slotsUsed, playerNameLookup);

  // Output sort: by playerId asc, then state desc within each player.
  assignments.sort((a, b) => {
    if (a.playerId !== b.playerId) return a.playerId.localeCompare(b.playerId);
    return assignmentStateScore(b) - assignmentStateScore(a);
  });

  // Underfilled players
  const underfilled: WarUnderfilledPlayer[] = [];
  for (const p of input.players) {
    const assigned = slotsUsed.get(p.id) ?? 0;
    if (assigned < slotsPerPlayer) {
      underfilled.push({
        playerId: p.id,
        playerName: p.name,
        assigned,
        needed: slotsPerPlayer,
      });
    }
  }

  // Unavailable champions (in pool but no eligible owner)
  const unavailableChamps: string[] = [];
  for (const championId of input.defenderPool.keys()) {
    if (!candidatesByChamp.has(championId)) {
      unavailableChamps.push(championId);
    }
  }
  unavailableChamps.sort();

  return {
    assignments,
    underfilled,
    unavailableChamps,
    totalPlaced: assignments.length,
  };
}

/**
 * Max-min redistribution post-pass. Walks (max-count player, min-count
 * player) pairs and reassigns shared-tier placements from the over-filled
 * player to the under-filled one. Mutates `assignments` and `slotsUsed`.
 *
 * Convergence: each swap reduces (max − min) by 1 or leaves the pair
 * unchanged if no tier-preserving swap exists. The safety iteration cap
 * (200) is well above any realistic war scale; the loop also exits early
 * as soon as the slot-count gap is ≤ 1 (perfect balance modulo rounding).
 */
function redistributeForFairness(
  assignments: WarAssignment[],
  candidatesByChamp: Map<string, Candidate[]>,
  slotsUsed: Map<WarPlayerId, number>,
  playerNameLookup: Map<WarPlayerId, string>,
): void {
  let safetyIters = 0;
  while (safetyIters++ < 200) {
    let maxCount = -Infinity;
    let minCount = Infinity;
    for (const count of slotsUsed.values()) {
      if (count > maxCount) maxCount = count;
      if (count < minCount) minCount = count;
    }
    if (maxCount - minCount <= 1) return;

    let swapped = false;
    for (let i = 0; i < assignments.length && !swapped; i++) {
      const curr = assignments[i]!;
      const currCount = slotsUsed.get(curr.playerId) ?? 0;
      if (currCount !== maxCount) continue;
      const currTier = effectiveRank(curr.rank, curr.ascension);

      const candidates = candidatesByChamp.get(curr.championId) ?? [];
      for (const alt of candidates) {
        if (alt.playerId === curr.playerId) continue;
        const altCount = slotsUsed.get(alt.playerId) ?? 0;
        if (altCount !== minCount) continue;
        const altTier = effectiveRank(alt.state.rank, alt.state.ascension);
        // Tier preservation: never downgrade a placement just to balance
        // the row. R5 A2 placements stay R5 A2; swapping to a R5 A0 owner
        // would lower the overall defence strength.
        if (altTier !== currTier) continue;

        assignments[i] = {
          playerId: alt.playerId,
          playerName: playerNameLookup.get(alt.playerId) ?? alt.playerId,
          championId: curr.championId,
          rank: alt.state.rank,
          ascension: alt.state.ascension,
          sig: alt.state.sig,
          tier: curr.tier,
        };
        slotsUsed.set(curr.playerId, currCount - 1);
        slotsUsed.set(alt.playerId, altCount + 1);
        swapped = true;
        // Break out of the alt loop: `curr` is now stale (assignments[i] was
        // replaced) and any further inner iteration would double-swap and
        // corrupt slotsUsed. Restart the outer loop with fresh min/max.
        break;
      }
    }

    if (!swapped) return;
  }
}
