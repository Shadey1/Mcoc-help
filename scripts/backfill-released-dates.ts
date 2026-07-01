/**
 * Backfill the `released` field on every seed champion from their
 * MCOCHUB page description. Every cached page (.cache/mcochub-pages/)
 * contains "X class champion (YYYY)" in the meta description; that year
 * is enough for the immunity-reconciliation freshness rule (which needs
 * to know which source can structurally cover a given champion).
 *
 * MCOCHUB slugs diverge from our seed ids (baron-zemo → baronzemo,
 * the-hood → hood, howard-the-duck → howardmech). We reuse the mapping
 * already recorded in abilities.json's source.slug to link seed id to
 * MCOCHUB page.
 *
 * Usage:
 *   pnpm backfill-released
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SEED_PATH = 'data/champions/seed.json';
const ABILITIES_PATH = 'data/champions/abilities.json';
const CACHE_DIR = '.cache/mcochub-pages';

type Seed = {
  champions: Array<{
    id: string;
    released?: string;
    [k: string]: unknown;
  }>;
};

type Abilities = {
  champions: Record<string, { source: { slug: string } }>;
};

function extractYear(html: string): string | null {
  // "Knull is a Cosmic class champion (2021) in Marvel Contest of Champions."
  const m = html.match(/class champion \((\d{4})\)/);
  return m ? m[1]! : null;
}

function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;
  const abilities = JSON.parse(readFileSync(ABILITIES_PATH, 'utf8')) as Abilities;

  let filled = 0;
  let already = 0;
  let missing = 0;

  for (const champ of seed.champions) {
    if (champ.released) {
      already++;
      continue;
    }
    // Look up the MCOCHUB slug we recorded during the abilities import.
    const abilityEntry = abilities.champions[champ.id];
    const slug = abilityEntry?.source.slug;
    if (!slug) {
      missing++;
      continue;
    }
    const cachePath = join(CACHE_DIR, `${slug}.html`);
    if (!existsSync(cachePath)) {
      missing++;
      continue;
    }
    const year = extractYear(readFileSync(cachePath, 'utf8'));
    if (year) {
      champ.released = year;
      filled++;
    } else {
      missing++;
    }
  }

  writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n');
  console.log(
    `Filled ${filled} champion release years; ${already} already had one; ${missing} could not be resolved.`,
  );
}

main();
