/**
 * Scrape champion portrait URLs from the Marvel Contest of Champions Fandom
 * wiki via its MediaWiki API, populate `portraitUrl` in seed.json.
 *
 * Why API not HTML: Fandom's wiki pages sit behind Cloudflare's managed
 * challenge (requires JS execution to clear), so plain HTTP GETs return a
 * challenge page rather than the wiki content. The MediaWiki API endpoint
 * (/api.php) is exempt from the challenge because community tooling relies
 * on it. Same data, different access path.
 *
 * Strategy:
 *   1. action=query with pageimages — returns the main page image (typically
 *      the infobox headshot). Try the exact name first, then a hyphen-
 *      normalised variant (Fandom is hyphen-consistent; MCOCHUB sometimes
 *      drops them).
 *   2. action=opensearch as search fallback — find the canonical page title
 *      when the mechanical name doesn't match.
 *   3. action=query with prop=images on the resolved page — enumerate every
 *      file referenced, pick one whose name matches /portrait/i. Useful when
 *      pageimages returns nothing (some pages don't have a primary image set).
 *
 * Polite: 1 second between requests, identifying User-Agent with contact.
 * Idempotent: skips champions that already have a portrait URL.
 * Resumable: persists progress every 10 champions so an interrupt doesn't
 *   lose work.
 *
 * Usage:
 *   pnpm scrape-portraits                       # process champions without portraits
 *   pnpm scrape-portraits -- --force            # re-scrape everything
 *   pnpm scrape-portraits -- --only "Lizard,Maestro"  # specific names
 */

