/**
 * audit-immunity-fixture-vs-abilities.ts
 *
 * Cross-checks every locked immunity in `data/immunities/_locks.json`
 * against the champion's ability text in `data/champions/abilities.json`
 * (plus auntm.ai passives). Flags cells whose effect name never appears
 * in the ability corpus — likely false-positives that snuck through the
 * fixture or a mis-parse from one of the historical sources.
 *
 * Motivation: user reported Onslaught (Poison resist 80%), Iron Man
 * (Poison immune) and Nova (Bleed + Poison immune) all rendering in
 * /immunities despite the champions' own ability pages having nothing to
 * say about those effects. This audit catches other cells with the same
 * shape.
 *
 * Output: markdown table on stdout, one row per suspect cell, ranked by
 * confidence tier so lock-3src false positives (unlikely but scary)
 * float to the top.
 *
 * NOT a fixture editor — this only surfaces suspects. A human still has
 * to eyeball the abilities page and decide whether to prune the fixture.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Band =
  | { band: 'immune' }
  | { band: 'resist'; value?: number }
  | { band: 'mechanic'; qual: string }
  | { band: 'synergy'; partner?: string };

type LockCell = Band & {
  confidence: 'lock-3src' | 'lock-2src';
  _review?: boolean;
};

type LocksFile = {
  _meta: unknown;
  champions: Record<string, Record<string, LockCell>>;
};

type AbilityPill = { name: string; synergy?: { note: string } };
type KitCard = { title: string; trigger: string; lines: string[] };
type ChampionAbilities = {
  source: { slug: string; url: string };
  pills: {
    abilities: AbilityPill[];
    immunities: AbilityPill[];
    tags: string[];
  };
  kit: {
    signature: KitCard | null;
    cards: KitCard[];
  };
};

type AbilitiesFile = {
  version: string;
  source: string;
  lastImported: string;
  champions: Record<string, ChampionAbilities>;
};

type AuntmFile = {
  passives: Record<string, string[]>;
};

const ROOT = resolve(__dirname, '..');
const locks = JSON.parse(
  readFileSync(resolve(ROOT, 'data/immunities/_locks.json'), 'utf8'),
) as LocksFile;
const abilities = JSON.parse(
  readFileSync(resolve(ROOT, 'data/champions/abilities.json'), 'utf8'),
) as AbilitiesFile;
const auntm = JSON.parse(
  readFileSync(resolve(ROOT, 'data/champions/immunities-auntm.json'), 'utf8'),
) as AuntmFile;

/**
 * Some effects have alt spellings or umbrella terms in the wild — accept
 * any of them as evidence. Keeps false-negatives down (we only want to
 * catch REAL "no evidence" cells).
 */
const EFFECT_ALIASES: Record<string, string[]> = {
  Bleed: ['bleed', 'bleeding', 'hemorrhage'],
  Poison: ['poison', 'toxic', 'venom'],
  Incinerate: ['incinerate', 'incinerat', 'burn'],
  Coldsnap: ['coldsnap', 'cold snap', 'cold-snap', 'frostbite'],
  Frostbite: ['frostbite', 'frost bite', 'frost-bite'],
  Shock: ['shock'],
  Stun: ['stun'],
  Nullify: ['nullify', 'nullif'],
  Purify: ['purify', 'purif'],
  Stagger: ['stagger'],
  Fate_Seal: ['fate seal', 'fateseal', 'fate-seal'],
  Fate: ['fate seal', 'fateseal', 'fate-seal'],
  Degeneration: ['degeneration', 'degen '],
  Armor_Break: ['armor break', 'armour break', 'armor-break', 'armourbreak', 'armor break', 'armorbreak'],
  'Armor Break': ['armor break', 'armour break', 'armor-break', 'armorbreak'],
  Neuroshock: ['neuroshock', 'neuro shock', 'neuro-shock'],
  Falter: ['falter'],
  Miss: [' miss ', 'to miss'],
  Delirium: ['delirium'],
  'Reverse Controls': ['reverse controls', 'reverse-controls', 'reversed controls'],
  Heal_Block: ['heal block', 'heal-block', 'healblock', 'heal blocked'],
  'Heal Block': ['heal block', 'heal-block', 'healblock', 'heal blocked'],
  Concussion: ['concussion'],
  Confusion: ['confusion'],
  Weakness: ['weakness'],
  Slow: ['slow'],
  Petrify: ['petrify'],
  Rupture: ['rupture'],
  Vulnerability: ['vulnerability', 'vulnerable'],
  Wither: ['wither'],
};

