/**
 * Refresh per-champion R4 (and R5 cross-validation) BHR curves from mcoc.gg.
 *
 * Why this exists: MCOCHUB only publishes R5 sig curves. Deriving R4 from
 * R5 * global rank-multiplier (0.8431) is wrong for many champions — the
 * game actually stores per-champion R4 tables. A user-provided in-game
 * audit found 17/30 R4 cases off by 10-30 BHR with the MCOCHUB-derived
 * approach.
 *
 * mcoc.gg's /json/prestige/{slug}.json endpoint exposes the actual per-rank
 * 11-anchor table the game uses (sig 0/20/40/.../200). We scrape this and
 * populate champion.prestige.rank4 directly. The engine's existing per-rank
 * fast path consumes it without modification — once rank4 has the anchors,
 * R4 BHR for any sig becomes exact.
 *
 * Sources:
 *   /json/champions.json       — master list (name → slug mapping)
 *   /json/prestige/{slug}.json — per-rank values array (rarity=7, rank=5 & 4)
 *
 * Strategy:
 *   1. Fetch the champions master list (one ~460KB request).
 *   2. Build a name → slug map from { name, image } pairs.
 *   3. For every champion in our seed.json, find their mcoc.gg slug via a
 *      normalised-name match (strip non-alphanumeric, lowercase).
 *   4. Fetch /json/prestige/{slug}.json per champion, rate-limited.
 *   5. Compare mcoc.gg's R5 against our existing R5 — sanity check the
 *      sources agree. Log mismatches as warnings.
 *   6. Build rank4 SigBrackets from mcoc.gg's R4 values, attach.
 *   7. Dry-run writes scripts/bhr-r4-corrections.json. --apply rewrites
 *      seed.json with a seed.json.bak backup first.
 *
 * Polite: 500ms rate limit, identifying User-Agent.
 * Idempotent: rerunnable; already-up-to-date champions write zero
 *   corrections.
 *
 * Usage:
 *   pnpm refresh-bhr-r4                       # dry-run
 *   pnpm refresh-bhr-r4 -- --apply            # apply previously-saved diff
 *   pnpm refresh-bhr-r4 -- --refresh-apply    # one-shot
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const SEED_PATH = 'data/champions/seed.json';
const CORRECTIONS_PATH = 'scripts/bhr-r4-corrections.json';
const SEED_BACKUP_PATH = 'data/champions/seed.json.bak';
const SOURCE_BASE = 'https://mcoc.gg';
const USER_AGENT =
  'mcoc.help BHR calibrator (free MCOC tool; contact via mcoc.help)';
const FETCH_TIMEOUT_MS = 15000;
const RATE_LIMIT_MS = 500;

const SIG_ANCHORS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200] as const;

const args = process.argv.slice(2);
const APPLY_ONLY = args.includes('--apply');
const REFRESH_APPLY = args.includes('--refresh-apply');

// ─── Types ──────────────────────────────────────────────────────────────

type MasterEntry = { id: number; name: string; image: string };
type PrestigeEntry = { rarity: number; rank: number; values: number[] };
type PrestigeFile = { data: PrestigeEntry[] };

type Champion = {
  id: string;
  name: string;
  prestige: {
    rank5: Record<string, number>;
    rank4?: Record<string, number>;
    rank3?: Record<string, number>;
  };
  _meta?: { bhrSource?: string; lastVerified?: string } & Record<string, unknown>;
  [k: string]: unknown;
};

type Correction = {
  id: string;
  name: string;
  mcocggSlug: string;
  hadR4Before: boolean;
  oldR4: Record<string, number> | null;
  newR4: Record<string, number>;
  /** R5 from mcoc.gg vs our existing R5 — should agree exactly when both
   *  sources are current. Logged as warning if not. */
  r5Match: boolean;
};

// ─── Fetch helpers ──────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Reconciliation ─────────────────────────────────────────────────────

/** Strip everything but alphanumerics — matches mcoc.gg's `image` slug
 *  convention. "Spider-Punk" → "spiderpunk", "White Tiger" → "whitetiger". */
function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Many seed entries are "<Base> (<Variant>)" while mcoc.gg encodes the
 *  variant as a prefix: "Star-Lord (Stellar-Forged)" → image="stellarstarlord".
 *  Generate a few candidate keys per seed name so we catch both orderings. */
function candidateKeys(seedName: string): string[] {
  const keys = new Set<string>();
  keys.add(normaliseName(seedName));
  const m = seedName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const base = m[1]!.trim();
    const variant = m[2]!.trim();
    keys.add(normaliseName(`${variant} ${base}`));
    keys.add(normaliseName(base));
  }
  return Array.from(keys);
}

function findSlug(seedName: string, byKey: Map<string, MasterEntry>): MasterEntry | null {
  for (const k of candidateKeys(seedName)) {
    const v = byKey.get(k);
    if (v) return v;
  }
  return null;
}

// ─── Diff ───────────────────────────────────────────────────────────────

function bracketsFromValues(values: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < SIG_ANCHORS.length; i++) {
    out[String(SIG_ANCHORS[i])] = values[i]!;
  }
  return out;
}

function bracketsEqual(a: Record<string, number> | null | undefined, b: Record<string, number>): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return keys.size > 0;
}

// ─── Seed I/O ───────────────────────────────────────────────────────────

function readSeed(): { champions: Champion[] } {
  return JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { champions: Champion[] };
}
function writeSeed(seed: { champions: Champion[] }) {
  writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n');
}

// ─── Apply ──────────────────────────────────────────────────────────────

