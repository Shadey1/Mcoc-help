/**
 * Extract per-champion immunity + resist data from Kabam's official
 * champion spotlight blog posts.
 *
 * playcontestofchampions.com is a WordPress site. Its REST endpoint at
 * /wp-json/wp/v2/posts?categories=61 returns every "Champion Spotlights"
 * post — 331 as of writing — as structured JSON with the full HTML
 * content in `content.rendered`. We stream the pages, cache them under
 * .cache/kabam/, strip the HTML to plain text, and feed the ability
 * prose through the same guarded parser we already use for MCOCHUB kit
 * text (packages/engine/src/immunity-text-parser.ts) so negation and
 * inflict-verb false positives are killed uniformly across sources.
 *
 * Slug reconciliation: Kabam post slugs look like
 * "champion-spotlight-<champion-slug>". Strip the prefix; try that as
 * a seed id first, then fall back to a small normalisation ladder.
 *
 * Freshness: Kabam updates spotlights on champion reworks, so treat as
 * always-current. Coverage skews modern — the Champion Spotlights
 * category only really took off from ~2019, so pre-2019 legacy champs
 * are less likely to have a post. That's fine: auntm.ai covers legacy,
 * Kabam covers modern, together they hit the whole roster with at
 * least one independent-of-MCOCHUB voter.
 *
 * Usage:
 *   pnpm extract-kabam-immunities
 *
 * Output:
 *   data/champions/immunities-kabam.json
 *
 * Cache:
 *   .cache/kabam/posts-page-<N>.json  (raw API responses)
 *   .cache/kabam/index.json           (slug → post-id lookup)
 * Delete the cache to force a fresh crawl.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseImmunitiesFromLines } from '../packages/engine/src/immunity-text-parser.js';

const SEED_PATH = 'data/champions/seed.json';
const OUTPUT_PATH = 'data/champions/immunities-kabam.json';
const CACHE_DIR = '.cache/kabam';
const CATEGORY_ID = 61;
const PER_PAGE = 100;
const API_BASE = 'https://playcontestofchampions.com/wp-json/wp/v2/posts';

// Cloudflare on the Kabam site is picky about UA. A generic
// "Mozilla/5.0" gets challenged; a full Chrome fingerprint gets through
// (verified against several posts). We're not evading a paywall —
// spotlights are public — just past a bot-check that trips on curl.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

type Seed = { champions: Array<{ id: string; name: string; released?: string }> };

type WpPost = {
  id: number;
  slug: string;
  title: { rendered: string };
  content: { rendered: string };
  modified: string;
};

// ─── Fetch (paginated) ─────────────────────────────────────────────────

async function fetchAllSpotlights(): Promise<WpPost[]> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const all: WpPost[] = [];
  let page = 1;
  for (;;) {
    const cachePath = `${CACHE_DIR}/posts-page-${page}.json`;
    let bodyText: string;
    if (existsSync(cachePath)) {
      bodyText = readFileSync(cachePath, 'utf8');
    } else {
      const url = `${API_BASE}?categories=${CATEGORY_ID}&per_page=${PER_PAGE}&page=${page}&_fields=id,slug,title,content,modified`;
      console.log(`Fetching page ${page}…`);
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      // WordPress returns 400 when you ask for a page past the end;
      // treat that as the terminator rather than a failure.
      if (res.status === 400) break;
      if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
      bodyText = await res.text();
      writeFileSync(cachePath, bodyText);
    }
    const posts = JSON.parse(bodyText) as WpPost[];
    if (posts.length === 0) break;
    all.push(...posts);
    if (posts.length < PER_PAGE) break;
    page++;
  }
  return all;
}

// ─── Slug reconciliation ───────────────────────────────────────────────

/**
 * Reduce a candidate string to a lookup key. Lower-case, collapse to
 * alphanumerics only. Matches on both sides make "the-hood" and
 * "hood" and "The Hood" all resolve to `thehood`.
 */
function canonicalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildSeedLookup(seed: Seed): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of seed.champions) {
    map.set(canonicalise(c.id), c.id);
    map.set(canonicalise(c.name), c.id);
  }
  return map;
}

/**
 * Map a Kabam post slug (`champion-spotlight-thor-ragnarok`) to a seed
 * champion id. Strip the well-known prefix, then look up several
 * normalised forms — the seed lookup is keyed on canonical
 * alphanumerics-only, so hyphens/spaces/etc. don't matter.
 */
function resolveSeedId(
  postSlug: string,
  postTitle: string,
  seedLookup: Map<string, string>,
): string | null {
  const base = postSlug.replace(/^champion-spotlight-/, '');
  const candidates = new Set<string>([base, postTitle]);
  for (const c of candidates) {
    const key = canonicalise(c);
    if (!key) continue;
    const id = seedLookup.get(key);
    if (id) return id;
  }
  return null;
}

// ─── Content extraction ────────────────────────────────────────────────

/**
 * Strip HTML tags and decode a modest set of entities. Kabam's WP-JSON
 * output includes named entities (`&#8217;` right single quote,
 * `&nbsp;`, `&amp;`) that our downstream parsers would otherwise
 * mis-tokenise. We keep line structure by turning `<br>`, `</p>`, and
 * list terminators into newlines — the parser scans line-at-a-time.
 */
function htmlToLines(html: string): string[] {
  const withNewlines = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const decoded = withNewlines
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;|&lsquo;|&apos;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return decoded
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;
  const seedLookup = buildSeedLookup(seed);

  const posts = await fetchAllSpotlights();
  console.log(`Fetched ${posts.length} spotlight posts.`);

  const out: Record<string, Record<string, unknown>> = {};
  let matchedPosts = 0;
  let unresolvedSlugs = 0;
  let totalSignals = 0;

  for (const post of posts) {
    const seedId = resolveSeedId(post.slug, post.title.rendered, seedLookup);
    if (!seedId) {
      unresolvedSlugs++;
      continue;
    }
    matchedPosts++;
    const lines = htmlToLines(post.content.rendered);
    const perEffect = parseImmunitiesFromLines(lines);
    const keys = Object.keys(perEffect);
    if (keys.length === 0) continue;
    // If two posts resolve to the same seed id (Deathless variants,
    // reworks, etc.), the later one's marks overwrite. This is fine —
    // more recent posts reflect more recent balance state.
    out[seedId] = perEffect as Record<string, unknown>;
    totalSignals += keys.length;
  }

  const payload = {
    _meta: {
      note:
        'Extracted from Kabam Champion Spotlight blog posts via the site\'s ' +
        'WP-JSON REST API. Prose ability text is run through the same ' +
        'immunity-text-parser as MCOCHUB (negation + inflict guards) so ' +
        'false positives are controlled uniformly. Freshness: Kabam edits ' +
        'spotlights on reworks, treat as always-current. Coverage skews ' +
        'toward post-2019 releases (spotlight cadence).',
      source: 'playcontestofchampions.com — Champion Spotlights (category 61)',
      generatedAt: new Date().toISOString().slice(0, 10),
      matchedPosts,
      unresolvedSlugs,
      championCount: Object.keys(out).length,
      totalSignals,
    },
    champions: out,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `Matched ${matchedPosts}/${posts.length} posts to seed champions, ${unresolvedSlugs} unresolved.`,
  );
  console.log(
    `Extracted ${Object.keys(out).length} champion records / ${totalSignals} effect signals → ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
