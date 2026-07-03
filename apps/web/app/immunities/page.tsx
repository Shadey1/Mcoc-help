import { loadAllChampions } from '../../lib/data-loader';
import { immunitiesMeta, loadImmunityDataset } from '../../lib/immunities-loader';
import { ImmunitiesView } from '../../components/immunities-view';

export default function ImmunitiesPage() {
  const champions = loadAllChampions();
  const dataset = loadImmunityDataset();
  const dataMeta = immunitiesMeta();

  return (
    <div className="space-y-4 max-w-4xl">
      <section>
        <div className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-ink-soft)] mb-2">
          Roster reference · who can take the fight
        </div>
        <h1 className="editorial-heading text-4xl mb-2">Immunities</h1>
        <p className="text-[var(--color-ink-soft)] max-w-2xl">
          Name the damage a path or defender throws at you. See who on your
          roster shrugs it off — fully immune, resistant, purifying, or immune
          with a synergy partner — and can just take the fight.
        </p>
      </section>
      <div className="border border-[var(--color-rule)] bg-[var(--color-paper-card)] rounded-md px-4 py-3 text-xs text-[var(--color-ink-soft)]">
        <strong className="text-[var(--color-ink)]">
          {dataMeta.reconciliation.uniqueChampsLocked} of {champions.length} champions
        </strong>{' '}
        have shipping-quality immunity data (
        <strong className="text-[var(--color-ink)]">
          {dataMeta.reconciliation.cellsLocked}
        </strong>{' '}
        cells verified across 2+ independent sources: MCOCHUB, auntm.ai, Kabam
        spotlights, GuiaMTC chart, and hand-curated fixture).
        {dataMeta.reconciliation.conflicts > 0 && (
          <>
            {' '}
            {dataMeta.reconciliation.conflicts} conflicts pending in-game
            verification;
          </>
        )}{' '}
        remainder of the roster is either genuinely without tracked immunities or
        still awaiting independent corroboration. Cells marked ★ carry caveats
        beyond the four-signal model — hover the star for the specific mechanic.
      </div>
      <ImmunitiesView
        dataset={dataset}
        champions={champions}
        dataMeta={dataMeta}
      />
    </div>
  );
}
