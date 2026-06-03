import { RelicsManager } from '../../components/relics-manager';

export default function RelicsPage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="editorial-heading text-4xl mb-2">Relics</h1>
        <p className="text-lg text-[var(--color-ink-soft)] max-w-2xl">
          The other 6% of total prestige. Count what you own at each
          (rank, level) state; the engine surfaces the highest-impact upgrades
          above your top-30 cutoff.
        </p>
      </section>

      <section className="border-2 border-[var(--color-marvel-impact)] rounded-lg bg-[var(--color-paper-soft)] p-5 flex flex-col sm:flex-row gap-4 items-start">
        <span className="text-sm font-mono uppercase tracking-widest px-2.5 py-1 rounded bg-[var(--color-marvel-impact)] text-[var(--color-paper)] whitespace-nowrap">
          Alpha
        </span>
        <div className="text-sm space-y-2">
          <p>
            Relic coverage is partial. So far only <strong>7-star Standard
            Statcasts</strong> and the <strong>Cosmic Egg</strong> have full
            BHR curves in the engine; everything else returns no contribution
            to the prestige math.
          </p>
          <p>
            6-star relics are still in play for top-30 prestige but their data
            isn&apos;t loaded yet — until that lands, counts you enter for
            them won&apos;t move the headline number. Working on it.
          </p>
        </div>
      </section>

      <RelicsManager />
    </div>
  );
}
