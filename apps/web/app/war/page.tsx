import { loadActiveChampions } from '../../lib/data-loader';
import { WarPlanner } from '../../components/war-planner';
import { WarSubnav } from '../../components/war-subnav';

export default function WarPage() {
  const champions = loadActiveChampions();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-4xl mb-1">War · Diversity</h1>
        <p className="text-[var(--color-ink-soft)] max-w-2xl">
          Tick who counts as a war defender. Rank-weighted, no duplicates.
          Rosters from the BG rosters tab.
        </p>
      </section>
      <WarSubnav active="diversity" />

      <section className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-5 text-sm space-y-2">
        <p>
          Fills as many slots as it can, then hands each champion to whoever&apos;s
          got the best copy (rank → ascension → sig). Strong tier goes first,
          then Mid, then Base. Every champion places once.
        </p>
        <p>
          Someone short of 5? Their roster overlaps too much with everyone
          else&apos;s. Widen the pool or drop the floor and try again.
        </p>
      </section>

      <WarPlanner champions={champions} />
    </div>
  );
}
