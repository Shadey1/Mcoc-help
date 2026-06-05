import { RelicsManager } from '../../components/relics-manager';
import { RelicReferenceCard } from '../../components/relic-reference-card';
import { RelicSubmitForm } from '../../components/relic-submit-form';

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
            <strong>7★ Standard Statcasts</strong> and the{' '}
            <strong>Cosmic Egg</strong> have full BHR curves in the relic
            engine — they contribute to your top-30 prestige below.
          </p>
          <p>
            <strong>6★ Standard Statcasts:</strong> a partial scaffold is
            now landed — the verified anchors are shown in the reference
            card below. The values are correct where labeled, but L80+ at
            every rank and ranks R4 / R5 entirely are best-guess
            extrapolation. 6★ counts in the inventory don&apos;t yet
            contribute to top-30 prestige — when more readings come in and
            R4 / R5 anchors land, that gets wired up.
          </p>
          <p>
            If you can read a 6★ Standard Statcast rating off the in-game
            card, please submit it via the form below. Anonymous, opt-in,
            takes 10 seconds.
          </p>
        </div>
      </section>

      <RelicReferenceCard />

      <RelicSubmitForm />

      <RelicsManager />
    </div>
  );
}
