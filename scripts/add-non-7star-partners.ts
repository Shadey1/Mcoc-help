/**
 * One-off script: append stub seed entries for synergy partners that aren't
 * yet at 7-star.
 *
 * Why we need it: mcoc.gg references synergies by base-champion ID (e.g.
 * "Wolverine"). Our seed only has the modern 7-star variants ("Wolverine
 * (Weapon X)" etc.). Synergy partners that have no 7-star variant in our seed
 * end up as text-only tiles. To make them clickable + give them a detail page
 * with the "not yet at 7-star" banner, we add minimal stub entries — name,
 * class, portrait — with `sevenStarReleased: false` and NO prestige data.
 *
 * The engine never touches them (loadActiveChampions filters by both
 * `sevenStarReleased` and `prestige !== undefined`).
 *
 * Data sources:
 *   /json/champions.json — class id, image slug
 *   Fandom MediaWiki API — portrait URL via File:<Name>_portrait.png
 *
 * Run once after the initial synergy refresh; re-run `pnpm refresh-synergies`
 * afterwards so every partner now resolves to a slug.
 *
 *   pnpm tsx scripts/add-non-7star-partners.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const SEED_PATH = 'data/champions/seed.json';
const SYNERGIES_PATH = 'data/champions/synergies.json';
const USER_AGENT =
  'mcoc.help partner stub builder (free MCOC tool; contact via mcoc.help)';
const FANDOM_API =
  'https://marvel-contestofchampions.fandom.com/api.php';
const FETCH_TIMEOUT_MS = 15000;
const RATE_LIMIT_MS = 350;

// mcoc.gg class id → our ChampionClass
const CLASS_MAP: Record<number, string> = {
  1: 'Cosmic',
  2: 'Tech',
  3: 'Mutant',
  4: 'Skill',
  5: 'Science',
  6: 'Mystic',
};

type MasterEntry = {
  id: number;
  name: string;
  class: number;
  image: string;
};
type ChampionsFile = { data: MasterEntry[] };

type Seed = {
  champions: Array<{
    id: string;
    name: string;
    class: string;
    ascendable: boolean;
    prestige?: unknown;
    sigCurve?: string | null;
    tags?: string[];
    portraitUrl?: string | null;
    sevenStarReleased?: boolean;
    _meta?: Record<string, unknown>;
  }>;
};

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

/** Slugify a partner name to match our existing seed convention.
 *  "Wolverine" → "wolverine"; "Daredevil (Classic)" → "daredevil-classic";
 *  "Hulk (Ragnarok)" → "hulk-ragnarok". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type FandomQueryResponse = {
  query?: {
    pages?: Record<
      string,
      {
        imageinfo?: Array<{ url: string }>;
      }
    >;
  };
};

async function fandomPortraitUrl(name: string): Promise<string | null> {
  const fileTitle = `File:${name.replace(/ /g, '_')}_portrait.png`;
  const url =
    `${FANDOM_API}?action=query&format=json&prop=imageinfo&iiprop=url&titles=` +
    encodeURIComponent(fileTitle);
  try {
    const res = await getJson<FandomQueryResponse>(url);
    const pages = res.query?.pages;
    if (!pages) return null;
    for (const k of Object.keys(pages)) {
      const url = pages[k]?.imageinfo?.[0]?.url;
      if (url) {
        // Insert /scale-to-width-down/200 just before the query string for
        // CDN-side downsizing, matching existing seed entries.
        const m = url.match(/^(.*\/revision\/latest)(\?.*)?$/);
        if (m) return `${m[1]}/scale-to-width-down/200${m[2] ?? ''}`;
        return url;
      }
    }
    return null;
  } catch (err) {
    console.warn(`  ⚠ fandom lookup failed for ${name}: ${String(err)}`);
    return null;
  }
}

async function main() {
  console.log('Loading existing seed + synergies …');
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;
  const synergies = JSON.parse(readFileSync(SYNERGIES_PATH, 'utf8')) as {
    champions: Record<
      string,
      Array<{ partners: Array<{ name: string; slug?: string }> }>
    >;
  };
  const existingSlugs = new Set(seed.champions.map((c) => c.id));

  // Collect unique non-seed partner names
  const partnerNames = new Set<string>();
  for (const slug of Object.keys(synergies.champions)) {
    for (const s of synergies.champions[slug]!) {
      for (const p of s.partners) {
        if (!p.slug) partnerNames.add(p.name);
      }
    }
  }
  console.log(`  ${partnerNames.size} unique non-seed partner names`);

  console.log('Fetching mcoc.gg/json/champions.json for class/image lookup …');
  const champFile = await getJson<ChampionsFile>(
    'https://mcoc.gg/json/champions.json',
  );
  const byName = new Map<string, MasterEntry>();
  for (const m of champFile.data) byName.set(m.name, m);

  const newEntries: Seed['champions'] = [];
  const skipped: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  let i = 0;
  for (const name of partnerNames) {
    i++;
    const master = byName.get(name);
    if (!master) {
      skipped.push(`${name} (not in mcoc.gg)`);
      continue;
    }
    const className = CLASS_MAP[master.class];
    if (!className) {
      skipped.push(`${name} (unknown class id ${master.class})`);
      continue;
    }
    const slug = slugify(name);
    if (existingSlugs.has(slug)) {
      skipped.push(`${name} (slug collision: ${slug})`);
      continue;
    }
    console.log(`[${i}/${partnerNames.size}] ${name} → ${slug} (${className})`);
    const portraitUrl = await fandomPortraitUrl(name);
    if (!portraitUrl) console.log(`  · no portrait found`);
    newEntries.push({
      id: slug,
      name,
      class: className,
      ascendable: false,
      sigCurve: null,
      tags: [],
      _meta: {
        bhrSource: 'partner-only stub — not yet released at 7★',
        lastVerified: today,
      },
      portraitUrl,
      sevenStarReleased: false,
    });
    existingSlugs.add(slug);
    await sleep(RATE_LIMIT_MS);
  }

  console.log(
    `\nAdded ${newEntries.length} stubs; ${skipped.length} skipped.`,
  );
  if (skipped.length) console.log('Skipped:', skipped.join(', '));

  // Insert sorted alphabetically, preserving existing order otherwise
  seed.champions.push(...newEntries);
  seed.champions.sort((a, b) => a.id.localeCompare(b.id));

  writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n');
  console.log(
    `Wrote ${SEED_PATH}: ${seed.champions.length} total champions.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
