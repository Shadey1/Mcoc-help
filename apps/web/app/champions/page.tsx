import { loadAllChampions } from '../../lib/data-loader';
import { ChampionsBrowser } from '../../components/champions-browser';

export default function ChampionsPage() {
  const champions = loadAllChampions();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-3xl mb-2">Champions</h1>
        <p className="text-[var(--color-ink-soft)]">
          {champions.length} 7-star champions. Filter by class or ascension
          status. Portraits load from the Fandom wiki where available — class
          icons stand in otherwise.
        </p>
      </section>

      <ChampionsBrowser champions={champions} />
    </div>
  );
}
