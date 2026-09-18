import { loadActiveChampions } from '../../lib/data-loader';
import { loadSeason } from '../../lib/war-planner-data';
import { WarPlannerApp } from '../../components/war-planner-alpha/war-planner-app';
import { WarSubnav } from '../../components/war-subnav';

export const metadata = {
  title: 'War · Planner (alpha) — mcoc.help',
  description:
    'Per-BG, per-node war defence placement using the season guide. Alpha.',
};

export default function WarPlannerPage() {
  const champions = loadActiveChampions();
  const season = loadSeason();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-4xl mb-1 flex items-center flex-wrap gap-3">
          <span>War · Planner</span>
          <span
            className="text-xs font-mono uppercase tracking-widest px-2 py-0.5 rounded border border-[var(--color-marvel-editorial)]/70 text-[var(--color-marvel-editorial)]"
            aria-label="Alpha release"
          >
            alpha
          </span>
        </h1>
        <p className="text-[var(--color-ink-soft)] max-w-3xl">
          Reorder picks, pin defenders where you want them, hit Place.
          Everyone gets 5, no duplicates. Champions from the BG rosters tab.
        </p>
      </section>
      <WarSubnav active="planner" />

      <WarPlannerApp champions={champions} season={season} />
    </div>
  );
}
