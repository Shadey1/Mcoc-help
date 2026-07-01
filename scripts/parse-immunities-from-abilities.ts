/**
 * Parse per-champion kit text (data/champions/abilities.json) into the
 * four-signal immunity dataset.
 *
 * MCOCHUB's pills.immunities give the immune + synergy bands but not
 * numeric resistances or purify/duration mechanics — those show up in
 * the champion's own ability description text. This parser scans every
 * kit line (signature + all cards) with tight patterns and extracts:
 *
 *   "Immune to X (and|or) Y."           → { band: 'immune' } for each
 *   "X Immunity"                        → { band: 'immune' }
 *   "N% X Resistance"                   → { band: 'resist', qual: 'N%' }
 *
 * Precedence when a champion has multiple signals for the same effect:
 *   immune > resist ≥100% > resist <100% > (no entry)
 *
 * Purify / Duration mechanics need contextual reading and stay in the
 * hand-curated fixture (GuiaMTC transcription). Synergy comes from the
 * pill backfill (script `backfill-immunities-from-mcochub.ts`).
 *
 * Output:
 *   data/champions/immunities-kit-derived.json
 *
 * The web loader merges: pill backfill < kit-derived < fixture, so a
 * champion with only a pill entry gets it; a champion whose kit
 * mentions a specific resistance percentage upgrades to that; a
 * champion in the fixture wins entirely (four-signal ground truth).
 *
 * Rerun after abilities.json refresh:
 *   pnpm parse-immunity-kits
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ABILITIES_PATH = 'data/champions/abilities.json';
const OUTPUT_PATH = 'data/champions/immunities-kit-derived.json';

const TRACKED_EFFECTS = [
  'Bleed',
  'Poison',
  'Incinerate',
  'Coldsnap',
  'Shock',
  'Neuroshock',
  'Stun',
  'Stagger',
  'Nullify',
  'Armor Break',
  'Degeneration',
  'Power Burn',
  'Heal Block',
] as const;
type Effect = (typeof TRACKED_EFFECTS)[number];
const EFFECT_SET = new Set<string>(TRACKED_EFFECTS);
const EFFECT_ALT = new Map<string, Effect>([
  ['Armour Break', 'Armor Break'], // British spelling occasionally slips in
]);

type ImmunityBand =
  | { band: 'immune' }
  | { band: 'resist'; qual: string };

/** Rank the "quality" of a band so the strongest signal wins per effect. */
function bandRank(b: ImmunityBand): number {
  if (b.band === 'immune') return 100;
  const n = parseInt(b.qual, 10);
  return Number.isFinite(n) ? Math.min(n, 99) : 0;
}

function normaliseEffect(raw: string): Effect | null {
  const cleaned = raw
    .trim()
    // Strip leading determiners/quantifiers so "all Stun effects" → "Stun effects".
    .replace(/^(a|an|the|any|all|each|every|some|one|two|three)\s+/i, '')
    // Strip trailing "effects" / "effect" / "debuffs" / "debuff" / "buffs" / "buff" / "passives" / "passive"
    // so "Stun effects" → "Stun", "Poison Debuff" → "Poison".
    .replace(/\s+(effects?|debuffs?|buffs?|passives?)\s*$/i, '')
    .replace(/[.,;:!?]$/, '')
    .replace(/\s+/g, ' ');
  if (EFFECT_SET.has(cleaned)) return cleaned as Effect;
  const titled = cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  if (EFFECT_SET.has(titled)) return titled as Effect;
  const alt = EFFECT_ALT.get(titled);
  if (alt) return alt;
  return null;
}

/**
 * Collect every effect name inside an "Immune to X and Y (or Z)"-style
 * clause. Splits on comma / "and" / "or" and keeps whichever tokens
 * resolve to a tracked effect. Junk tokens like "an", "a", "buff",
 * "damaging effect" are dropped.
 */
function extractImmuneClause(clauseTail: string): Effect[] {
  const cut = clauseTail.split(
    /(?=\s(?:for|while|when|during|passive|debuff|effects?|attacks?|of|by|and\s+gain|,\s*(?:it|they|he|she)))/i,
  )[0]!;
  const parts = cut.split(/\s*(?:,|\band\b|\bor\b)\s*/i);
  const out: Effect[] = [];
  for (const p of parts) {
    const eff = normaliseEffect(p);
    if (eff) out.push(eff);
  }
  return out;
}

function assignBand(
  target: Record<Effect, ImmunityBand>,
  effect: Effect,
  band: ImmunityBand,
) {
  const existing = target[effect];
  if (!existing || bandRank(band) > bandRank(existing)) {
    target[effect] = band;
  }
}

