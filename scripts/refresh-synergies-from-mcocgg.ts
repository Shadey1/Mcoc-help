/**
 * Refresh champion synergy data from mcoc.gg.
 *
 * Data shape on the source side:
 *   /json/champions.json — each champion has parallel arrays:
 *     synergy[i]     = number[]   (partner numeric IDs for synergy i)
 *     synergy_map[i] = number     (synergy ID into synergies.json)
 *   /json/synergies.json — { id, name, icon, desc, unique? }
 *
 * The `desc` field uses `<g>...</g>` tags to group per-champion sub-effects
 * inside a single synergy. Bracketed numbers like `[600]` are real, already-
 * substituted values for the relevant rarity (7-star). We strip the tags
 * but keep each <g> block as a separate paragraph string.
 *
 * Output: data/champions/synergies.json, keyed by our champion slug, with
 * partner entries carrying both `name` (always set, for display) and
 * `slug` (optional, set when the partner is in our seed and clickable).
 *
 * Usage:
 *   pnpm refresh-synergies               # fetch + write (no diff mode — synergy
 *                                        # data changes rarely; just overwrite)
 */
import { readFileSync, writeFileSync } from 'fs';

const SEED_PATH = 'data/champions/seed.json';
const OUTPUT_PATH = 'data/champions/synergies.json';
const SOURCE_BASE = 'https://mcoc.gg';
const USER_AGENT =
  'mcoc.help synergy refresher (free MCOC tool; contact via mcoc.help)';
const FETCH_TIMEOUT_MS = 15000;

// ─── Types ──────────────────────────────────────────────────────────────

type MasterEntry = {
  id: number;
  name: string;
  image: string; // mcoc.gg's own slug, e.g. "ghostrider"
  synergy?: number[][];
  synergy_map?: number[];
};
type ChampionsFile = { data: MasterEntry[] };

type SynergyDef = {
  id: string;
  name: string;
  icon: string;
  desc: string;
  unique?: boolean;
};
type SynergiesFile = { data: SynergyDef[] };

type SeedChampion = { id: string; name: string };
type Seed = { champions: SeedChampion[] };

type PartnerRef = {
  /** Display name from mcoc.gg, always present. */
  name: string;
  /** Our slug, set only when the partner is in our seed (→ clickable link). */
  slug?: string;
};

type Synergy = {
  synergyId: number;
  name: string;
  icon: string;
  unique: boolean;
  /** Partners required to activate this synergy (does not include the host). */
  partners: PartnerRef[];
  /** Per-champion effect paragraphs (one per <g> block in the source desc). */
  effects: string[];
};

type SynergiesOutput = {
  _meta: {
    source: string;
    fetchedAt: string;
    seedChampionCount: number;
    mcocggChampionCount: number;
    matched: number;
    unmatched: string[];
  };
  champions: Record<string, Synergy[]>;
};

// ─── Fetch ──────────────────────────────────────────────────────────────

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

// ─── Name → slug mapping (same approach as refresh-bhr-from-mcocgg) ─────

function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
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
  // "Kang the Conqueror" on our side → "Kang" on mcoc.gg. Strip a trailing
  // "the Foo" suffix as a final fallback.
  const stripped = seedName.replace(/\s+the\s+\w+$/i, '').trim();
  if (stripped && stripped !== seedName) keys.add(normaliseName(stripped));
  return Array.from(keys);
}

// ─── Effect text parsing ────────────────────────────────────────────────

/** Pull each `<g>...</g>` chunk out as its own paragraph. Whitespace
 *  normalised; tags stripped. */
