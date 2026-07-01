/**
 * Parse plain ability-text lines (as produced by scripts/refresh-abilities-from-mcochub.ts
 * and stored in data/champions/abilities.json) into per-champion immune +
 * resist marks.
 *
 * The parser is deliberately conservative: false positives feed a war-planner
 * that ships players into unwinnable fights, so every candidate immunity
 * match runs through two guards before it lands:
 *
 *   - NEGATION guard: rejects the match if the enclosing sentence carries
 *     modifiers that flip the meaning ("no longer immune to X",
 *     "cannot gain X immunity", "except", "unless", "prevented due to
 *     Immunity", etc.).
 *   - INFLICT guard: rejects the match if the champion is the subject of
 *     an inflicting verb (inflicts/places/applies/triggers/causes/deals)
 *     for that same effect — that's what the champion DOES to opponents,
 *     not what protects them.
 *
 * Purify / Duration mechanics and synergy-granted marks come from other
 * sources (chart transcription, MCOCHUB pill tags respectively). This
 * module handles only the two bands the ability text can express with
 * enough confidence to auto-lock: immune and resist %.
 */

import type { EffectName, ImmunityBand } from './immunities.js';
import { IMMUNITY_EFFECTS } from './immunities.js';

// Only the two bands the ability-text parser can emit. The full band union
// (which also carries `mechanic` and `synergy`) lives in immunities.ts; we
// narrow here so callers can't accidentally construct unsupported shapes.
export type ParsedBand = Extract<ImmunityBand, { band: 'immune' | 'resist' }>;

/** Champion → per-effect band, as produced by parseImmunitiesFromLines. */
export type ParsedChampionImmunities = Partial<Record<EffectName, ParsedBand>>;

// ─── Effect vocabulary + normalisation ─────────────────────────────────

const EFFECT_SET = new Set<string>(IMMUNITY_EFFECTS);
const EFFECT_ALT = new Map<string, EffectName>([
  ['Armour Break', 'Armor Break'],
]);

/**
 * Canonicalise a raw effect token from the parser tail. Strips leading
 * determiners ("all", "an", "any"), trailing category nouns
 * ("effects", "debuffs", "passives"), and light punctuation. Case is
 * fuzzed via title-case fallback. Returns null when the token doesn't
 * match a tracked effect.
 */
export function normaliseEffect(raw: string): EffectName | null {
  const cleaned = raw
    .trim()
    .replace(/^(a|an|the|any|all|each|every|some|one|two|three)\s+/i, '')
    .replace(/\s+(effects?|debuffs?|buffs?|passives?)\s*$/i, '')
    .replace(/[.,;:!?]$/, '')
    .replace(/\s+/g, ' ');
  if (EFFECT_SET.has(cleaned)) return cleaned as EffectName;
  const titled = cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  if (EFFECT_SET.has(titled)) return titled as EffectName;
  return EFFECT_ALT.get(titled) ?? null;
}

/**
 * Split an "Immune to X and Y, or Z" tail into effect tokens. Splits on
 * `,`, `and`, `or`; drops junk that doesn't resolve to a tracked effect
 * (articles, adjectives, "damaging" etc.). Also stops at continuation
 * clauses that don't belong to the immunity list ("for X seconds",
 * "while ...", etc.).
 */
export function extractImmuneClause(clauseTail: string): EffectName[] {
  const cut = clauseTail.split(
    /(?=\s(?:for|while|when|during|passive|debuff|effects?|attacks?|of|by|and\s+gain|,\s*(?:it|they|he|she)))/i,
  )[0]!;
  const parts = cut.split(/\s*(?:,|\band\b|\bor\b)\s*/i);
  const out: EffectName[] = [];
  for (const p of parts) {
    const eff = normaliseEffect(p);
    if (eff) out.push(eff);
  }
  return out;
}

// ─── Band assignment ───────────────────────────────────────────────────

