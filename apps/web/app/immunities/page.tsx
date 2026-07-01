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
      <div className="border border-[var(--color-marvel-editorial)]/40 bg-[var(--color-marvel-editorial)]/5 rounded-md px-4 py-3 text-sm space-y-2">
        <div>
          <strong className="text-[var(--color-marvel-editorial)] font-semibold">
            Preview — {dataMeta.championCount} of {champions.length} champions covered.
          </strong>{' '}
          <span className="text-[var(--color-ink-soft)]">
            The provisional shape merges MCOCHUB pills ({dataMeta.backfillChampions ?? 0}),
            parsed kit text ({dataMeta.kitChampions ?? 0}), and the hand-curated
            fixture ({dataMeta.fixtureChampions ?? 0}). Everything renders below;
            the reconciliation pipeline additionally tracks which cells cross
            the consensus bar.
          </span>
        </div>
        <div className="text-xs text-[var(--color-ink-soft)] pt-1 border-t border-[var(--color-marvel-editorial)]/20">
          <span className="font-mono uppercase tracking-wide text-[10px] text-[var(--color-marvel-editorial)] mr-2">
            Reconciliation
          </span>
          <strong className="text-[var(--color-ink)]">
            {dataMeta.reconciliation.cellsLocked}
          </strong>{' '}
          locked cells across {dataMeta.reconciliation.uniqueChampsLocked} champions
          {dataMeta.reconciliation.conflicts > 0 && (
            <>
              {' · '}
              <strong className="text-[var(--color-marvel-editorial)]">
                {dataMeta.reconciliation.conflicts}
              </strong>{' '}
              conflicts flagged
            </>
          )}
          {' · '}
          {dataMeta.reconciliation.singleSource} single-source in review queue
          {dataMeta.reconciliation.staleOnly > 0 &&
            ` · ${dataMeta.reconciliation.staleOnly} stale-only`}
          . Locks ship after a second independent source agrees; today
          most cells are still MCOCHUB-only.
        </div>
      </div>
      <ImmunitiesView
        dataset={dataset}
        champions={champions}
        dataMeta={dataMeta}
      />
    </div>
  );
}
