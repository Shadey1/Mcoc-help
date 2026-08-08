import { loadAllChampions } from '../../lib/data-loader';
import { loadAbilitiesFor } from '../../lib/abilities-loader';
import { ChampionsBrowser } from '../../components/champions-browser';

/**
 * MCOCHUB lists the abilities-panel pills that call out a champion's hit
 * type ("Physical Damage" / "Energy Damage") separately from the tag
 * panel. For the /champions filter UI a tag is the right shape though —
 * "show me every Energy Damage champ so I can spec against a Physical
 * Resistance node" is the same query as "show me every X-Men champ".
 * Promote them into synthetic tags at build time so they appear in the
 * same picker. Coverage is partial: Kabam only sets these pills when the
 * damage type is a notable feature of the kit, so a champion without
 * either pill isn't guaranteed to deal neither — it just isn't called
 * out. Best signal MCOCHUB provides.
 */
const PROMOTED_ABILITY_PILLS: ReadonlyArray<string> = [
  'Physical Damage',
  'Energy Damage',
];

export default function ChampionsPage() {
  const champions = loadAllChampions();

  // Bake the tag lookup at build time so the client doesn't pull
  // abilities.json. Empty list for champs we haven't imported (partner-only
  // stubs, anything pre-7-star).
  const championTags: Record<string, string[]> = {};
  for (const c of champions) {
    const a = loadAbilitiesFor(c.id);
    if (!a) continue;
    const promoted = a.pills.abilities
      .filter((p) => !p.synergy && PROMOTED_ABILITY_PILLS.includes(p.name))
      .map((p) => p.name);
    const merged = [...a.pills.tags, ...promoted];
    if (merged.length > 0) championTags[c.id] = merged;
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-3xl mb-2">Champions</h1>
        <p className="text-[var(--color-ink-soft)]">
          {champions.length} 7-star champions. Filter by class, ascension
          status, or tag — tags come from MCOCHUB and cover content categories
          (AW: Decay, AQ: Ramp), kit shape (Offensive: Burst), faction
          (Symbiote, X-Men), and hit type (Physical Damage, Energy Damage).
        </p>
      </section>

      <ChampionsBrowser champions={champions} championTags={championTags} />
    </div>
  );
}
