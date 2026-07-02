/**
 * Chart-transcription template generator.
 *
 * The GuiaMTC immunity chart (task #80) is transcribed by a human, and
 * typing shorthand line-by-line is error-prone. Instead we emit a CSV
 * spreadsheet — one row per released 7★ champion, one column per tracked
 * effect — that the user fills in cell by cell while reading the chart,
 * then feeds back through scripts/ingest-chart-template.ts to produce
 * data/champions/immunities-chart.json.
 *
 * The 13 effect columns start BLANK: a cell is only filled when the user
 * can verify a mark on the chart. Accepted cell values (parsed by the
 * ingester):
 *
 *   immune            → { band: 'immune' }
 *   NN%   (e.g. 80%)  → { band: 'resist', qual: 'NN%' }
 *   Purify            → { band: 'mechanic', qual: 'Purify' }
 *   Duration          → { band: 'mechanic', qual: 'Duration' }
 *   syn: Partner Name → { band: 'synergy', partner: 'Partner Name' }
 *   (blank)           → no claim
 *
 * Two trailing helper columns:
 *   _hint — read-only summary of what the OTHER sources (backfill, kit,
 *           auntm, fixture) already claim for this champion, so the user
 *           can see where a chart mark would corroborate vs conflict.
 *           Ignored by the ingester.
 *   _note — free-text scratch space for the user (conditions,
 *           uncertainties). Also ignored by the ingester.
 *
 * Usage:
 *   pnpm generate-chart-template
 *
 * Output: data/immunities/chart-template.csv
 * WARNING: regenerating overwrites the CSV — ingest any pending edits
 * first (pnpm ingest-chart-template), or your fills are lost.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SEED_PATH = 'data/champions/seed.json';
const PILL_PATH = 'data/champions/immunities-backfill.json';
const KIT_PATH = 'data/champions/immunities-kit-derived.json';
const FIXTURE_PATH = 'data/champions/immunities-fixture.json';
const AUNTM_PATH = 'data/champions/immunities-auntm.json';
const OUTPUT_PATH = 'data/immunities/chart-template.csv';

/** The 13 tracked effects, in canonical column order. */
const EFFECTS = [
  'Bleed',
  'Poison',
  'Incinerate',
  'Coldsnap',
  'Shock',
  'Neuroshock',
  'Stun',
  'Stagger',
  'Nullify',
  'Armor Break',
  'Degeneration',
  'Power Burn',
  'Heal Block',
] as const;

// ─── Types ─────────────────────────────────────────────────────────────

type SourceBand =
  | { band: 'immune' }
  | { band: 'resist'; qual: string }
  | { band: 'mechanic'; qual: 'Purify' | 'Duration' }
  | { band: 'synergy'; partner: string };

type SourceFile = {
  _meta?: Record<string, unknown>;
  champions: Record<string, Record<string, SourceBand>>;
};

type Seed = {
  champions: Array<{
    id: string;
    name: string;
    class: string;
    released?: string;
    sevenStarReleased?: boolean;
  }>;
};

/** Short source labels shown in the _hint column. */
type HintSource = 'backfill' | 'kit' | 'auntm' | 'fixture';

// ─── Load ──────────────────────────────────────────────────────────────

function loadOptional(path: string): SourceFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as SourceFile;
}

// ─── Hint synthesis ────────────────────────────────────────────────────

/**
 * Render a band the same way the user would type it into a cell, so the
 * hint doubles as a copy-paste source when the chart agrees.
 */
function describeBand(band: SourceBand): string {
  if (band.band === 'immune') return 'immune';
  if (band.band === 'resist') return band.qual;
  if (band.band === 'mechanic') return band.qual;
  return `syn: ${band.partner}`;
}

/**
 * Build the compact per-champion hint, e.g.
 *   Poison: immune (backfill+auntm) | Bleed: 150% (kit+fixture)
 * Sources that agree on the identical mark are grouped with '+'; distinct
 * marks for the same effect are listed side by side with ' / ' so a
 * disagreement is visible at a glance. Effects with no data are skipped.
 */
function buildHint(
  championId: string,
  sources: Array<{ label: HintSource; file: SourceFile | null }>,
): string {
  const parts: string[] = [];
  for (const effect of EFFECTS) {
    // mark description → list of source labels claiming it
    const byMark = new Map<string, HintSource[]>();
    for (const { label, file } of sources) {
      const band = file?.champions[championId]?.[effect];
      if (!band) continue;
      const desc = describeBand(band);
      (byMark.get(desc) ?? byMark.set(desc, []).get(desc)!).push(label);
    }
    if (byMark.size === 0) continue;
    const marks = Array.from(byMark.entries())
      .map(([desc, labels]) => `${desc} (${labels.join('+')})`)
      .join(' / ');
    parts.push(`${effect}: ${marks}`);
  }
  return parts.join(' | ');
}

// ─── CSV writing ───────────────────────────────────────────────────────

/**
 * Escape one CSV cell: wrap in double quotes when the value contains a
 * comma, quote, or newline, doubling any inner quotes. Blank cells stay
 * empty strings.
 */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;
  const sources: Array<{ label: HintSource; file: SourceFile | null }> = [
    { label: 'backfill', file: loadOptional(PILL_PATH) },
    { label: 'kit', file: loadOptional(KIT_PATH) },
    { label: 'auntm', file: loadOptional(AUNTM_PATH) },
    { label: 'fixture', file: loadOptional(FIXTURE_PATH) },
  ];

  // Only released 7★ champions appear on the chart worth transcribing.
  const champions = seed.champions
    .filter((c) => c.sevenStarReleased !== false)
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [];
  lines.push(
    csvRow(['Champion', 'Class', 'Released', ...EFFECTS, '_hint', '_note']),
  );

  let hinted = 0;
  for (const champ of champions) {
    const hint = buildHint(champ.id, sources);
    if (hint) hinted++;
    lines.push(
      csvRow([
        champ.name,
        champ.class,
        champ.released ?? '',
        ...EFFECTS.map(() => ''), // effect cells start blank — user fills in
        hint,
        '', // _note — user scratch space
      ]),
    );
  }

  ensureDir(OUTPUT_PATH);
  writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n');
  console.log(
    `Wrote ${champions.length} champion rows (${hinted} with source hints) → ${OUTPUT_PATH}`,
  );
  console.log(
    'Fill the effect cells (immune / NN% / Purify / Duration / syn: Partner), then run: pnpm ingest-chart-template',
  );
}

main();
