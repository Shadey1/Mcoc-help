/**
 * Fetch reference portraits for every 7-star champion into
 * data/champions/portraits-cache/<seed id>.png. The AW season extractor
 * template-matches guide cells against these PNGs.
 *
 * Two sources per champion, both plain HTTP so this runs in CI:
 * MCOCHUB's prestige feed (<id>.png) and the Fandom portrait already in
 * the seed (<id>~fandom.*; the CDN only needs a Referer). Either site
 * occasionally serves a non-standard crop, e.g. MCOCHUB's Punisher, and
 * the matcher takes the better of the two. Fandom is best-effort.
 *
 * Idempotent (skips champions already on disk). Pass --force to refetch.
 *
 * Usage:
 *   pnpm fetch-portraits
 *   pnpm fetch-portraits -- --force
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchFeed, findSeedMatch, USER_AGENT } from './lib/mcochub.js';

const SEED_PATH = resolve('data/champions/seed.json');
const IMAGES_DIR = resolve('data/champions/portraits-cache');
const RATE_LIMIT_MS = 120;
const FANDOM_REFERER = 'https://marvel-contestofchampions.fandom.com/';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FORCE = process.argv.slice(2).includes('--force');

async function main(): Promise<void> {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as {
    champions: Array<{ id: string; name: string; portraitUrl?: string | null }>;
  };
  mkdirSync(IMAGES_DIR, { recursive: true });

  const rows = await fetchFeed();
  let fetched = 0;
  let failed = 0;
  const unmatched: string[] = [];
  for (const row of rows) {
    const champ = findSeedMatch(row, seed.champions);
    if (!champ) {
      unmatched.push(row.name);
      continue;
    }
    const out = resolve(IMAGES_DIR, `${champ.id}.png`);
    if (!row.img || (!FORCE && existsSync(out))) continue;
    const res = await fetch(row.img, { headers: { 'User-Agent': USER_AGENT } }).catch(() => null);
    if (!res?.ok) {
      failed++;
      console.warn(`  ${champ.name}: ${res ? `HTTP ${res.status}` : 'network error'}`);
      continue;
    }
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    fetched++;
    await sleep(RATE_LIMIT_MS);
  }

  let fandom = 0;
  let fandomFailed = 0;
  const have = new Set(readdirSync(IMAGES_DIR).map((f) => f.replace(/\.[a-z]+$/i, '')));
  for (const row of rows) {
    const champ = findSeedMatch(row, seed.champions);
    if (!champ?.portraitUrl || (!FORCE && have.has(`${champ.id}~fandom`))) continue;
    const res = await fetch(champ.portraitUrl, { headers: { 'User-Agent': BROWSER_UA, Referer: FANDOM_REFERER } }).catch(() => null);
    const ext = res?.ok ? EXT[res.headers.get('content-type')?.split(';')[0] ?? ''] : undefined;
    if (!res || !ext) {
      fandomFailed++;
      continue;
    }
    writeFileSync(resolve(IMAGES_DIR, `${champ.id}~fandom.${ext}`), Buffer.from(await res.arrayBuffer()));
    fandom++;
    await sleep(RATE_LIMIT_MS);
  }
  console.log(`Fandom second references: fetched=${fandom} unavailable=${fandomFailed}`);
  console.log(`${rows.length} champions on MCOCHUB: fetched=${fetched} failed=${failed}`);
  if (unmatched.length > 0) console.log(`Not in seed yet (run pnpm auto-refresh): ${unmatched.join(', ')}`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
