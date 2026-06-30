import { loadAllChampions } from '../../lib/data-loader';
import { loadAbilitiesFor } from '../../lib/abilities-loader';
import { ChampionsBrowser } from '../../components/champions-browser';

export default function ChampionsPage() {
  const champions = loadAllChampions();

  // Bake the tag lookup at build time so the client doesn't pull
  // abilities.json. Empty list for champs we haven't imported (partner-only
  // stubs, anything pre-7-star).
  const championTags: Record<string, string[]> = {};
  for (const c of champions) {
    const a = loadAbilitiesFor(c.id);
    if (a && a.pills.tags.length > 0) championTags[c.id] = a.pills.tags;
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-3xl mb-2">Champions</h1>
        <p className="text-[var(--color-ink-soft)]">
          {champions.length} 7-star champions. Filter by class, ascension
          status, or tag — tags come from MCOCHUB and cover content categories
          (AW: Decay, AQ: Ramp), kit shape (Offensive: Burst), and faction
          (Symbiote, X-Men).
        </p>
      </section>

      <ChampionsBrowser champions={champions} championTags={championTags} />
    </div>
  );
}
