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
          Tick your alliance&apos;s war-worthy defenders. Placement is
          rank-weighted, no duplicates. Rosters come from the BG rosters tab.
        </p>
      </section>
      <WarSubnav active="diversity" />

      <section className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-5 text-sm space-y-2">
        <p>
          The planner maximises placements first, then places each champion
          on their highest-ranked owner (rank → ascension → sig). Strong
          defenders beat Mid, which beat Base. Each champion is placed
          exactly once across the alliance.
        </p>
        <p>
          If a player ends up underfilled (fewer than 5 placements), it
          means their roster overlaps too much with the rest of the pool —
          expand the pool or lower the floor and re-run.
        </p>
      </section>

      <WarPlanner champions={champions} />
    </div>
  );
}
