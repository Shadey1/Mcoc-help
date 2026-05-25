import { RelicsManager } from '../../components/relics-manager';

export default function RelicsPage() {
  return (
    <div className="space-y-12">
      <section>
        <h1 className="editorial-heading text-4xl mb-2">Relics</h1>
        <p className="text-lg text-[var(--color-ink-soft)] max-w-2xl">
          The other 6% of total prestige. Count what you own at each
          (rank, level) state; the engine surfaces the highest-impact upgrades
          above your top-30 cutoff.
        </p>
      </section>

      <RelicsManager />
    </div>
  );
}
