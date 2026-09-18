import Link from 'next/link';
import { loadActiveChampions } from '../../lib/data-loader';
import { loadSeason } from '../../lib/war-planner-data';
import { WarPlannerApp } from '../../components/war-planner-alpha/war-planner-app';

export const metadata = {
  title: 'Season 69 war planner (alpha) — mcoc.help',
  description:
    'Per-BG, per-node war defence placement using the season guide. Alpha — the diversity tool continues to run at /war.',
};

export default function WarPlannerPage() {
  const champions = loadActiveChampions();
  const season = loadSeason();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-4xl mb-2 flex items-center flex-wrap gap-3">
          <span>Season {season.season} war planner</span>
          <span
            className="text-xs font-mono uppercase tracking-widest px-2 py-0.5 rounded border border-[var(--color-marvel-editorial)]/70 text-[var(--color-marvel-editorial)]"
            aria-label="Alpha release"
          >
            alpha
          </span>
        </h1>
        <p className="text-lg text-[var(--color-ink-soft)] max-w-3xl">
          Every node starts with the season guide&apos;s eight defenders. War
          officers can change any node, pin a defender where you want them, and
          the planner places the other 50 across your battlegroup, no
          duplicates, five each. Runs alongside the{' '}
          <Link href="/war/" className="underline hover:text-[var(--color-marvel-impact)]">
            diversity tool
          </Link>{' '}
          while we test it.
        </p>
      </section>

      <WarPlannerApp champions={champions} season={season} />
    </div>
  );
}
