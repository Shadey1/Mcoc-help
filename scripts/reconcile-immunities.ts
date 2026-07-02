/**
 * Reconciliation runner.
 *
 * Reads every immunity data source, feeds per (champion, effect) votes
 * into @prestige-tools/engine's reconcile(), and writes two artefacts:
 *
 *   data/immunities/_locks.json      — auto-shipped values (lock-* tiers)
 *   data/immunities/_review-queue.md — human-confirm queue (flag-* tiers)
 *
 * The web app consumes _locks.json (via the immunities loader). The
 * markdown queue is a working file; entries land in _locks.json only
 * after a human promotes them (via manual edit or, eventually, a
 * small promote script).
 *
 * Source model:
 *  - abilityText: MCOCHUB pill tags + MCOCHUB kit-text parse merged.
 *    Both derive from mcochub.insaneskull.com; treating them as
 *    independent votes would produce fake corroboration. Kit-text
 *    wins per effect when both fire (more specific — has resist %).
 *  - fixture: hand-curated four-signal marks.
 *  - chart: transcribed from GuiaMTC. Empty until we ingest the
 *    small cell-set the transcription pass produces.
 *  - auntm: frozen mid-2024; not wired yet.
 *
 * Rerun after any source changes:
 *   pnpm reconcile-immunities
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  reconcile,
  type Confidence,
  type Reconciled,
  type SourceName,
  type Verdict,
  type Vote,
} from '../packages/engine/src/immunity-reconciliation.js';
import type { EffectName } from '../packages/engine/src/immunities.js';

const LOCKS_PATH = 'data/immunities/_locks.json';
const QUEUE_PATH = 'data/immunities/_review-queue.md';

const SEED_PATH = 'data/champions/seed.json';
const KIT_PATH = 'data/champions/immunities-kit-derived.json';
const PILL_PATH = 'data/champions/immunities-backfill.json';
const FIXTURE_PATH = 'data/champions/immunities-fixture.json';
const CHART_PATH = 'data/champions/immunities-chart.json';
const AUNTM_PATH = 'data/champions/immunities-auntm.json';

// ─── Read sources ──────────────────────────────────────────────────────

type SourceBand =
  | { band: 'immune' }
  | { band: 'resist'; qual: string }
  | { band: 'mechanic'; qual: 'Purify' | 'Duration' }
  | { band: 'synergy'; partner: string };

type SourceFile = {
  _meta?: Record<string, unknown>;
  champions: Record<string, Record<string, SourceBand>>;
};

function loadOptional(path: string): SourceFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as SourceFile;
}

function loadSeed(): Map<string, number | undefined> {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as {
    champions: Array<{ id: string; released?: string }>;
  };
  const map = new Map<string, number | undefined>();
  for (const c of seed.champions) {
    const year = c.released ? parseInt(c.released, 10) : undefined;
    map.set(c.id, Number.isFinite(year) ? year : undefined);
  }
  return map;
}

// ─── Convert file → votes ──────────────────────────────────────────────

function bandToVote(source: SourceName, band: SourceBand): Vote {
  if (band.band === 'immune') return { source, band: 'immune' };
  if (band.band === 'resist') {
    const parsed = parseInt(band.qual, 10);
    return {
      source,
      band: 'resist',
      value: Number.isFinite(parsed) ? parsed : 0,
    };
  }
  if (band.band === 'mechanic')
    return { source, band: 'mechanic', qual: band.qual };
  return { source, band: 'synergy', partner: band.partner };
}

/**
 * Merge MCOCHUB pill backfill + kit-derived into a single abilityText
 * view. Both derive from MCOCHUB pages, so their agreement isn't
 * independent evidence — treat as one source vote per effect. Kit-text
 * wins per effect (has the resist % that pill can't express); pill
 * fills in effects kit-text couldn't parse (immune declarations that
 * MCOCHUB tagged but the parser didn't hit).
 */
function mergeAbilityText(
  pill: SourceFile | null,
  kit: SourceFile | null,
): Record<string, Record<string, SourceBand>> {
  const out: Record<string, Record<string, SourceBand>> = {};
  const ids = new Set<string>([
    ...Object.keys(pill?.champions ?? {}),
    ...Object.keys(kit?.champions ?? {}),
  ]);
  for (const id of ids) {
    const p = pill?.champions[id] ?? {};
    const k = kit?.champions[id] ?? {};
    out[id] = { ...p, ...k };
  }
  return out;
}

// ─── Reconcile every cell ──────────────────────────────────────────────

type CellReconciled = Reconciled & {
  champion: string;
  effect: EffectName;
};

