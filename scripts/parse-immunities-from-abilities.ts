/**
 * Parse per-champion kit text (data/champions/abilities.json) into the
 * four-signal immunity dataset. Thin orchestrator around
 * @prestige-tools/engine's immunity-text-parser (which owns the regex
 * patterns + guards + tests).
 *
 * Output:
 *   data/champions/immunities-kit-derived.json
 *
 * Rerun after abilities.json refresh:
 *   pnpm parse-immunity-kits
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseImmunitiesFromLines } from '../packages/engine/src/immunity-text-parser.js';

const ABILITIES_PATH = 'data/champions/abilities.json';
const OUTPUT_PATH = 'data/champions/immunities-kit-derived.json';

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
  const out: Record<string, Record<string, unknown>> = {};
  let champsWithSignals = 0;
  let totalSignals = 0;

  for (const [seedId, entry] of Object.entries(abilities.champions)) {
    const lines: string[] = [];
    if (entry.kit.signature) lines.push(...entry.kit.signature.lines);
    for (const c of entry.kit.cards) lines.push(...c.lines);
    const perEffect = parseImmunitiesFromLines(lines);
    const keys = Object.keys(perEffect);
    if (keys.length > 0) {
      out[seedId] = perEffect as Record<string, unknown>;
      champsWithSignals++;
      totalSignals += keys.length;
    }
  }

  const payload = {
    _meta: {
      note:
        'Auto-parsed from champion kit text in data/champions/abilities.json via ' +
        '@prestige-tools/engine parseImmunitiesFromLines(). Covers the immune band ' +
        '(from "Immune to X" / "X Immunity" declarations, guarded against negation + ' +
        'inflict false-positives) and the resist band (from "N% X Resistance" and ' +
        '"takes N% damage from" declarations). The mechanic Purify/Duration band and ' +
        'the synergy band come from other sources.',
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