function bandRank(b: ParsedBand): number {
  if (b.band === 'immune') return 100;
  const n = parseInt(b.qual, 10);
  return Number.isFinite(n) ? Math.min(n, 99) : 0;
}

function assignBand(
  target: ParsedChampionImmunities,
  effect: EffectName,
  band: ParsedBand,
): void {
  const existing = target[effect];
  if (!existing || bandRank(band) > bandRank(existing)) {
    target[effect] = band;
  }
}

/**
 * Parse a percent qualifier that may carry one or two leading minus
 * signs (MCOC's game text emits both). Returns the absolute integer
 * value, or null if the digits don't parse. "--100.0" and "100" both
 * return 100.
 */
export function parseSignedPercent(raw: string): number | null {
  const cleaned = raw.replace(/^-+/, '');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n));
}

// ─── Guards ────────────────────────────────────────────────────────────

/**
 * Return the enclosing sentence around `matchIndex`. Splits on
 * `.`, `?`, `!`, and `;`. Falls back to the whole line if no
 * terminator is present.
 */
export function enclosingSentence(line: string, matchIndex: number): string {
  const before = line.slice(0, matchIndex);
  const after = line.slice(matchIndex);
  const startIdx = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('? '),
    before.lastIndexOf('! '),
    before.lastIndexOf('; '),
  );
  const start = startIdx === -1 ? 0 : startIdx + 2;
  const endRel = after.search(/[.?!;](?:\s|$)/);
  const end = endRel === -1 ? line.length : matchIndex + endRel + 1;
  return line.slice(start, end);
}