function applyCorrections() {
  if (!existsSync(CORRECTIONS_PATH)) {
    console.error(`No corrections file at ${CORRECTIONS_PATH}. Run a dry-run first.`);
    process.exit(1);
  }
  const file = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8')) as {
    corrections: Correction[];
  };
  if (file.corrections.length === 0) {
    console.log('No corrections to apply.');
    return;
  }
  console.log(`Backing up seed.json → ${SEED_BACKUP_PATH}`);
  copyFileSync(SEED_PATH, SEED_BACKUP_PATH);

  const seed = readSeed();
  const byId = new Map(seed.champions.map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);
  let applied = 0;
  for (const c of file.corrections) {
    const champ = byId.get(c.id);
    if (!champ) {
      console.warn(`  ⚠ ${c.id}: not in seed, skipping`);
      continue;
    }
    champ.prestige.rank4 = c.newR4;
    if (champ._meta) {
      const note = `mcoc.gg per-rank curves (R4 + R5 11-anchor, refreshed ${today})`;
      champ._meta.bhrSource = note;
      champ._meta.lastVerified = today;
    }
    applied++;
  }
  writeSeed(seed);
  console.log(`\nApplied ${applied} R4 curve refresh${applied === 1 ? '' : 'es'}. seed.json updated.`);
}

// ─── Dry-run ────────────────────────────────────────────────────────────

async function dryRun() {
  console.log(`Fetching master list from ${SOURCE_BASE}/json/champions.json…`);
  const masterFile = await getJson<{ data: MasterEntry[] }>(`${SOURCE_BASE}/json/champions.json`);
  const master = masterFile.data;
  console.log(`  Loaded ${master.length} champions.`);

  // Build lookup keyed on normalised name (which matches mcoc.gg's `image` slug)
  const byKey = new Map<string, MasterEntry>();
  for (const m of master) {
    byKey.set(normaliseName(m.name), m);
    byKey.set(normaliseName(m.image), m);
  }

  const seed = readSeed();
  const corrections: Correction[] = [];
  const unmatchedSeed: string[] = [];
  const r5Mismatches: Array<{ id: string; ours: Record<string, number>; theirs: Record<string, number> }> = [];
  let unchanged = 0;
  let fetched = 0;

  for (let i = 0; i < seed.champions.length; i++) {
    const champ = seed.champions[i]!;
    const progress = `[${i + 1}/${seed.champions.length}]`;
    const match = findSlug(champ.name, byKey);
    if (!match) {
      unmatchedSeed.push(`${champ.id} | ${champ.name}`);
      if ((i + 1) % 25 === 0) console.log(`${progress} … (${unmatchedSeed.length} unmatched so far)`);
      continue;
    }
    let prestige: PrestigeFile;
    try {
      prestige = await getJson<PrestigeFile>(`${SOURCE_BASE}/json/prestige/${match.image}.json`);
    } catch (e) {
      console.warn(`${progress} ${champ.name}: fetch failed — ${(e as Error).message}`);
      await sleep(RATE_LIMIT_MS);
      continue;
    }
    fetched++;
    const r4Entry = prestige.data.find((d) => d.rarity === 7 && d.rank === 4);
    const r5Entry = prestige.data.find((d) => d.rarity === 7 && d.rank === 5);
    if (!r4Entry || r4Entry.values.length !== SIG_ANCHORS.length) {
      console.warn(`${progress} ${champ.name}: no usable R4 row in mcoc.gg data`);
      await sleep(RATE_LIMIT_MS);
      continue;
    }
    const newR4 = bracketsFromValues(r4Entry.values);
    const r5Match =
      !r5Entry ||
      r5Entry.values.length !== SIG_ANCHORS.length ||
      r5Entry.values.every((v, idx) => v === champ.prestige.rank5[String(SIG_ANCHORS[idx])]);
    if (r5Entry && !r5Match) {
      const theirsObj = bracketsFromValues(r5Entry.values);
      r5Mismatches.push({ id: champ.id, ours: champ.prestige.rank5, theirs: theirsObj });
    }
    if (bracketsEqual(champ.prestige.rank4 ?? null, newR4)) {
      unchanged++;
    } else {
      corrections.push({
        id: champ.id,
        name: champ.name,
        mcocggSlug: match.image,
        hadR4Before: !!champ.prestige.rank4,
        oldR4: (champ.prestige.rank4 ?? null) as Record<string, number> | null,
        newR4,
        r5Match,
      });
    }
    if ((i + 1) % 25 === 0) {
      console.log(`${progress} ${champ.name}: ok (corrections so far ${corrections.length})`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  writeFileSync(
    CORRECTIONS_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: SOURCE_BASE,
        corrections,
        unmatchedSeed,
        r5Mismatches,
      },
      null,
      2,
    ) + '\n',
  );

  console.log('');
  console.log('─'.repeat(60));
  console.log(`Fetched:           ${fetched}`);
  console.log(`Unchanged:         ${unchanged}`);
  console.log(`R4 corrections:    ${corrections.length}`);
  console.log(`Unmatched in seed: ${unmatchedSeed.length}`);
  console.log(`R5 mismatches:     ${r5Mismatches.length} (sanity-check warning)`);
  if (unmatchedSeed.length > 0) {
    console.log('');
    console.log('Unmatched seed champions (no mcoc.gg slug found):');
    for (const u of unmatchedSeed.slice(0, 15)) console.log(`  ${u}`);
    if (unmatchedSeed.length > 15) console.log(`  … and ${unmatchedSeed.length - 15} more`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  if (APPLY_ONLY) return applyCorrections();
  if (REFRESH_APPLY) {
    await dryRun();
    console.log('\n--refresh-apply set; applying immediately.\n');
    applyCorrections();
    return;
  }
  await dryRun();
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
