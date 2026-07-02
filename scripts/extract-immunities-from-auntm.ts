/**
 * Extract per-champion immunity + resist data from the auntm.ai JS bundle.
 *
 * auntm.ai is a Single Page App that ships its entire champion database
 * inline in the JS bundle. There's no public API (api.auntm.ai requires
 * AWS-signed auth), but the bundle is publicly downloadable and contains
 * structured records in a very consistent shape:
 *
 *   m_<prefix>NNN: {
 *     characters: { <slug>: { tiers: [...] } },
 *     ...
 *     type: "Immunity type=poison,shock; modType=..."       ← immune band
 *     type: "Mod Percent type=bleed,incinerate; modType=..." ← resist band
 *     type: "Purify type=bleed; modType=..."                 ← mechanic band
 *     modifier: -1.5,   // for Mod Percent: |mod * 100| = resist %
 *     appearance: { longString: "Ant-Man is Immune to Poison and Shock effects." }
 *   }
 *
 * We parse those out and emit data/champions/immunities-auntm.json in the
 * same shape as the other immunity sources, so the reconciliation runner
 * treats it as a third independent voter. Freshness (auntm frozen mid-2024)
 * is handled downstream via DEFAULT_FRESHNESS in the engine.
 *
 * Usage:
 *   pnpm extract-auntm-immunities
 *
 * Cache: .cache/auntm/main.js (fetched on first run, reused thereafter).
 * Delete the cache to re-fetch a fresher bundle.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SEED_PATH = 'data/champions/seed.json';
const ABILITIES_PATH = 'data/champions/abilities.json';
const OUTPUT_PATH = 'data/champions/immunities-auntm.json';
const CACHE_DIR = '.cache/auntm';
const BUNDLE_URL_INDEX = 'https://auntm.ai';
const USER_AGENT = 'Mozilla/5.0 (compatible; mcoc.help immunity-source-reconciler)';

// Auntm's internal effect keys → our four-signal vocabulary.
// The bundle uses lowercase Kabam-internal names. Anything not mapped here
// is deliberately dropped (out of our 13-effect scope).
const EFFECT_KEY_MAP: Record<string, string> = {
  poison: 'Poison',
  bleed: 'Bleed',
  incinerate: 'Incinerate',
  coldsnap: 'Coldsnap',
  shock: 'Shock',
  stun: 'Stun',
  stagger: 'Stagger',
  nullify: 'Nullify',
  heal_block: 'Heal Block',
  armor_break: 'Armor Break',
  degeneration: 'Degeneration',
  degen: 'Degeneration',
  neuroshock: 'Neuroshock',
  power_burn: 'Power Burn',
  // Notes on unmapped keys we intentionally skip:
  //   frostbite, fateseal, petrify, neutralize, tranquilize, intimidate,
  //   infuriate, slow, mana_burn, mana_loss, mana_steal, armor_up,
  //   armor_shattered, regen_rate, reflection_active, chance_mod,
  //   effect_accuracy — all outside the tracked 13-effect scope.
};

// ─── Types ─────────────────────────────────────────────────────────────

type ParsedBand =
  | { band: 'immune' }
  | { band: 'resist'; qual: string }
  | { band: 'mechanic'; qual: 'Purify' | 'Duration' };

type Seed = { champions: Array<{ id: string; name: string; released?: string }> };
type Abilities = { champions: Record<string, { source: { slug: string } }> };

// ─── Bundle fetch ──────────────────────────────────────────────────────

async function ensureBundle(): Promise<string> {
  const main = `${CACHE_DIR}/main.js`;
  if (existsSync(main)) return readFileSync(main, 'utf8');
  console.log('Fetching auntm.ai landing page to discover bundle URL…');
  const index = await (
    await fetch(BUNDLE_URL_INDEX, { headers: { 'User-Agent': USER_AGENT } })
  ).text();
  const match = index.match(/src="(\/static\/js\/main\.[a-f0-9]+\.chunk\.js)"/);
  if (!match) throw new Error('Could not find main.js bundle URL on auntm.ai');
  const bundleUrl = `https://auntm.ai${match[1]}`;
  console.log(`Fetching ${bundleUrl}…`);
  const bundle = await (
    await fetch(bundleUrl, { headers: { 'User-Agent': USER_AGENT } })
  ).text();
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(main, bundle);
  return bundle;
}

// ─── Champion slug discovery ───────────────────────────────────────────

/**
 * Auntm uses continuous-word slugs (antman, doctorstrange, ironmanindustries).
 * MCOCHUB's are mostly the same. For each seed champion, try the MCOCHUB
 * slug we already recorded in abilities.json; fall back to a normalised
 * form of the seed id and display name.
 */