/** Patterns that indicate the match is negated, conditional, or actually about the opponent. */
export const NEGATION_PATTERNS: RegExp[] = [
  /\bno longer\b/i,
  /\bnot immune\b/i,
  /\bloses?\b/i,
  /\bcannot gain\b/i,
  /\bdoes not gain\b/i,
  /\b(?:unless|except when|except if|except during)\b/i,
  /\bremoves?\s+.*immun/i,
  /\bopponent(?:'s|\s+is|\s+becomes|\s+has)/i,
  /\bif\s+.*\s+is\s+immune\b/i,
  // "prevented ... due to X or Immunity" — anything between "due to"
  // and "immunity" is fine; we only need the phrase together in one
  // sentence for the guard to fire.
  /\b(?:prevented|fails?|failed|blocked)\s+.*due to\b.*\bimmunity\b/i,
  /\bfails?\s+to\s+apply\s+due to\b/i,
];

/** Verbs whose object-effect indicates the champion INFLICTS that effect (not resists it). */
const INFLICT_VERBS = [
  'inflict',
  'inflicts',
  'inflicted',
  'inflicting',
  'place',
  'places',
  'placed',
  'placing',
  'apply',
  'applies',
  'applied',
  'applying',
  'trigger',
  'triggers',
  'triggered',
  'triggering',
  'cause',
  'causes',
  'caused',
  'causing',
  'deal',
  'deals',
  'dealt',
  'dealing',
];

export function inflictGuardFires(sentence: string, effect: EffectName): boolean {
  const effEscaped = effect.replace(/\s+/g, '\\s+');
  const re = new RegExp(
    `\\b(?:${INFLICT_VERBS.join('|')})\\b\\s+(?:a\\s+|an\\s+|the\\s+)?[A-Za-z ]{0,40}?\\b${effEscaped}\\b`,
    'i',
  );
  return re.test(sentence);
}

/** True if the candidate match survives both guards. */
export function guardsPass(
  line: string,
  matchIndex: number,
  effect: EffectName,
): boolean {
  const sentence = enclosingSentence(line, matchIndex);
  for (const p of NEGATION_PATTERNS) {
    if (p.test(sentence)) return false;
  }
  if (inflictGuardFires(sentence, effect)) return false;
  return true;
}

// ─── The parser ────────────────────────────────────────────────────────

/**
 * Walk a single ability-text line, run every immunity/resistance
 * pattern, and assign surviving marks to `target`. Marks are only
 * written when both guards pass.
 */
export function parseKitLine(
  line: string,
  target: ParsedChampionImmunities,
): void {
  // "Immune to X" / "Immune to X and Y" / "Immunity to X, Y, and Z"
  {
    const re = /\bImmun(?:e|ity) to ([^.]*?)(?=[.,](?:\s|$)|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      for (const eff of extractImmuneClause(m[1]!)) {
        if (!guardsPass(line, m.index, eff)) continue;
        assignBand(target, eff, { band: 'immune' });
      }
    }
  }
  // "X Immunity" — normaliseEffect vets junk.
  {
    const re = /\b([A-Z][A-Za-z]+(?:\s[A-Z][a-z]+)?)\s+Immunity\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const eff = normaliseEffect(m[1]!);
      if (!eff) continue;
      if (!guardsPass(line, m.index, eff)) continue;
      assignBand(target, eff, { band: 'immune' });
    }
  }
  // "N% X Resistance" (positive N only).
  {
    const re = /(?<!-)(\d+(?:\.\d+)?)%\s+([A-Za-z][A-Za-z ]*?)\s+Resistance\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const eff = normaliseEffect(m[2]!);
      if (!eff) continue;
      if (!guardsPass(line, m.index, eff)) continue;
      const pct = Math.round(parseFloat(m[1]!));
      assignBand(target, eff, { band: 'resist', qual: `${pct}%` });
    }
  }
  // "takes -N% damage from X, Y, Z" — MCOC's stat convention treats -N%
  // as "reduce by N%". Take |N|.
  {
    const re =
      /takes\s+(-{0,2}\d+(?:\.\d+)?)%\s+(?:less\s+)?damage from ([^.,]*?(?:,\s*(?:and\s+)?[^.,]*)*?)(?=\.\s*|\s+debuffs?\b|\s+effects?\b|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const pct = parseSignedPercent(m[1]!);
      if (pct === null) continue;
      const effects = extractImmuneClause(m[2]!);
      for (const eff of effects) {
        if (!guardsPass(line, m.index, eff)) continue;
        assignBand(target, eff, { band: 'resist', qual: `${pct}%` });
      }
    }
  }
  // "Incoming X, Y, Z potency is reduced by N%" (or -N%).
  {
    const re =
      /Incoming ([^.]*?)\s+potency\s+(?:is|are)\s+reduced\s+by\s+(-{0,2}\d+(?:\.\d+)?)%/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const pct = parseSignedPercent(m[2]!);
      if (pct === null) continue;
      const effects = extractImmuneClause(m[1]!);
      for (const eff of effects) {
        if (!guardsPass(line, m.index, eff)) continue;
        assignBand(target, eff, { band: 'resist', qual: `${pct}%` });
      }
    }
  }
  // "N% Resistance against|to X" (inverse word order).
  {
    const re =
      /(?<!-)(\d+(?:\.\d+)?)%\s+Resistance\s+(?:against|to)\s+([^.,]*?(?:,\s*(?:and\s+)?[^.,]*)*?)(?=\.\s*|\s+effects?\b|\s+debuffs?\b|,\s*(?!and\s)|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const pct = parseSignedPercent(m[1]!);
      if (pct === null) continue;
      const effects = extractImmuneClause(m[2]!);
      for (const eff of effects) {
        if (!guardsPass(line, m.index, eff)) continue;
        assignBand(target, eff, { band: 'resist', qual: `${pct}%` });
      }
    }
  }
  // Verb form: "cannot be Bled" → Bleed immune.
  {
    const map: Record<string, EffectName> = {
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
      if (!eff) continue;
      if (!guardsPass(line, m.index, eff)) continue;
      assignBand(target, eff, { band: 'immune' });
    }
  }
}

/** Public entry: run every kit line for one champion, return their per-effect band map. */
export function parseImmunitiesFromLines(
  lines: readonly string[],
): ParsedChampionImmunities {
  const out: ParsedChampionImmunities = {};
  for (const line of lines) parseKitLine(line, out);
  return out;
}