function reconcileAll(
  abilityText: Record<string, Record<string, SourceBand>>,
  fixture: SourceFile | null,
  chart: SourceFile | null,
  auntm: SourceFile | null,
  releaseYear: Map<string, number | undefined>,
): CellReconciled[] {
  const out: CellReconciled[] = [];
  // Union of every (champion, effect) any source has an opinion on.
  const perChamp: Map<string, Set<string>> = new Map();
  function add(source: Record<string, Record<string, SourceBand>>) {
    for (const [champ, effects] of Object.entries(source)) {
      const set = perChamp.get(champ) ?? new Set<string>();
      for (const eff of Object.keys(effects)) set.add(eff);
      perChamp.set(champ, set);
    }
  }
  add(abilityText);
  if (fixture) add(fixture.champions);
  if (chart) add(chart.champions);
  if (auntm) add(auntm.champions);

  for (const [champ, effects] of perChamp) {
    for (const eff of effects) {
      const votes: Vote[] = [];
      const a = abilityText[champ]?.[eff];
      if (a) votes.push(bandToVote('abilityText', a));
      const f = fixture?.champions[champ]?.[eff];
      if (f) votes.push(bandToVote('fixture', f));
      const c = chart?.champions[champ]?.[eff];
      if (c) votes.push(bandToVote('chart', c));
      const u = auntm?.champions[champ]?.[eff];
      if (u) votes.push(bandToVote('auntm', u));

      const r = reconcile(votes, { releaseYear: releaseYear.get(champ) });
      if (!r) continue;
      out.push({ ...r, champion: champ, effect: eff as EffectName });
    }
  }
  return out;
}

// ─── Write locks.json ─────────────────────────────────────────────────

type LocksOutput = {
  generated: string;
  chartDated: string;
  /** Reconciliation-level counts. Consumed by the web preview banner. */
  _meta: {
    cellsTotal: number;
    cellsLocked: number;
    cellsInReviewQueue: number;
    conflicts: number;
    singleSource: number;
    staleOnly: number;
    uniqueChampsLocked: number;
    uniqueChampsProvisional: number;
  };
  champions: Record<
    string,
    Record<
      string,
      {
        band: Verdict['band'];
        value?: number;
        qual?: string;
        partner?: string;
        confidence: Confidence;
        _review?: true;
      }
    >
  >;
};

function toLockRow(r: CellReconciled) {
  const row: LocksOutput['champions'][string][string] = {
    band: r.verdict.band,
    confidence: r.confidence,
  };
  if (r.verdict.value !== undefined) row.value = r.verdict.value;
  if (r.verdict.qual !== undefined) row.qual = r.verdict.qual;
  if (r.verdict.partner !== undefined) row.partner = r.verdict.partner;
  if (r.reviewFlag) row._review = true;
  return row;
}

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeLocks(cells: CellReconciled[]) {
  const locks = cells.filter((c) => c.confidence.startsWith('lock-'));
  const grouped: LocksOutput['champions'] = {};
  for (const c of locks) {
    (grouped[c.champion] = grouped[c.champion] ?? {})[c.effect] = toLockRow(c);
  }
  const buckets = {
    conflicts: 0,
    singleSource: 0,
    staleOnly: 0,
  };
  for (const c of cells) {
    if (c.confidence === 'flag-conflict') buckets.conflicts++;
    else if (c.confidence === 'flag-single') buckets.singleSource++;
    else if (c.confidence === 'flag-stale-only') buckets.staleOnly++;
  }
  const uniqueLocked = new Set(locks.map((c) => c.champion));
  const uniqueProvisional = new Set(
    cells
      .filter((c) => c.confidence.startsWith('flag-'))
      .map((c) => c.champion),
  );
  const payload: LocksOutput = {
    generated: new Date().toISOString().slice(0, 10),
    chartDated: '2026-06',
    _meta: {
      cellsTotal: cells.length,
      cellsLocked: locks.length,
      cellsInReviewQueue: cells.length - locks.length,
      conflicts: buckets.conflicts,
      singleSource: buckets.singleSource,
      staleOnly: buckets.staleOnly,
      uniqueChampsLocked: uniqueLocked.size,
      uniqueChampsProvisional: uniqueProvisional.size,
    },
    champions: grouped,
  };
  ensureDir(LOCKS_PATH);
  writeFileSync(LOCKS_PATH, JSON.stringify(payload, null, 2) + '\n');
}

// ─── Write review-queue.md ────────────────────────────────────────────

