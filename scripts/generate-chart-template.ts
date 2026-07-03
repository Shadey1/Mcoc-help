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
 * Cells are pre-filled with a "hint" derived from what our OTHER sources
 * currently claim, prefixed with `?` to mark them as unverified. The
 * user's job is then to either verify against the chart (remove the `?`
 * so `?immune` becomes `immune`) or replace/clear the cell if the chart
 * disagrees. Cells still carrying `?` at ingest time are treated as
 * hints and ignored — a `?immune` left untouched never becomes a fake
 * chart vote.
 *
 * Accepted cell values (parsed by the ingester):
 *
 *   immune            → { band: 'immune' }
 *   NN%   (e.g. 80%)  → { band: 'resist', qual: 'NN%' }
 *   Purify            → { band: 'mechanic', qual: 'Purify' }
 *   Duration          → { band: 'mechanic', qual: 'Duration' }
 *   syn: Partner Name → { band: 'synergy', partner: 'Partner Name' }
 *   ?<mark>           → hint from other sources; ignored until user
 *                       removes the `?` to confirm chart agreement.
 *   (blank)           → no claim
 *
 * A hint is written ONLY when the OTHER sources agree on a single
 * mark for that (champion, effect). Disagreements between existing
 * sources leave the cell blank — the _hint column at the end still
 * carries the full breakdown so the user can pick the right mark.
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
  'Falter',
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
 * For one (champion, effect), collect every source's mark, grouped by
 * mark string. Returns a Map from mark description to the labels of
 * sources that agree on it. Empty map when no source has a claim.
 */
function collectMarks(
  championId: string,
  effect: string,
  sources: Array<{ label: HintSource; file: SourceFile | null }>,
): Map<string, HintSource[]> {
  const byMark = new Map<string, HintSource[]>();
  for (const { label, file } of sources) {
    const band = file?.champions[championId]?.[effect];
    if (!band) continue;
    const desc = describeBand(band);
    (byMark.get(desc) ?? byMark.set(desc, []).get(desc)!).push(label);
  }
  return byMark;
}

/**
 * Cell pre-fill: only when sources agree on a single mark, write `?<mark>`
 * so the user can verify by removing the `?`. When sources disagree,
 * leave the cell blank — the user needs to consult the chart to pick.
 */
function prefillCell(byMark: Map<string, HintSource[]>): string {
  if (byMark.size !== 1) return '';
  const [mark] = byMark.keys();
  return `?${mark!}`;
}

/**
 * Build the compact per-champion hint, e.g.
 *   Poison: immune (backfill+auntm) | Bleed: 150% (kit+fixture)
 * Sources that agree on the identical mark are grouped with '+'; distinct
 * marks for the same effect are listed side by side with ' / ' so a
 * disagreement is visible at a glance. Effects with no data are skipped.
 */
function renderHint(perEffect: Array<{ effect: string; byMark: Map<string, HintSource[]> }>): string {
  const parts: string[] = [];
  for (const { effect, byMark } of perEffect) {
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

  let hintedChamps = 0;
  let prefilledCells = 0;
  for (const champ of champions) {
    // Collect marks once per effect for this champion — reused by
    // prefillCell and renderHint so we don't walk sources twice.
    const perEffect = EFFECTS.map((effect) => ({
      effect,
      byMark: collectMarks(champ.id, effect, sources),
    }));
    const effectCells = perEffect.map(({ byMark }) => {
      const cell = prefillCell(byMark);
      if (cell) prefilledCells++;
      return cell;
    });
    const hint = renderHint(perEffect);
    if (hint) hintedChamps++;
    lines.push(
      csvRow([
        champ.name,
        champ.class,
        champ.released ?? '',
        ...effectCells,
        hint,
        '', // _note — user scratch space
      ]),
    );
  }

  ensureDir(OUTPUT_PATH);
  const csv = lines.join('\n') + '\n';
  let writePath = OUTPUT_PATH;
  try {
    writeFileSync(OUTPUT_PATH, csv);
  } catch (err) {
    // EBUSY is what Windows returns when Excel has the file open. Write
    // a sidecar next to it so the user can diff / copy across when they
    // close their editor. Anything else is a real failure.
    const isBusy = (err as NodeJS.ErrnoException).code === 'EBUSY';
    if (!isBusy) throw err;
    writePath = OUTPUT_PATH.replace(/\.csv$/, '.new.csv');
    writeFileSync(writePath, csv);
    console.warn(
      `\n  ⚠ ${OUTPUT_PATH} is locked (Excel? Sheets?) — wrote sidecar:\n     ${writePath}\n    Close the original, then either re-run this script or copy the sidecar into place.\n`,
    );
  }
  console.log(
    `Wrote ${champions.length} champion rows — ${hintedChamps} with source hints, ${prefilledCells} cells pre-filled with '?' hints → ${writePath}`,
  );
  console.log(
    "For each '?<mark>' cell: verify against the chart, then either remove the '?' to accept, or replace/clear if the chart disagrees. Blank cells: fill from the chart or leave blank. Then: pnpm ingest-chart-template",
  );
}

main();
