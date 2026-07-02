/**
 * Chart-transcription template ingester.
 *
 * Counterpart to scripts/generate-chart-template.ts: reads the filled-in
 * data/immunities/chart-template.csv and rewrites the `champions` block
 * of data/champions/immunities-chart.json, which the reconciliation
 * runner (pnpm reconcile-immunities) treats as the independent GuiaMTC
 * chart vote.
 *
 * Cell grammar (case-insensitive, whitespace-trimmed):
 *
 *   immune            → { band: 'immune' }
 *   NN%   (e.g. 80%)  → { band: 'resist', qual: 'NN%' }  (must be > 0)
 *   Purify            → { band: 'mechanic', qual: 'Purify' }
 *   Duration          → { band: 'mechanic', qual: 'Duration' }
 *   syn: Partner Name → { band: 'synergy', partner: 'Partner Name' }
 *   (blank)           → no claim, cell skipped
 *   anything else     → warning, cell skipped
 *
 * The `_hint` and `_note` columns are ignored entirely, so stray edits
 * there can't corrupt the output. Champion rows are matched back to seed
 * ids by exact case-insensitive name; unmatched names warn and skip.
 *
 * The existing `_meta` block of immunities-chart.json is preserved —
 * only the `champions` object is overwritten. Re-running is idempotent.
 *
 * Usage:
 *   pnpm ingest-chart-template
 *   pnpm reconcile-immunities   # then propagate the new votes
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SEED_PATH = 'data/champions/seed.json';
const CSV_PATH = 'data/immunities/chart-template.csv';
const OUTPUT_PATH = 'data/champions/immunities-chart.json';

/** The 13 tracked effects — must match generate-chart-template.ts. */
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

type EffectName = (typeof EFFECTS)[number];

// ─── Types ─────────────────────────────────────────────────────────────

type SourceBand =
  | { band: 'immune' }
  | { band: 'resist'; qual: string }
  | { band: 'mechanic'; qual: 'Purify' | 'Duration' }
  | { band: 'synergy'; partner: string };

type ChartFile = {
  _meta?: Record<string, unknown>;
  champions: Record<string, Record<string, SourceBand>>;
};

type Seed = { champions: Array<{ id: string; name: string }> };

// ─── CSV parsing ───────────────────────────────────────────────────────

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted cells, escaped quotes
 * (`""` inside a quoted cell), commas and newlines inside quotes, and
 * both LF and CRLF line endings. Returns rows of raw string cells.
 * No external library — the file is small and the grammar is fixed.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') i++; // CRLF → fall through to \n
    if (text[i] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // Final cell/row when the file doesn't end with a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ─── Cell grammar ──────────────────────────────────────────────────────

type CellResult =
  | { kind: 'blank' }
  | { kind: 'band'; band: SourceBand }
  | { kind: 'unrecognised' };

/** Matches a leading integer/decimal, optional % suffix: 80, 80%, 82.5% */
const PERCENT_RE = /^(\d+(?:\.\d+)?)\s*%?$/;

function parseCell(raw: string): CellResult {
  const value = raw.trim();
  if (value === '') return { kind: 'blank' };

  const lower = value.toLowerCase();
  if (lower === 'immune') return { kind: 'band', band: { band: 'immune' } };
  if (lower === 'purify')
    return { kind: 'band', band: { band: 'mechanic', qual: 'Purify' } };
  if (lower === 'duration')
    return { kind: 'band', band: { band: 'mechanic', qual: 'Duration' } };

  if (lower.startsWith('syn:')) {
    const partner = value.slice(4).trim();
    if (partner === '') return { kind: 'unrecognised' };
    return { kind: 'band', band: { band: 'synergy', partner } };
  }

  const pct = value.match(PERCENT_RE);
  if (pct) {
    const n = parseFloat(pct[1]!);
    if (!Number.isFinite(n) || n <= 0) return { kind: 'unrecognised' };
    return { kind: 'band', band: { band: 'resist', qual: `${n}%` } };
  }

  return { kind: 'unrecognised' };
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(CSV_PATH)) {
    console.error(
      `Missing ${CSV_PATH} — run \`pnpm generate-chart-template\` first.`,
    );
    process.exit(1);
  }

  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;
  const idByName = new Map<string, string>();
  for (const c of seed.champions) idByName.set(c.name.toLowerCase(), c.id);

  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  if (rows.length === 0) {
    console.error(`Empty CSV at ${CSV_PATH} — nothing to ingest.`);
    process.exit(1);
  }

  // Resolve effect columns by header name, not fixed position — resilient
  // to the user reordering/inserting columns in a spreadsheet editor.
  const header = rows[0]!;
  const effectCol = new Map<EffectName, number>();
  for (const effect of EFFECTS) {
    const idx = header.findIndex((h) => h.trim() === effect);
    if (idx === -1) {
      console.error(
        `Header is missing the "${effect}" column — regenerate the template.`,
      );
      process.exit(1);
    }
    effectCol.set(effect, idx);
  }
  const championCol = header.findIndex((h) => h.trim() === 'Champion');
  if (championCol === -1) {
    console.error('Header is missing the "Champion" column — regenerate the template.');
    process.exit(1);
  }

  const champions: ChartFile['champions'] = {};
  let ingestedCells = 0;
  let blankRows = 0;
  let unmatchedNames = 0;
  let unrecognisedCells = 0;

  for (const row of rows.slice(1)) {
    const name = (row[championCol] ?? '').trim();
    if (name === '') continue; // trailing blank line etc.

    // Read the 13 effect cells first, so a fully blank row on an
    // unmatched name doesn't produce a spurious warning.
    const cells: Array<{ effect: EffectName; result: CellResult }> = [];
    let hasContent = false;
    for (const effect of EFFECTS) {
      const result = parseCell(row[effectCol.get(effect)!] ?? '');
      if (result.kind !== 'blank') hasContent = true;
      cells.push({ effect, result });
    }
    if (!hasContent) {
      blankRows++;
      continue;
    }

    const id = idByName.get(name.toLowerCase());
    if (!id) {
      console.warn(`  WARN unmatched champion name "${name}" — row skipped.`);
      unmatchedNames++;
      continue;
    }

    for (const { effect, result } of cells) {
      if (result.kind === 'blank') continue;
      if (result.kind === 'unrecognised') {
        const raw = (row[effectCol.get(effect)!] ?? '').trim();
        console.warn(
          `  WARN unrecognised cell for ${name} / ${effect}: "${raw}" — skipped.`,
        );
        unrecognisedCells++;
        continue;
      }
      (champions[id] = champions[id] ?? {})[effect] = result.band;
    }
  }

  // Count ingested cells from the final structure (dedupe-safe).
  ingestedCells = Object.values(champions).reduce(
    (sum, effects) => sum + Object.keys(effects).length,
    0,
  );

  // Preserve the existing _meta block; only the champions object is ours.
  const existing = existsSync(OUTPUT_PATH)
    ? (JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as ChartFile)
    : { champions: {} };
  const payload: ChartFile = {
    _meta: existing._meta,
    champions,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');

  console.log(
    `Ingested ${ingestedCells} cells across ${Object.keys(champions).length} champions. ` +
      `Skipped ${blankRows} blank rows. ` +
      `Warnings: ${unmatchedNames} unmatched names, ${unrecognisedCells} unrecognised cells.`,
  );
  console.log(`  Output: ${OUTPUT_PATH}`);
  console.log('  Next: pnpm reconcile-immunities');
}

main();