function aliasesFor(effect: string): string[] {
  if (EFFECT_ALIASES[effect]) return EFFECT_ALIASES[effect];
  return [effect.toLowerCase()];
}

/** Full lowercased ability corpus for a champion, or null if no data. */
function corpusFor(seedId: string): string | null {
  const ab = abilities.champions[seedId];
  const passives = auntm.passives[seedId] ?? [];
  if (!ab && passives.length === 0) return null;

  const parts: string[] = [];
  if (ab) {
    for (const p of ab.pills.abilities) {
      parts.push(p.name);
      if (p.synergy?.note) parts.push(p.synergy.note);
    }
    for (const p of ab.pills.immunities) {
      parts.push(p.name);
      if (p.synergy?.note) parts.push(p.synergy.note);
    }
    parts.push(...ab.pills.tags);
    if (ab.kit.signature) {
      parts.push(ab.kit.signature.title);
      parts.push(ab.kit.signature.trigger);
      parts.push(...ab.kit.signature.lines);
    }
    for (const card of ab.kit.cards) {
      parts.push(card.title);
      parts.push(card.trigger);
      parts.push(...card.lines);
    }
  }
  parts.push(...passives);
  return parts.join('\n').toLowerCase();
}

type Suspect = {
  seedId: string;
  effect: string;
  band: string;
  confidence: string;
  reason: string;
};

const suspects: Suspect[] = [];
const noData: Set<string> = new Set();

for (const [seedId, effects] of Object.entries(locks.champions)) {
  const corpus = corpusFor(seedId);
  if (corpus === null) {
    noData.add(seedId);
    continue;
  }
  for (const [effect, cell] of Object.entries(effects)) {
    // Skip bands where "no per-effect mention" is expected behaviour:
    //   - mechanic:Duration → global "reduce all incoming debuff duration"
    //   - mechanic:Purify   → "purify non-damaging debuffs" catchall
    //   - synergy           → evidence sits on the partner's page, not this champ's
    if (cell.band === 'mechanic') continue;
    if (cell.band === 'synergy') continue;

    const bandDesc = cell.band === 'resist'
      ? `resist ${cell.value ?? '?'}%`
      : 'immune';
    const aliases = aliasesFor(effect);
    const hit = aliases.some((a) => corpus.includes(a));
    if (!hit) {
      suspects.push({
        seedId,
        effect,
        band: bandDesc,
        confidence: cell.confidence,
        reason: `No mention of ${aliases[0]!} in abilities/passives text`,
      });
    }
  }
}

// Sort: lock-3src first (worst false positives), then lock-2src, then by champ then effect.
suspects.sort((a, b) => {
  if (a.confidence !== b.confidence) {
    return a.confidence === 'lock-3src' ? -1 : 1;
  }
  if (a.seedId !== b.seedId) return a.seedId.localeCompare(b.seedId);
  return a.effect.localeCompare(b.effect);
});

// Emit report
console.log('# Immunity fixture vs abilities — suspect cells');
console.log('');
console.log(`Total suspects: **${suspects.length}**`);
console.log(`Champions in _locks.json with no abilities data: ${noData.size}`);
console.log('');
console.log('| Champion | Effect | Band | Confidence |');
console.log('|---|---|---|---|');
for (const s of suspects) {
  console.log(`| ${s.seedId} | ${s.effect} | ${s.band} | ${s.confidence} |`);
}

if (noData.size > 0) {
  console.log('');
  console.log('## Locked but no abilities data (audit not possible):');
  for (const id of [...noData].sort()) console.log(`- ${id}`);
}