function candidateSlugs(seedId: string, name: string, mcochubSlug?: string): string[] {
  const out = new Set<string>();
  if (mcochubSlug) out.add(mcochubSlug.toLowerCase());
  out.add(seedId.replace(/-/g, '').toLowerCase());
  out.add(seedId.toLowerCase());
  out.add(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return Array.from(out).filter(Boolean);
}

// ─── Record extraction ─────────────────────────────────────────────────

/**
 * Return the byte offsets in the bundle where a champion's mod records
 * begin. Auntm keys every record `m_<prefix>NNN:{ characters: { slug: ...
 * so we scan for `characters:{<slug>:` and walk back to find the enclosing
 * `m_...NNN:{` opening.
 */
function findRecordStarts(bundle: string, slug: string): number[] {
  const marker = `characters:{${slug}:{tiers`;
  const out: number[] = [];
  let i = 0;
  for (;;) {
    const idx = bundle.indexOf(marker, i);
    if (idx === -1) break;
    // Walk backwards to find `m_XXXNNN:{`
    // Cap the walk to 200 chars — auntm records are compact.
    const winStart = Math.max(0, idx - 200);
    const window = bundle.slice(winStart, idx);
    const openMatches = [...window.matchAll(/m_[a-z_]{2,15}\d+:\{/gi)];
    if (openMatches.length > 0) {
      const last = openMatches[openMatches.length - 1]!;
      out.push(winStart + last.index);
    }
    i = idx + marker.length;
  }
  return out;
}

/**
 * Extract the fields we care about from one record starting at `start`.
 * The record ends at the balanced closing `}`. Rather than a full JS
 * parse, we scan forward tracking `{`/`}` depth (respecting single- and
 * double-quoted strings + backslash escapes).
 */
function readRecord(bundle: string, start: number): string {
  // Find the opening brace of the record.
  const openBrace = bundle.indexOf('{', start);
  if (openBrace === -1) return '';
  let depth = 1;
  let i = openBrace + 1;
  let quote: string | null = null;
  while (i < bundle.length && depth > 0) {
    const ch = bundle[i]!;
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
    } else {
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    i++;
  }
  return bundle.slice(start, i);
}

function parseType(record: string): string | null {
  const m = record.match(/type:"([^"]+)"/);
  return m ? m[1]! : null;
}

function parseModifier(record: string): number | null {
  const m = record.match(/modifier:(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]!) : null;
}

function parseLongString(record: string): string {
  const m = record.match(/longString:"([^"]{0,600})"/);
  return m ? m[1]! : '';
}

/**
 * Map an auntm `type:` string to a set of (effect, band) marks. Handles
 * three families:
 *   - "Immunity type=X,Y; ..."         → immune per X in vocabulary
 *   - "Mod Percent type=X,Y; ..."      → resist per X, with |modifier * 100| %
 *   - "Purify type=X; ..." / "Purify"  → mechanic Purify per X
 * Effects outside our tracked vocabulary are dropped silently.
 */
function typeToMarks(
  typeStr: string,
  modifier: number | null,
): Array<{ effect: string; band: ParsedBand }> {
  const marks: Array<{ effect: string; band: ParsedBand }> = [];
  const family =
    typeStr.startsWith('Immunity')
      ? 'immune'
      : typeStr.startsWith('Mod Percent')
        ? 'resist'
        : typeStr.startsWith('Purify')
          ? 'purify'
          : null;
  if (!family) return marks;

  const typeMatch = typeStr.match(/type=([a-z0-9_,\s]+?)(?:;|$)/);
  if (!typeMatch) {
    // "Purify" with no type= — global purify, no per-effect claim.
    return marks;
  }
  const keys = typeMatch[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const key of keys) {
    const effect = EFFECT_KEY_MAP[key];
    if (!effect) continue;
    if (family === 'immune') {
      marks.push({ effect, band: { band: 'immune' } });
    } else if (family === 'resist') {
      const pct =
        modifier !== null ? Math.round(Math.abs(modifier) * 100) : 0;
      if (pct <= 0) continue;
      marks.push({ effect, band: { band: 'resist', qual: `${pct}%` } });
    } else {
      marks.push({ effect, band: { band: 'mechanic', qual: 'Purify' } });
    }
  }
  return marks;
}