function parseEffects(desc: string): string[] {
  if (!desc) return [];
  const blocks: string[] = [];
  const re = /<g>([\s\S]*?)<\/g>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc))) {
    const text = m[1]!
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) blocks.push(text);
  }
  if (blocks.length === 0) {
    // Fallback for entries with no <g> wrapping
    const fallback = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (fallback) blocks.push(fallback);
  }
  return blocks;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching mcoc.gg/json/champions.json …');
  const champFile = await getJson<ChampionsFile>(`${SOURCE_BASE}/json/champions.json`);
  console.log(`  ${champFile.data.length} entries`);

  console.log('Fetching mcoc.gg/json/synergies.json …');
  const synFile = await getJson<SynergiesFile>(`${SOURCE_BASE}/json/synergies.json`);
  console.log(`  ${synFile.data.length} synergy definitions`);

  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;
  console.log(`Seed: ${seed.champions.length} champions`);

  // Build mcoc.gg key → master entry map.
  // Name keys take precedence over image keys (image keys can collide across
  // distinct champs — e.g. base "Captain Marvel (Classic)" has image
  // "captainmarvel" which would otherwise shadow the modern "Captain Marvel"
  // entry whose image is "captainmarvelmcu").
  const byKey = new Map<string, MasterEntry>();
  for (const m of champFile.data) byKey.set(normaliseName(m.name), m);
  for (const m of champFile.data) {
    if (m.image && !byKey.has(m.image)) byKey.set(m.image, m);
  }

  // Map our seed slug → mcoc.gg numeric id (and back, for partner resolution)
  const slugToMcocId = new Map<string, number>();
  const mcocIdToSlug = new Map<number, string>();
  const mcocIdToName = new Map<number, string>();
  for (const m of champFile.data) mcocIdToName.set(m.id, m.name);

  const unmatched: string[] = [];
  for (const c of seed.champions) {
    let hit: MasterEntry | undefined;
    for (const k of candidateKeys(c.name)) {
      hit = byKey.get(k);
      if (hit) break;
    }
    if (!hit) {
      unmatched.push(`${c.name} (${c.id})`);
      continue;
    }
    slugToMcocId.set(c.id, hit.id);
    mcocIdToSlug.set(hit.id, c.id);
  }
  console.log(
    `Matched ${slugToMcocId.size}/${seed.champions.length}; unmatched: ${unmatched.length}`,
  );
  if (unmatched.length > 0) {
    console.log('  unmatched:', unmatched.slice(0, 20).join(', '));
    if (unmatched.length > 20) console.log(`  … and ${unmatched.length - 20} more`);
  }

  // Build synergy id → def
  const synById = new Map<number, SynergyDef>();
  for (const s of synFile.data) synById.set(Number(s.id), s);

  // Build output
  const champions: Record<string, Synergy[]> = {};
  let totalSynergies = 0;
  for (const c of seed.champions) {
    const mcocId = slugToMcocId.get(c.id);
    if (mcocId === undefined) continue;
    const master = champFile.data.find((m) => m.id === mcocId);
    if (!master || !master.synergy || !master.synergy_map) continue;

    const list: Synergy[] = [];
    for (let i = 0; i < master.synergy.length; i++) {
      const partnerIds = master.synergy[i] ?? [];
      const synId = master.synergy_map[i];
      if (synId === undefined) continue;
      const def = synById.get(synId);
      if (!def) continue;

      const partners: PartnerRef[] = partnerIds.map((pid) => {
        const slug = mcocIdToSlug.get(pid);
        const name = mcocIdToName.get(pid) ?? `Unknown (${pid})`;
        return slug ? { name, slug } : { name };
      });

      list.push({
        synergyId: synId,
        name: def.name,
        icon: def.icon,
        unique: Boolean(def.unique),
        partners,
        effects: parseEffects(def.desc),
      });
    }
    if (list.length > 0) {
      champions[c.id] = list;
      totalSynergies += list.length;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const output: SynergiesOutput = {
    _meta: {
      source: 'mcoc.gg /json/champions.json + /json/synergies.json',
      fetchedAt: today,
      seedChampionCount: seed.champions.length,
      mcocggChampionCount: champFile.data.length,
      matched: slugToMcocId.size,
      unmatched,
    },
    champions,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(
    `Wrote ${OUTPUT_PATH}: ${Object.keys(champions).length} champions, ${totalSynergies} synergies total`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