import { readFileSync, writeFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

// ─── Config ─────────────────────────────────────────────────────────────

const SEED_PATH = 'data/champions/seed.json';
const FAILURES_PATH = 'scripts/scrape-failures.json';
const API_ENDPOINT =
  'https://marvel-contestofchampions.fandom.com/api.php';
const USER_AGENT =
  'mcoc.help portrait scraper (free MCOC tool; contact via mcoc.help)';
const RATE_LIMIT_MS = 1000;
const THUMB_WIDTH = 200; // px — sensible for our 72px display cells on retina

// ─── CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY_ARG = args.find((a) => a.startsWith('--only'));
const ONLY_NAMES: Set<string> | null = ONLY_ARG
  ? new Set(
      (ONLY_ARG.split('=')[1] ?? args[args.indexOf(ONLY_ARG) + 1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
  : null;

// ─── Types ──────────────────────────────────────────────────────────────

type Champion = {
  id: string;
  name: string;
  class: string;
  ascendable: boolean;
  portraitUrl?: string | null;
  prestige: unknown;
  [k: string]: unknown;
};

type ScrapeResult =
  | { kind: 'found'; url: string; source: string }
  | { kind: 'failed'; reason: string };

// ─── API helpers ────────────────────────────────────────────────────────

async function apiFetch(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  // Defend against the Cloudflare challenge page sneaking through — it
  // returns HTML, not JSON.
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new Error(`API returned non-JSON (got ${contentType}). Cloudflare challenge?`);
  }
  return res.json();
}

/**
 * Get the main page image (typically the infobox portrait) for an exact
 * page title. Returns null if the page doesn't exist or has no main image.
 */
async function getPageImage(title: string): Promise<string | null> {
  type Resp = {
    query?: {
      pages?: Array<{
        missing?: boolean;
        title?: string;
        thumbnail?: { source: string; width: number; height: number };
        original?: { source: string };
      }>;
    };
  };
  const data = (await apiFetch({
    action: 'query',
    titles: title,
    prop: 'pageimages',
    piprop: 'thumbnail|original',
    pithumbsize: String(THUMB_WIDTH),
  })) as Resp;

  const page = data.query?.pages?.[0];
  if (!page || page.missing) return null;
  // Prefer thumbnail (we want consistent sizing); fall back to original
  return page.thumbnail?.source ?? page.original?.source ?? null;
}

/**
 * Use OpenSearch to find the canonical page title for a fuzzy name.
 * Returns the top result's title, or null.
 */
async function searchTitle(name: string): Promise<string | null> {
  type Resp = [string, string[], string[], string[]];
  try {
    const data = (await apiFetch({
      action: 'opensearch',
      search: name,
      limit: '3',
      namespace: '0', // main namespace only — no Talk: / User: pages
    })) as Resp;
    const titles = data[1] ?? [];
    return titles[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Last-resort: enumerate all images on a page, look for one whose name
 * starts with "Portrait_". Useful when pageimages doesn't pick up the
 * intended primary image.
 */
async function findPortraitInImages(title: string): Promise<string | null> {
  type ImagesResp = {
    query?: {
      pages?: Array<{
        images?: Array<{ title: string }>;
      }>;
    };
  };
  const data = (await apiFetch({
    action: 'query',
    titles: title,
    prop: 'images',
    imlimit: '50',
  })) as ImagesResp;
  const images = data.query?.pages?.[0]?.images ?? [];
  // Files are titled "File:Portrait_Lizard.png" etc.
  const portraitFile = images.find((img) =>
    /^File:Portrait[_\s]/i.test(img.title),
  );
  if (!portraitFile) return null;

  // Now resolve File:Foo.png → actual CDN URL
  type ImageInfoResp = {
    query?: {
      pages?: Array<{
        imageinfo?: Array<{ thumburl?: string; url?: string }>;
      }>;
    };
  };
  const fileData = (await apiFetch({
    action: 'query',
    titles: portraitFile.title,
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: String(THUMB_WIDTH),
  })) as ImageInfoResp;
  const info = fileData.query?.pages?.[0]?.imageinfo?.[0];
  return info?.thumburl ?? info?.url ?? null;
}

// ─── Per-champion scrape (three-strategy ladder) ────────────────────────

async function scrapeChampion(champion: Champion): Promise<ScrapeResult> {
  const name = champion.name;

  // Strategy 1: exact title via pageimages
  try {
    const url = await getPageImage(name);
    if (url) return { kind: 'found', url, source: 'exact' };
  } catch (e) {
    return { kind: 'failed', reason: `API error: ${(e as Error).message}` };
  }
  await sleep(RATE_LIMIT_MS);

  // Strategy 1b: hyphen-normalised variant. MCOCHUB tends to use spaces
  // where Fandom uses hyphens ("Spider Man 2099" vs "Spider-Man 2099").
  const hyphenated = name
    .replace(/\bSpider Man\b/gi, 'Spider-Man')
    .replace(/\bSpider man\b/g, 'Spider-Man');
  if (hyphenated !== name) {
    try {
      const url = await getPageImage(hyphenated);
      if (url) return { kind: 'found', url, source: 'hyphenated' };
    } catch {
      /* fall through */
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Strategy 2: search for the canonical title, then re-query pageimages
  const searchedTitle = await searchTitle(name);
  if (searchedTitle && searchedTitle !== name) {
    await sleep(RATE_LIMIT_MS);
    try {
      const url = await getPageImage(searchedTitle);
      if (url) return { kind: 'found', url, source: `search:${searchedTitle}` };
    } catch {
      /* fall through */
    }

    // Strategy 3: enumerate images on the search-resolved page, find a Portrait_ file
    await sleep(RATE_LIMIT_MS);
    try {
      const url = await findPortraitInImages(searchedTitle);
      if (url) return { kind: 'found', url, source: `images:${searchedTitle}` };
    } catch {
      /* fall through */
    }
  }

  // Strategy 3 (no search): try image enumeration on exact title
  try {
    const url = await findPortraitInImages(name);
    if (url) return { kind: 'found', url, source: 'images-exact' };
  } catch {
    /* fall through */
  }

  return { kind: 'failed', reason: 'no portrait found via any strategy' };
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('MCOC portrait scraper (API mode)');
  console.log('════════════════════════════════');
  console.log(`Seed file:    ${SEED_PATH}`);
  console.log(`API:          ${API_ENDPOINT}`);
  console.log(`Force mode:   ${FORCE ? 'yes (re-scrape all)' : 'no (skip champions with portraits)'}`);
  if (ONLY_NAMES) {
    console.log(`Only:         ${Array.from(ONLY_NAMES).join(', ')}`);
  }
  console.log(`Rate limit:   ${RATE_LIMIT_MS}ms between requests`);
  console.log('');

  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as {
    champions: Champion[];
  };

  const toProcess = seed.champions.filter((c) => {
    if (ONLY_NAMES && !ONLY_NAMES.has(c.name)) return false;
    if (FORCE) return true;
    return !c.portraitUrl;
  });

  console.log(`Processing ${toProcess.length} of ${seed.champions.length} champions`);
  console.log('');

  const succeeded: { name: string; url: string; source: string }[] = [];
  const failed: { name: string; reason: string }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const c = toProcess[i]!;
    const progress = `[${(i + 1).toString().padStart(3)}/${toProcess.length}]`;
    process.stdout.write(`${progress} ${c.name.padEnd(40)} `);

    let result: ScrapeResult;
    try {
      result = await scrapeChampion(c);
    } catch (e) {
      result = {
        kind: 'failed',
        reason: `unexpected error: ${(e as Error).message}`,
      };
    }

    if (result.kind === 'found') {
      c.portraitUrl = result.url;
      succeeded.push({ name: c.name, url: result.url, source: result.source });
      console.log(`✓ (${result.source})`);
    } else {
      failed.push({ name: c.name, reason: result.reason });
      console.log(`✗ ${result.reason}`);
    }

    // Persist progress every 10 champions so we don't lose work on interrupt
    if ((i + 1) % 10 === 0) {
      writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n');
    }

    await sleep(RATE_LIMIT_MS);
  }

  // Final writes
  writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n');
  writeFileSync(
    FAILURES_PATH,
    JSON.stringify({ failed, scrapedAt: new Date().toISOString() }, null, 2) + '\n',
  );

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('════════════════════════════════');
  console.log(`Done in ${elapsedSec}s`);
  console.log(`  Found:  ${succeeded.length}`);
  console.log(`  Failed: ${failed.length}`);
  console.log('');

  if (succeeded.length > 0) {
    const bySource = succeeded.reduce(
      (acc, s) => {
        // Source can be "exact" / "hyphenated" / "search:Foo" / "images:Foo" / "images-exact"
        // Bucket the search:* and images:* ones together for the summary.
        const key = s.source.split(':')[0] ?? 'unknown';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    console.log('Found by resolution strategy:');
    for (const [src, count] of Object.entries(bySource)) {
      console.log(`  ${src}: ${count}`);
    }
    console.log('');
  }

  if (failed.length > 0) {
    console.log(`Failures logged to ${FAILURES_PATH}`);
    console.log('First 10 failures:');
    for (const f of failed.slice(0, 10)) {
      console.log(`  ${f.name.padEnd(40)} ${f.reason}`);
    }
    if (failed.length > 10) {
      console.log(`  ... and ${failed.length - 10} more`);
    }
    console.log('');
    console.log('For manual fixes: find the champion page on the Fandom wiki,');
    console.log('right-click the headshot → copy image address, paste into the');
    console.log('relevant champion\'s portraitUrl field in seed.json.');
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
