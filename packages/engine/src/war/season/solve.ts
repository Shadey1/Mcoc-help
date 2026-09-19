import { copyStrength, fit, meetsFloor, resolvePicks } from './fit.js';
import { ALL_NODES } from './map.js';
import type {
  ChampionId,
  NodeNumber,
  NodePlacement,
  PlaceInput,
  PlaceResult,
  PlayerId,
  SeasonPlan,
  UnfilledNode,
} from './types.js';

/**
 * Season war planner — min-cost max-flow solver.
 *
 * Ports the mockup's `solve()` verbatim: successive shortest paths using
 * SPFA. Runs in ~15ms on real BG rosters for a full 50-node solve — small
 * enough to re-run on every officer edit without a "solving…" state.
 *
 * Graph:
 *   source → player (cap 5 − pins) → champion-in → champion-out (cap 1;
 *   this is the no-duplicate constraint) → node (cap 1) → sink
 *
 * Costs on the interesting edges:
 *   player  → champion : −round(strength × 10) − (was that player? 40 : 0)
 *   champion → node    : −round(fit × 10) − (was that node? 120 : 0)
 *
 * Fit and strength are on different scales — fit is in the hundreds, so
 * strength (single digits) only breaks ties between owners. The stability
 * bonuses (+4 and +12 in fit units, ×10 in cost) halve churn from a single
 * change without overpowering a real fit improvement.
 *
 * Pins:
 *   - With player: pre-placed. Removed from the flow; player capacity
 *     drops by one. Never re-evaluated.
 *   - Any owner: champion may only go to that node, and that node only
 *     accepts that champion. Encoded by restricting adjacency during
 *     edge construction, plus an outsized negative cost so the solver
 *     always chooses the pin over any other legal edge to that node.
 *
 * Pure. No DOM, no globals, no I/O.
 */
