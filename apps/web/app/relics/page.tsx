import { RelicsManager } from '../../components/relics-manager';
import { RelicReferenceCard } from '../../components/relic-reference-card';
import { RelicSubmitForm } from '../../components/relic-submit-form';
import { BattlecastCatalog } from '../../components/battlecast-catalog';
import { Collapsible } from '../../components/collapsible';

export default function RelicsPage() {
  return (
    <div className="space-y-4">
      <section>
        <h1 className="editorial-heading text-4xl mb-2">Relics</h1>
        <p className="text-lg text-[var(--color-ink-soft)] max-w-2xl">
          The other 6% of total prestige. Count what you own at each
          (rank, sig) state; the engine surfaces the highest-impact upgrades
          above your top-30 cutoff.
        </p>
      </section>

      <Collapsible
        title="Data coverage"
        summary="7★ full · 6★ partial · α values count"
      >
        <div className="text-sm space-y-2">
          <p>
            7★ Standard Statcasts and the 7★ Cosmic Egg have full BHR
            curves. 6★ Standard Statcasts have a partial scaffold (verified
            anchors in the reference card; sig 80+ and ranks R4 / R5 are α
            extrapolation). 6★ Battlecasts are catalogued from MCOCHUB&apos;s
            community ranking with one α anchor each; 6★ Cosmic Egg has one
            verified user-captured anchor.
          </p>
          <p>
            All four sources contribute to your top-30 relic prestige when
            their (rank, sig) state has data. α values count too — submit
            verified readings to flip cells from estimate to fact, or
            override locally on each row.
          </p>
          <p>
            Lower-tier relics (5★ statcasts, 3-5★ battlecasts) are out of
            scope — most paragon rosters won&apos;t have them in top-30.
          </p>
        </div>
      </Collapsible>

      {/* Inventory entry — 7★ at top, 6★ below */}
      <RelicsManager />

      {/* Reference materials below — collapsible since they're for lookup, not entry */}
      <Collapsible
        title="6★ Standard Statcast curve"
        summary="verified anchors + α extrapolation"
      >
        <RelicReferenceCard />
      </Collapsible>

      <Collapsible
        title="6★ Battlecast catalogue"
        summary="MCOCHUB rankings + verified anchors"
      >
        <BattlecastCatalog />
      </Collapsible>

      <Collapsible
        title="Submit a 6★ reading"
        summary="opt-in, anonymous"
      >
        <RelicSubmitForm />
      </Collapsible>
    </div>
  );
}
