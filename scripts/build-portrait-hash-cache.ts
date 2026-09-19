/**
 * Build a portrait phash cache for every champion in seed.json.
 *
 * Uses puppeteer-core to drive local Chrome (Fandom's CDN sits behind
 * Cloudflare's JS challenge, which no direct-fetch approach clears).
 * Each portrait's PNG is saved to data/champions/portraits-cache/
 * so the hash algorithm can be iterated on without re-fetching.
 *
 * Hash: dHash 16×16 (256 bits) on the center 60% of each portrait —
 * see scripts/lib/phash.ts for why.
 *
 * Output:
 *   data/champions/portrait-hashes.json — {championId: hex}
 *   data/champions/portraits-cache/*.png — raw portraits, so a hash
 *                                          algorithm change can rerun
 *                                          from disk in seconds.
 *
 * Idempotent (skips cached champions). Pass --force to rebuild.
 *
 * Usage:
 *   pnpm build-portrait-hashes
 *   pnpm build-portrait-hashes -- --force
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { centerCropDHash, HASH_BITS } from './lib/phash.js';

const SEED_PATH = resolve('data/champions/seed.json');
const CACHE_PATH = resolve('data/champions/portrait-hashes.json');
const IMAGES_DIR = resolve('data/champions/portraits-cache');
const RATE_LIMIT_MS = 300;
const NAV_TIMEOUT_MS = 30_000;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');

function findChrome(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('Chrome not found. Set CHROME_PATH env var.');
}

type Champion = { id: string; name: string; portraitUrl?: string | null };
type Seed = { champions: Champion[] };
type HashCache = {
  _meta: { computedAt: string; source: string; algorithm: string; bits: number };
  hashes: Record<string, string>;
};

function loadCache(): HashCache {
  if (existsSync(CACHE_PATH) && !FORCE) {
    try {
      const parsed = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as HashCache;
      // If the cache was built with a different algorithm/bits, ignore it.
      if (parsed._meta?.bits === HASH_BITS && parsed._meta?.algorithm === 'dhash-center60-16') {
        return parsed;
      }
    } catch {
      // fall through
    }
  }
  return {
    _meta: {
      computedAt: '',
      source: 'Fandom CDN via puppeteer-core (Cloudflare-cleared)',
      algorithm: 'dhash-center60-16',
      bits: HASH_BITS,
    },
    hashes: {},
  };
}

function saveCache(cache: HashCache): void {
  cache._meta.computedAt = new Date().toISOString();
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

async function main(): Promise<void> {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as Seed;
  const cache = loadCache();
  mkdirSync(IMAGES_DIR, { recursive: true });

  const todo = seed.champions.filter((c) => {
    if (!c.portraitUrl) return false;
    if (FORCE) return true;
    // Re-hash if the cache is missing OR the local PNG is present but
    // the hash isn't (partial cache from a crash).
    return !cache.hashes[c.id];
  });
  console.log(
    `${seed.champions.length} champions in seed, ${Object.keys(cache.hashes).length} already hashed, ${todo.length} to fetch`,
  );

  // If the raw PNG cache has entries we don't have hashes for, we can
  // regenerate hashes without re-fetching.
  const disk = todo.filter((c) => existsSync(resolve(IMAGES_DIR, `${c.id}.png`)));
  if (disk.length > 0) {
    console.log(`(${disk.length} of those have a local PNG on disk — hashing without re-fetch)`);
    for (const c of disk) {
      const path = resolve(IMAGES_DIR, `${c.id}.png`);
      cache.hashes[c.id] = await centerCropDHash(path);
    }
    saveCache(cache);
    // Update todo to only include champs still needing fetch.
    const remaining = todo.filter((c) => !cache.hashes[c.id]);
    console.log(`  ${remaining.length} still need Fandom fetch`);
    if (remaining.length === 0) {
      console.log(`\nDone. total_in_cache=${Object.keys(cache.hashes).length}`);
      return;
    }
    todo.length = 0;
    todo.push(...remaining);
  }

  if (todo.length === 0) {
    console.log(`\nDone. total_in_cache=${Object.keys(cache.hashes).length}`);
    return;
  }

  const chromePath = findChrome();
  console.log(`launching chrome at ${chromePath}`);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    await page.setViewport({ width: 512, height: 512 });

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i]!;
      const url = c.portraitUrl!;
      const pngPath = resolve(IMAGES_DIR, `${c.id}.png`);
      try {
        const response = await page.goto(url, {
          waitUntil: 'networkidle0',
          timeout: NAV_TIMEOUT_MS,
        });
        const status = response?.status() ?? 0;
        if (status !== 200) throw new Error(`HTTP ${status}`);
        const buf = Buffer.from(await response!.buffer());
        writeFileSync(pngPath, buf);
        const hash = await centerCropDHash(buf);
        cache.hashes[c.id] = hash;
        ok++;
        if ((i + 1) % 20 === 0 || i === todo.length - 1) {
          console.log(`  [${i + 1}/${todo.length}] ${c.name.padEnd(30)} ${hash.slice(0, 16)}…`);
          saveCache(cache);
        }
      } catch (e) {
        fail++;
        console.warn(
          `  [${i + 1}/${todo.length}] ${c.name.padEnd(30)} FAIL ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (i < todo.length - 1) await sleep(RATE_LIMIT_MS);
    }
    saveCache(cache);
    console.log(
      `\nDone. hashed=${ok} failed=${fail} total_in_cache=${Object.keys(cache.hashes).length}`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
