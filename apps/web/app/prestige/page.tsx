import { loadActiveChampions } from '../../lib/data-loader';
import { PrestigeTable, type PrestigeRow } from '../../components/prestige-table';
import { calculateBHR } from '@prestige-tools/engine';

export const metadata = {
  title: 'Prestige table — mcoc.help',
  description:
    'Every 7-star champion\'s Base Hero Rating at R5 sig 200 across A0, A1, and A2. Sortable and filterable by class and ascension status.',
};

export default function PrestigePage() {
  const champs = loadActiveChampions();

  const rows: PrestigeRow[] = champs.map((c) => {
    const base = { championId: c.id, rank: 5 as const, sig: 200, stateConfirmed: true, addedVia: 'manual' as const };
    const a0 = calculateBHR(c, { ...base, ascension: 'A0' });
    const a1 = c.ascendable ? calculateBHR(c, { ...base, ascension: 'A1' }) : null;
    const a2 = c.ascendable ? calculateBHR(c, { ...base, ascension: 'A2' }) : null;
    return {
      id: c.id,
      name: c.name,
      klass: c.class,
      ascendable: Boolean(c.ascendable),
      portraitUrl: c.portraitUrl ?? null,
      a0,
      a1,
      a2,
      ceiling: a2 ?? a0,
    };
  });

  return (
    <div className="space-y-6">
      <section>
        <h1 className="editorial-heading text-3xl mb-2">Prestige table</h1>
        <p className="text-[var(--color-ink-soft)]">
          Base Hero Rating at Rank 5, signature 200, for every released 7-star
          champion. Ascendable champions show A0, A1, and A2 tiers — the A2
          column is their ceiling. Non-ascendable champions have only an A0
          value. Sort by any column, filter by class or ascension status, or
          search by name.
        </p>
      </section>

      <PrestigeTable rows={rows} />
    </div>
  );
}