// ─── Per-champion aggregation ──────────────────────────────────────────

function bandRank(b: ParsedBand): number {
  if (b.band === 'immune') return 100;
  if (b.band === 'resist') {
    const n = parseInt(b.qual, 10);
    return Number.isFinite(n) ? Math.min(n, 99) : 0;
  }
  return 50; // mechanic
}

function assignBest(
  perEffect: Record<string, ParsedBand>,
  effect: string,
  band: ParsedBand,
): void {
  const existing = perEffect[effect];
  if (!existing || bandRank(band) > bandRank(existing)) perEffect[effect] = band;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Seed;
  const abilities = JSON.parse(readFileSync(ABILITIES_PATH, 'utf8')) as Abilities;

  const bundle = await ensureBundle();
  console.log(`Bundle: ${(bundle.length / 1_000_000).toFixed(1)} MB in memory`);

  const out: Record<string, Record<string, ParsedBand>> = {};
  const passiveText: Record<string, string[]> = {};

  let matched = 0;
  let missing = 0;

  for (const champ of seed.champions) {
    if (champ.released && parseInt(champ.released, 10) > 2024) {
      // Auntm is frozen mid-2024 — skip newer champs to avoid noise from
      // false-matching slugs (e.g. base-name collisions).
      missing++;
      continue;
    }
    const mcochubSlug = abilities.champions[champ.id]?.source.slug;
    const candidates = candidateSlugs(champ.id, champ.name, mcochubSlug);
    let usedSlug: string | null = null;
    let starts: number[] = [];
    for (const c of candidates) {
      starts = findRecordStarts(bundle, c);
      if (starts.length > 0) {
        usedSlug = c;
        break;
      }
    }
    if (!usedSlug || starts.length === 0) {
      missing++;
      continue;
    }
    matched++;

    const perEffect: Record<string, ParsedBand> = {};
    const passives: string[] = [];
    for (const start of starts) {
      const record = readRecord(bundle, start);
      const typeStr = parseType(record);
      if (!typeStr) continue;
      const modifier = parseModifier(record);
      const long = parseLongString(record);
      const marks = typeToMarks(typeStr, modifier);
      for (const m of marks) assignBest(perEffect, m.effect, m.band);
      // Snapshot the prose passive lines for the detail-page renderer.
      if (
        long &&
        marks.length > 0 &&
        !passives.includes(long) &&
        passives.length < 8
      ) {
        passives.push(long);
      }
    }
    if (Object.keys(perEffect).length > 0) out[champ.id] = perEffect;
    if (passives.length > 0) passiveText[champ.id] = passives;
  }

  const payload = {
    _meta: {
      note:
        'Extracted from auntm.ai\'s public JS bundle (SPA client-side data). ' +
        'Immunity bands: Immunity type=... → immune; Mod Percent type=... → ' +
        'resist |modifier*100|%; Purify type=... → mechanic Purify. Champions ' +
        'released after 2024 are skipped because the bundle is frozen mid-2024 ' +
        '(matches DEFAULT_FRESHNESS.auntm.staleAfter). The passives object ' +
        'carries prose ability lines for the detail-page renderer to synthesise ' +
        'a PASSIVE card when MCOCHUB\'s kit doesn\'t already have one.',
      source: 'auntm.ai (main.js bundle)',
      generatedAt: new Date().toISOString().slice(0, 10),
      matched,
      skipped: missing,
    },
    champions: out,
    passives: passiveText,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `Extracted ${matched} champion records with ${Object.keys(out).length} immunity marks → ${OUTPUT_PATH}`,
  );
  console.log(`Skipped ${missing} champions (either post-2024 or slug not found in bundle).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
