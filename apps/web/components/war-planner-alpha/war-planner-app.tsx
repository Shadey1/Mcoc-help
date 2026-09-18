'use client';

import type { Champion } from '@prestige-tools/engine';
import type { Season } from '../../../../data/aw/season-69.schema';

type WarPlannerAppProps = {
  champions: Champion[];
  season: Season;
};

/**
 * Season war planner root. Skeleton — the map, node panel, placement
 * tab and battlegroup tab are wired in the next slice. This shell
 * exists so the route builds and the nav rename can ship.
 */
export function WarPlannerApp({ champions, season }: WarPlannerAppProps) {
  return (
    <section className="space-y-4">
      <div className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-5 text-sm">
        <p className="font-medium mb-1">Coming online this session</p>
        <p className="text-[var(--color-ink-soft)]">
          The map, node picks, pinning, placement tab and PNG exports land in
          the next commit. Season file loaded with {season.nodes.length} nodes;{' '}
          {champions.length} champions available in the pool.
        </p>
      </div>
    </section>
  );
}
