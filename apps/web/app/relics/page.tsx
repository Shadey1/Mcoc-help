import { RelicsManager } from '../../components/relics-manager';
import { RelicReferenceCard } from '../../components/relic-reference-card';
import { RelicSubmitForm } from '../../components/relic-submit-form';
import { BattlecastCatalog } from '../../components/battlecast-catalog';

export default function RelicsPage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="editorial-heading text-4xl mb-2">Relics</h1>
        <p className="text-lg text-[var(--color-ink-soft)] max-w-2xl">
          The other 6% of total prestige. Count what you own at each
          (rank, sig) state; the engine surfaces the highest-impact upgrades
          above your top-30 cutoff.
        </p>
      </section>

      <section className="border-2 border-[var(--color-marvel-impact)] rounded-lg bg-[var(--color-paper-soft)] p-5 flex flex-col sm:flex-row gap-4 items-start">
        <span className="text-sm font-mono uppercase tracking-widest px-2.5 py-1 rounded bg-[var(--color-marvel-impact)] text-[var(--color-paper)] whitespace-nowrap">
          Alpha
        </span>
        <div className="text-sm space-y-2">
          <p>
            <strong>7★ Standard Statcasts</strong> and the <strong>7★
            Cosmic Egg</strong> have full BHR curves in the relic engine
            — they contribute to your top-30 prestige below.
          </p>
          <p>
            <strong>6★ Standard Statcasts:</strong> partial scaffold —
            verified anchors in the reference card below; sig 80+ and
            ranks R4 / R5 entirely are best-guess extrapolation. 6★ counts
            don&apos;t yet feed top-30 prestige.
          </p>
          <p>
            <strong>6★ Battlecasts:</strong> catalogue scaffolded from
            MCOCHUB&apos;s community ranking — each relic has one α anchor
            (state unconfirmed). 6★ Cosmic Egg also has one verified
            user-captured anchor. Submit your readings via the form below;
            verified data flips α cells over time.
          </p>
          <p>
            Lower-tier relics (5★ statcasts, 3-5★ battlecasts) are out of
            scope for now — most paragon rosters won&apos;t have them in
            top-30.
          </p>
        </div>
      </section>

      <RelicReferenceCard />

      <BattlecastCatalog />

      <RelicSubmitForm />

      <RelicsManager />
    </div>
  );
}