function describeVerdict(v: Verdict): string {
  if (v.band === 'immune') return 'immune';
  if (v.band === 'resist') return `resist ${v.value ?? '?'}%`;
  if (v.band === 'mechanic') return `mechanic ${v.qual ?? '?'}`;
  return `syn: ${v.partner ?? '?'}`;
}

function describeVote(v: Vote): string {
  if (v.band === 'immune') return `${v.source}=immune`;
  if (v.band === 'resist') return `${v.source}=resist ${v.value ?? '?'}%`;
  if (v.band === 'mechanic')
    return `${v.source}=mechanic ${v.qual ?? '?'}`;
  return `${v.source}=syn:${v.partner ?? '?'}`;
}

function championDisplayName(id: string, seedNames: Map<string, string>): string {
  return seedNames.get(id) ?? id;
}

function writeQueue(
  cells: CellReconciled[],
  seedNames: Map<string, string>,
): void {
  const conflicts = cells.filter((c) => c.confidence === 'flag-conflict');
  const singles = cells.filter((c) => c.confidence === 'flag-single');
  const stale = cells.filter((c) => c.confidence === 'flag-stale-only');

  const lines: string[] = [];
  lines.push('# Immunity review queue');
  lines.push('');
  lines.push(
    'Auto-generated by scripts/reconcile-immunities.ts. Do not edit by hand — resolve entries by updating the source files (fixture / chart / etc.) and re-run.',
  );
  lines.push('');
  lines.push(
    `Generated: ${new Date().toISOString().slice(0, 10)} · Conflicts: ${conflicts.length} · Single-source: ${singles.length} · Stale-only: ${stale.length}`,
  );
  lines.push('');

  function section(title: string, items: CellReconciled[]) {
    lines.push(`## ${title}`);
    lines.push('');
    if (items.length === 0) {
      lines.push('_None._');
      lines.push('');
      return;
    }
    items.sort((a, b) => {
      const an = championDisplayName(a.champion, seedNames);
      const bn = championDisplayName(b.champion, seedNames);
      if (an !== bn) return an.localeCompare(bn);
      return a.effect.localeCompare(b.effect);
    });
    for (const c of items) {
      const name = championDisplayName(c.champion, seedNames);
      const verdict = describeVerdict(c.verdict);
      const votes = c.votes.map(describeVote).join(', ');
      const note = c.note ? ` · ${c.note}` : '';
      lines.push(
        `- [ ] **${name}** · ${c.effect} — verdict: ${verdict}. Sources: ${votes}.${note}`,
      );
    }
    lines.push('');
  }

  section('Conflicts (resolve first)', conflicts);
  section('Single-source', singles);
  section('Stale-source-only', stale);

  ensureDir(QUEUE_PATH);
  writeFileSync(QUEUE_PATH, lines.join('\n'));
}

// ─── Main ─────────────────────────────────────────────────────────────

function main() {
  const releaseYear = loadSeed();
  const seedNames = new Map<string, string>();
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as {
    champions: Array<{ id: string; name: string }>;
  };
  for (const c of seed.champions) seedNames.set(c.id, c.name);

  const pill = loadOptional(PILL_PATH);
  const kit = loadOptional(KIT_PATH);
  const fixture = loadOptional(FIXTURE_PATH);
  const chart = loadOptional(CHART_PATH);
  const auntm = loadOptional(AUNTM_PATH);

  const abilityText = mergeAbilityText(pill, kit);
  const cells = reconcileAll(abilityText, fixture, chart, auntm, releaseYear);

  writeLocks(cells);
  writeQueue(cells, seedNames);

  const buckets = {
    'lock-3src': 0,
    'lock-2src': 0,
    'flag-single': 0,
    'flag-conflict': 0,
    'flag-stale-only': 0,
  };
  for (const c of cells) buckets[c.confidence]++;
  const uniqueChampsLocked = new Set(
    cells
      .filter((c) => c.confidence.startsWith('lock-'))
      .map((c) => c.champion),
  );
  console.log(`Reconciled ${cells.length} (champion, effect) cells.`);
  console.log(
    `  Locks: ${buckets['lock-3src']} × 3src, ${buckets['lock-2src']} × 2src → ${uniqueChampsLocked.size} unique champions`,
  );
  console.log(
    `  Flags: ${buckets['flag-conflict']} conflicts, ${buckets['flag-single']} single, ${buckets['flag-stale-only']} stale-only`,
  );
  console.log(`  Locks JSON:  ${LOCKS_PATH}`);
  console.log(`  Review queue: ${QUEUE_PATH}`);
}

main();
