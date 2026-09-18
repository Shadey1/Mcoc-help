/**
 * Build a phash cache for every champion portrait in seed.json.
 *
 * The AW season extractor matches defender cells cropped from guide
 * images against this cache using Hamming distance. Same average-hash
 * (aHash) approach the browser-side OCR uses in apps/web/lib/ocr/phash.ts,
 * but implemented for Node using sharp — canvas APIs aren't available
 * outside the browser.
 *
 * Output: data/champions/portrait-hashes.json
 *   {
 *     _meta: { computedAt, source, hashSize },
 *     hashes: { [championId]: "16-char hex" }
 *   }
 *
 * Idempotent: skips champions whose hash is already computed. Run
 * again with --force to rebuild from scratch (e.g. if the hash size
 * changes).
 *
 * Polite: 500ms between Fandom CDN fetches. Fandom serves the images
 * with CORS headers, verified separately.
 *
 * Usage:
 *   tsx scripts/build-portrait-hash-cache.ts
 *   tsx scripts/build-portrait-hash-cache.ts --force
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import sharp from 'sharp';

const SEED_PATH = resolve('data/champions/seed.json');
const CACHE_PATH = resolve('data/champions/portrait-hashes.json');
const HASH_SIZE = 8; // 8×8 = 64 bits, same as browser
const RATE_LIMIT_MS = 500;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');

type Champion = { id: string; name: string; portraitUrl?: string | null };
type Seed = { champions: Champion[] };
type HashCache = {
  _meta: { computedAt: string; source: string; hashSize: number };
  hashes: Record<string, string>;
};

/**
 * Compute an 8×8 aHash of an image buffer. Downscale to 8×8 greyscale,
 * take the mean of the 64 samples, emit a 64-bit string of pixel > mean.
 * Same algorithm as apps/web/lib/ocr/phash.ts so cells hashed by either
 * side compare correctly.
 */
async function hashImageBuffer(buf: Buffer): Promise<string> {
  const raw = await sharp(buf)
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  // greyscale + raw → one byte per pixel.
  let sum = 0;
  for (let i = 0; i < raw.length; i++) sum += raw[i]!;
  const mean = sum / raw.length;
  let bits = '';
  for (let i = 0; i < raw.length; i++) bits += raw[i]! > mean ? '1' : '0';
  // Pack the 64-bit string as 16 hex chars.
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

async function fetchPortrait(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function loadCache(): HashCache {
  if (existsSync(CACHE_PATH) && !FORCE) {
    try {
      return JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as HashCache;
    } catch {
      // fall through to fresh cache
    }
  }
  return {
    _meta: { computedAt: '', source: 'Fandom CDN via seed.portraitUrl', hashSize: HASH_SIZE },
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
  const start = cache.hashes;
  const todo = seed.champions.filter((c) => c.portraitUrl && (FORCE || !start[c.id]));
  console.log(
    `${seed.champions.length} champions in seed, ${Object.keys(start).length} already hashed, ${todo.length} to fetch`,
  );
  if (todo.length === 0) return;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i]!;
    try {
      const buf = await fetchPortrait(c.portraitUrl!);
      const hash = await hashImageBuffer(buf);
      cache.hashes[c.id] = hash;
      ok++;
      if ((i + 1) % 20 === 0 || i === todo.length - 1) {
        console.log(`  [${i + 1}/${todo.length}] ${c.name.padEnd(30)} ${hash}`);
        saveCache(cache); // periodic save so an interrupt doesn't lose work
      }
    } catch (e) {
      fail++;
      console.warn(`  [${i + 1}/${todo.length}] ${c.name}: FAIL ${e instanceof Error ? e.message : String(e)}`);
    }
    if (i < todo.length - 1) await sleep(RATE_LIMIT_MS);
  }
  saveCache(cache);
  console.log(`\nDone. hashed=${ok} failed=${fail} total_in_cache=${Object.keys(cache.hashes).length}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
