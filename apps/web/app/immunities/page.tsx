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
      <div className="border border-[var(--color-marvel-editorial)]/40 bg-[var(--color-marvel-editorial)]/5 rounded-md px-4 py-3 text-sm">
        <strong className="text-[var(--color-marvel-editorial)] font-semibold">
          Preview — {dataMeta.championCount} of {champions.length} champions covered.
        </strong>{' '}
        <span className="text-[var(--color-ink-soft)]">
          Backfilled from MCOCHUB (immune + synergy bands, {dataMeta.backfillChampions ?? 0} champions)
          + hand-curated four-signal fixture ({dataMeta.fixtureChampions ?? 0} champions with resistance %
          and mechanic marks). The resist % and mechanic Purify/Duration bands are still being transcribed
          from GuiaMTC for the rest; nav entry lands once coverage is closer to full.
        </span>
      </div>
      <ImmunitiesView
        dataset={dataset}
        champions={champions}
        dataMeta={dataMeta}
      />
    </div>
  );
}