function parseKitLine(
  line: string,
  target: Record<Effect, ImmunityBand>,
): void {
  // "Immune to X" / "Immune to X and Y" / "Immunity to X, Y, and Z"
  {
    const re = /\bImmun(?:e|ity) to ([^.]*?)(?=[.,](?:\s|$)|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      for (const eff of extractImmuneClause(m[1]!)) {
        assignBand(target, eff, { band: 'immune' });
      }
    }
  }
  // "X Immunity" — but not "Gain Immunity" / "Buff Immunity"-junk.
  // normaliseEffect vets the token, so junk falls through silently.
  {
    const re = /\b([A-Z][A-Za-z]+(?:\s[A-Z][a-z]+)?)\s+Immunity\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const eff = normaliseEffect(m[1]!);
      if (eff) assignBand(target, eff, { band: 'immune' });
    }
  }
  // "N% X Resistance" — reject negative signs (that's a debuff to
  // the champion's resistance, not gained resistance).
  {
    const re = /(?<!-)(\d+(?:\.\d+)?)%\s+([A-Za-z][A-Za-z ]*?)\s+Resistance\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const eff = normaliseEffect(m[2]!);
      if (!eff) continue;
      const pct = Math.round(parseFloat(m[1]!));
      assignBand(target, eff, { band: 'resist', qual: `${pct}%` });
    }
  }
  // "takes -N% damage from X, Y, Z" / "takes N% less damage from ..."
  //
  // MCOC's stat-display convention uses "-N%" to mean "reduce by N%",
  // even though mathematically "reduce by -N%" reads as an increase.
  // So we take |N| as the resistance amount. Silver Surfer's
  // "takes --100.0% damage from Coldsnap" is the canonical case.
  //
  // The captured tail runs until a full-stop or a category noun
  // (debuffs/effects/etc.) but NOT a comma, since commas are the
  // internal separator between listed effects.
  {
    const re =
      /takes\s+(-{0,2}\d+(?:\.\d+)?)%\s+(?:less\s+)?damage from ([^.,]*?(?:,\s*(?:and\s+)?[^.,]*)*?)(?=\.\s*|\s+debuffs?\b|\s+effects?\b|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const pct = parseSignedPercent(m[1]!);
      if (pct === null) continue;
      const effects = extractImmuneClause(m[2]!);
      for (const eff of effects) {
        assignBand(target, eff, { band: 'resist', qual: `${pct}%` });
      }
    }
  }
  // "Incoming X, Y, Z potency is reduced by N%" or "reduced by -N%".
  // Same negative-means-positive convention as above; take absolute
  // value. Onslaught: "Incoming Bleed, Incinerate, and Shock potency
  // is reduced by -150.0%" → 150% resist on all three.
  {
    const re =
      /Incoming ([^.]*?)\s+potency\s+(?:is|are)\s+reduced\s+by\s+(-{0,2}\d+(?:\.\d+)?)%/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const pct = parseSignedPercent(m[2]!);
      if (pct === null) continue;
      const effects = extractImmuneClause(m[1]!);
      for (const eff of effects) {
        assignBand(target, eff, { band: 'resist', qual: `${pct}%` });
      }
    }
  }
  // "N% Resistance against|to X" — inverse word order from "X
  // Resistance". Bastion: "100% Resistance against Bleed and Poison
  // effects". Also handles the multi-effect list.
  {
    const re =
      /(?<!-)(\d+(?:\.\d+)?)%\s+Resistance\s+(?:against|to)\s+([^.,]*?(?:,\s*(?:and\s+)?[^.,]*)*?)(?=\.\s*|\s+effects?\b|\s+debuffs?\b|,\s*(?!and\s)|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const pct = parseSignedPercent(m[1]!);
      if (pct === null) continue;
      const effects = extractImmuneClause(m[2]!);
      for (const eff of effects) {
        assignBand(target, eff, { band: 'resist', qual: `${pct}%` });
      }
    }
  }
  // Verb-form immunity: "cannot be Bled" → Bleed immune.
  {
    const map: Record<string, Effect> = {
      Bled: 'Bleed',
      Poisoned: 'Poison',
      Stunned: 'Stun',
      Shocked: 'Shock',
      Staggered: 'Stagger',
      Incinerated: 'Incinerate',
    };
    const re = /cannot be (Bled|Poisoned|Stunned|Shocked|Staggered|Incinerated)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const eff = map[m[1]!];
      if (eff) assignBand(target, eff, { band: 'immune' });
    }
  }
}

/**
 * Parse a numeric percentage that may carry one or two leading minus
 * signs (MCOC's game text emits both). Returns the absolute integer
 * value, or null if the digits don't parse.
 */
function parseSignedPercent(raw: string): number | null {
  const cleaned = raw.replace(/^-+/, '');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n));
}

// ─── Main ──────────────────────────────────────────────────────────────

type AbilitiesFile = {
  champions: Record<
    string,
    {
      kit: {
        signature: { lines: string[] } | null;
        cards: Array<{ lines: string[] }>;
      };
    }
  >;
};

function main() {
  const abilities = JSON.parse(readFileSync(ABILITIES_PATH, 'utf8')) as AbilitiesFile;
  const out: Record<string, Record<Effect, ImmunityBand>> = {};
  let champsWithSignals = 0;
  let totalSignals = 0;

  for (const [seedId, entry] of Object.entries(abilities.champions)) {
    const perEffect = {} as Record<Effect, ImmunityBand>;
    const lines: string[] = [];
    if (entry.kit.signature) lines.push(...entry.kit.signature.lines);
    for (const c of entry.kit.cards) lines.push(...c.lines);
    for (const l of lines) parseKitLine(l, perEffect);
    const keys = Object.keys(perEffect);
    if (keys.length > 0) {
      out[seedId] = perEffect;
      champsWithSignals++;
      totalSignals += keys.length;
    }
  }

  const payload = {
    _meta: {
      note:
        'Auto-parsed from champion kit text in data/champions/abilities.json. ' +
        'Covers the immune band (from "Immune to X" / "X Immunity" declarations) ' +
        'and the resist band (from "N% X Resistance" declarations, N > 0). ' +
        'The mechanic Purify/Duration band and the synergy band come from other ' +
        'sources (fixture + pill backfill respectively). ' +
        'Loader precedence: pill backfill < this file < hand-curated fixture.',
      source: 'MCOCHUB champion kit text (via abilities.json)',
      generatedAt: new Date().toISOString().slice(0, 10),
      championCount: champsWithSignals,
      signalCount: totalSignals,
    },
    champions: out,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `Parsed ${champsWithSignals} champion(s), ${totalSignals} effect signal(s) → ${OUTPUT_PATH}`,
  );
}

main();
