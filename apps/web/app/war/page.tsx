import { loadActiveChampions } from '../../lib/data-loader';
import { WarPlanner } from '../../components/war-planner';

export default function WarPage() {
  const champions = loadActiveChampions();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="editorial-heading text-4xl mb-2">War defence placement</h1>
        <p className="text-lg text-[var(--color-ink-soft)] max-w-2xl">
          Tick the champions your alliance considers war-worthy defenders. Paste
          in share links from your 10 BG members. The planner tells everyone
          who places what — rank-weighted, no duplicates.
        </p>
      </section>

      <section className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-5 text-sm space-y-2">
        <p>
          The planner picks placements scarcity-first — rare champs first so
          they don&apos;t lose slots to common metas — then by rank →
          ascension → sig. Each champion is placed exactly once across the
          alliance.
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