export function solvePlacement(input: PlaceInput): PlaceResult {
  const { plan, players, floor, defenderValues } = input;
  const slotsPerPlayer = input.slotsPerPlayer ?? 5;

  // ── Step 1: index players and champions the solver will see ────────
  // Excluded players contribute zero slots and no roster.
  const activePlayers = players.filter((p) => !plan.excludedPlayers.has(p.id));
  const np = activePlayers.length;
  // A player's "owned at floor" set — one championId per copy they meet.
  const ownedByPlayer = new Map<PlayerId, Map<ChampionId, number>>(); // → copy strength
  const owners = new Map<ChampionId, PlayerId[]>();
  for (const player of activePlayers) {
    const owned = new Map<ChampionId, number>();
    // A player can carry multiple copies of the same champion at different
    // states (5★, 6★ etc.); pick the best copy for war purposes — highest
    // effective rank, then sig.
    for (const state of player.roster) {
      if (!meetsFloor(state, floor)) continue;
      const strength = copyStrength(state);
      const existing = owned.get(state.championId);
      if (existing === undefined || strength > existing) {
        owned.set(state.championId, strength);
      }
    }
    ownedByPlayer.set(player.id, owned);
    for (const c of owned.keys()) {
      const list = owners.get(c);
      if (list) list.push(player.id);
      else owners.set(c, [player.id]);
    }
  }

  // Champion universe: everything that appears in any node's picks, plus
  // anything referenced by a pin, plus anything anyone owns that isn't
  // ruled out by strict mode. For strict-off we include owned champs so
  // they can slot into pickless nodes; for strict-on we only include
  // guide-listed champs.
  const champUniverse = new Set<ChampionId>();
  for (const n of ALL_NODES) {
    for (const c of resolvePicks(plan, n)) champUniverse.add(c);
  }
  for (const pin of Object.values(plan.pins)) champUniverse.add(pin.championId);
  if (!plan.strict) {
    for (const owned of ownedByPlayer.values()) {
      for (const c of owned.keys()) champUniverse.add(c);
    }
  }
  const champList = [...champUniverse];
  const nc = champList.length;
  const champIndex = new Map<ChampionId, number>();
  champList.forEach((c, i) => champIndex.set(c, i));

  // Player index (dense).
  const playerIds = activePlayers.map((p) => p.id);
  const playerIndex = new Map<PlayerId, number>();
  playerIds.forEach((id, i) => playerIndex.set(id, i));

  // ── Step 2: apply pins ─────────────────────────────────────────────
  // A "with-player" pin (playerId non-null) pre-places the champion on
  // the node. It's removed from the flow entirely — the player's slot
  // count drops, the champion vertex is skipped, the node vertex is
  // skipped. An "any-owner" pin restricts adjacency but stays in the
  // flow (which owner picks it up is still solver's call).
  const lockedChampions = new Set<ChampionId>();
  const lockedNodes = new Set<NodeNumber>();
  const lockCountByPlayer = new Map<PlayerId, number>();
  /** any-owner pin: champion → node it must go to. */
  const softChampToNode = new Map<ChampionId, NodeNumber>();
  /** any-owner pin: node → champion it must accept. */
  const softNodeToChamp = new Map<NodeNumber, ChampionId>();
  const prePlacements: Record<NodeNumber, NodePlacement> = {};
  for (const [nodeStr, pin] of Object.entries(plan.pins)) {
    const node = Number(nodeStr) as NodeNumber;
    if (pin.playerId !== null && playerIndex.has(pin.playerId)) {
      // Hard pin: pre-placed. The player must actually own the champion
      // (at floor); an invalid pin is dropped — the caller is expected
      // to validate before pinning, but the engine stays defensive.
      const owned = ownedByPlayer.get(pin.playerId);
      if (!owned?.has(pin.championId)) continue;
      lockedChampions.add(pin.championId);
      lockedNodes.add(node);
      lockCountByPlayer.set(
        pin.playerId,
        (lockCountByPlayer.get(pin.playerId) ?? 0) + 1,
      );
      const rank = pickRankOf(plan, node, pin.championId);
      prePlacements[node] = {
        championId: pin.championId,
        playerId: pin.playerId,
        pickRank: rank,
        pinned: true,
      };
    } else {
      // Soft pin: any owner, but restricted to this node. Skip if
      // nobody owns the champion at floor.
      if (!owners.get(pin.championId)?.length) continue;
      softChampToNode.set(pin.championId, node);
      softNodeToChamp.set(node, pin.championId);
    }
  }

  // ── Step 3: build the flow graph ───────────────────────────────────
  //   Vertex layout (dense integer ids):
  //     S = 0                 source
  //     T = 1                 sink
  //     P0 = 2                first player
  //     CI = P0 + np          first champion-in
  //     CO = CI + nc          first champion-out
  //     N0 = CO + nc − 1      first node vertex is N0 + 1 (nodes 1..50)
  //     V = N0 + 51           total vertex count
  //   Edges stored as flat arrays; each undirected pair is two entries
  //   (forward at i, reverse at i^1). g[u] holds the indices of edges
  //   leaving u.
  const S = 0;
  const T = 1;
  const P0 = 2;
  const CI = P0 + np;
  const CO = CI + nc;
  const N0 = CO + nc - 1;
  const V = N0 + 51;

  const g: number[][] = Array.from({ length: V }, () => []);
  const eu: number[] = [];
  const ev: number[] = [];
  const eCap: number[] = [];
  const eCost: number[] = [];
  const eFlow: number[] = [];
  const addEdge = (u: number, v: number, cap: number, cost: number): void => {
    const i = eu.length;
    eu.push(u, v);
    ev.push(v, u);
    eCap.push(cap, 0);
    eCost.push(cost, -cost);
    eFlow.push(0, 0);
    g[u]!.push(i);
    g[v]!.push(i + 1);
  };

  // Stability lookups — feed the prior placement back into cost.
  const wasAtNode = new Map<ChampionId, NodeNumber>();
  const wasByPlayer = new Map<ChampionId, PlayerId>();
  if (plan.lastPlacement) {
    for (const [nStr, pl] of Object.entries(plan.lastPlacement)) {
      wasAtNode.set(pl.championId, Number(nStr) as NodeNumber);
      wasByPlayer.set(pl.championId, pl.playerId);
    }
  }

  // source → player edges (capacity 5 − hard-pins)
  for (let p = 0; p < np; p++) {
    const id = playerIds[p]!;
    const cap = slotsPerPlayer - (lockCountByPlayer.get(id) ?? 0);
    if (cap <= 0) continue;
    addEdge(S, P0 + p, cap, 0);
    // player → champion-in edges — only for champs this player owns and
    // hasn't been hard-pinned to someone else.
    const owned = ownedByPlayer.get(id)!;
    for (const [c, strength] of owned) {
      if (lockedChampions.has(c)) continue;
      const ci = champIndex.get(c);
      if (ci === undefined) continue;
      const stab = wasByPlayer.get(c) === id ? 40 : 0;
      addEdge(P0 + p, CI + ci, 1, -Math.round(strength * 10) - stab);
    }
  }

  // champion-in → champion-out (capacity 1 = the duplicate ban)
  // and champion-out → node edges
  for (let i = 0; i < nc; i++) {
    const c = champList[i]!;
    if (lockedChampions.has(c)) continue;
    addEdge(CI + i, CO + i, 1, 0);
    for (const n of ALL_NODES) {
      if (lockedNodes.has(n)) continue;
      // any-owner pin restrictions
      const softDest = softChampToNode.get(c);
      if (softDest !== undefined && softDest !== n) continue;
      const softChamp = softNodeToChamp.get(n);
      if (softChamp !== undefined && softChamp !== c) continue;
      // Encode any-owner pin with an outsized negative cost so it beats
      // any real fit score at that node (fit maxes at 3 × 115 × 10 = 3450).
      if (softChamp === c) {
        addEdge(CO + i, N0 + n, 1, -100_000);
        continue;
      }
      const f = fit(c, n, plan, defenderValues);
      if (f === null) continue;
      const stab = wasAtNode.get(c) === n ? 120 : 0;
      addEdge(CO + i, N0 + n, 1, -Math.round(f.score * 10) - stab);
    }
  }

  // node → sink (capacity 1)
  for (const n of ALL_NODES) {
    if (lockedNodes.has(n)) continue;
    addEdge(N0 + n, T, 1, 0);
  }

  // ── Step 4: successive shortest paths with SPFA ────────────────────
  // Push one unit of flow per iteration along the min-cost augmenting
  // path. SPFA (Bellman-Ford variant) handles the negative edge costs
  // that our −fit encoding relies on.
  const INF = Number.POSITIVE_INFINITY;
  const dist = new Float64Array(V);
  const inQueue = new Uint8Array(V);
  const prevEdge = new Int32Array(V);
  for (;;) {
    dist.fill(INF);
    inQueue.fill(0);
    prevEdge.fill(-1);
    dist[S] = 0;
    const queue: number[] = [S];
    inQueue[S] = 1;
    for (let h = 0; h < queue.length; h++) {
      const u = queue[h]!;
      inQueue[u] = 0;
      const du = dist[u]!;
      for (const idx of g[u]!) {
        const cap = eCap[idx]! - eFlow[idx]!;
        if (cap <= 0) continue;
        const v = ev[idx]!;
        const nd = du + eCost[idx]!;
        if (nd < dist[v]!) {
          dist[v] = nd;
          prevEdge[v] = idx;
          if (!inQueue[v]) {
            inQueue[v] = 1;
            queue.push(v);
          }
        }
      }
    }
    if (dist[T] === INF) break;
    // Walk back to source, pushing 1 unit along the path.
    for (let v = T; v !== S; ) {
      const idx = prevEdge[v]!;
      eFlow[idx] = eFlow[idx]! + 1;
      eFlow[idx ^ 1] = eFlow[idx ^ 1]! - 1;
      v = eu[idx]!;
    }
  }

  // ── Step 5: extract placements from saturated edges ────────────────
  // A saturated (flow=1) player→champion edge tells us which player is
  // supplying which champion. A saturated champion→node edge tells us
  // where the champion landed.
  const champToPlayerIdx = new Map<number, number>(); // champIndex → playerIndex
  for (let p = 0; p < np; p++) {
    for (const idx of g[P0 + p]!) {
      if (idx % 2 === 1) continue; // reverse edge
      if (eFlow[idx] !== 1) continue;
      const v = ev[idx]!;
      if (v < CI || v >= CO) continue;
      champToPlayerIdx.set(v - CI, p);
    }
  }
  const placements: Record<NodeNumber, NodePlacement> = { ...prePlacements };
  for (let i = 0; i < nc; i++) {
    for (const idx of g[CO + i]!) {
      if (idx % 2 === 1) continue;
      if (eFlow[idx] !== 1) continue;
      const v = ev[idx]!;
      if (v <= N0 || v > N0 + 50) continue;
      const node = (v - N0) as NodeNumber;
      const c = champList[i]!;
      const pIdx = champToPlayerIdx.get(i);
      if (pIdx === undefined) continue;
      const playerId = playerIds[pIdx]!;
      const pinnedSoft = softNodeToChamp.get(node) === c;
      placements[node] = {
        championId: c,
        playerId,
        pickRank: pickRankOf(plan, node, c),
        pinned: pinnedSoft,
      };
    }
  }

  // ── Step 6: unfilled + moved diffs ─────────────────────────────────
  const unfilled: UnfilledNode[] = [];
  for (const n of ALL_NODES) {
    if (placements[n]) continue;
    unfilled.push({ node: n, reason: unfilledReason(plan, n, owners, softNodeToChamp) });
  }
  const moved: NodeNumber[] = [];
  if (plan.lastPlacement) {
    for (const n of ALL_NODES) {
      const before = plan.lastPlacement[n];
      const after = placements[n];
      const changed =
        (before?.championId ?? null) !== (after?.championId ?? null) ||
        (before?.playerId ?? null) !== (after?.playerId ?? null);
      if (changed) moved.push(n);
    }
  }

  return { placements, unfilled, moved };
}

/** Compute the pick rank of a champion at a node, respecting overrides.
 *  Returns −1 if off the list, −2 if the node has no picks. */
function pickRankOf(plan: SeasonPlan, node: NodeNumber, championId: ChampionId): number {
  const picks = resolvePicks(plan, node);
  if (picks.length === 0) return -2;
  const i = picks.indexOf(championId);
  return i >= 0 ? i : -1;
}

function unfilledReason(
  plan: SeasonPlan,
  node: NodeNumber,
  owners: Map<ChampionId, PlayerId[]>,
  softNodeToChamp: Map<NodeNumber, ChampionId>,
): string {
  const soft = softNodeToChamp.get(node);
  if (soft) {
    const list = owners.get(soft) ?? [];
    if (list.length === 0) {
      return `Pinned to ${soft} but nobody in the battlegroup owns them.`;
    }
    return `Pinned to ${soft} but their owner has no free slot.`;
  }
  const picks = resolvePicks(plan, node);
  if (picks.length === 0) {
    return 'No picks and no eligible champion had a free slot.';
  }
  if (plan.strict) {
    return 'Strict mode on — no listed pick had an eligible owner with a free slot.';
  }
  return 'No eligible champion had a free slot for this node.';
}
