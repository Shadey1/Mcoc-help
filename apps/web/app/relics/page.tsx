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

      <section className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-5 text-sm space-y-2">
        <p>
          <strong>Data coverage</strong> — 7★ Standard Statcasts and the
          7★ Cosmic Egg have full BHR curves. 6★ Standard Statcasts have a
          partial scaffold (verified anchors in the reference card below;
          sig 80+ and ranks R4 / R5 are α extrapolation). 6★ Battlecasts
          are catalogued from MCOCHUB&apos;s community ranking with one α
          anchor each; 6★ Cosmic Egg has one verified user-captured anchor.
        </p>
        <p>
          All four sources contribute to your top-30 relic prestige below
          when their (rank, sig) state has data. α values count too —
          submit verified readings via the form below to flip cells from
          estimate to fact.
        </p>
        <p>
          Lower-tier relics (5★ statcasts, 3-5★ battlecasts) are out of
          scope — most paragon rosters won&apos;t have them in top-30.
        </p>
      </section>

      <RelicReferenceCard />

      <BattlecastCatalog />

      <RelicSubmitForm />

      <RelicsManager />
    </div>
  );
}
