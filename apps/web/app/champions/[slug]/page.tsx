import Link from 'next/link';
import { notFound } from 'next/navigation';
import seedData from '../../../../../data/champions/seed.json' with { type: 'json' };
import { ChampionPortrait } from '../../../components/champion-portrait';
import { ScalingChart } from '../../../components/scaling-chart';

type SeedChampion = {
  id: string;
  name: string;
  class: 'Mutant' | 'Skill' | 'Science' | 'Mystic' | 'Cosmic' | 'Tech';
  ascendable: boolean;
  portraitUrl?: string | null;
  sevenStarReleased?: boolean;
  prestige: {
    rank5: { '0': number; '200': number };
  };
};

// Required for Next.js static export
export function generateStaticParams() {
  return (seedData.champions as SeedChampion[]).map((c) => ({ slug: c.id }));
}

export default async function ChampionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const champion = (seedData.champions as SeedChampion[]).find((c) => c.id === slug);
  if (!champion) notFound();

  const ascensionMult = champion.ascendable ? 1.16 : 1.0;
  const ceiling = Math.round((champion.prestige.rank5['200'] * ascensionMult) / 10) * 10;
  const unreleased = champion.sevenStarReleased === false;

  return (
    <div className="space-y-8 max-w-3xl">
      <nav className="text-sm text-[var(--color-ink-soft)]">
        <Link href="/champions/" className="hover:text-[var(--color-marvel-impact)]">
          ← All champions
        </Link>
      </nav>

      {unreleased && (
        <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-900">
          <strong>Not yet released at 7-star.</strong> Prestige reference shown below is
          anticipated. This champion is excluded from your roster recommendations and
          ceiling calculations until released.
        </div>
      )}

      <section className="flex items-start gap-6">
        <ChampionPortrait
          name={champion.name}
          klass={champion.class}
          portraitUrl={champion.portraitUrl ?? null}
          size={120}
          showClassOverlay={Boolean(champion.portraitUrl)}

        />
        <div>
          <h1 className="editorial-heading text-4xl mb-2">{champion.name}</h1>
          <div className="flex gap-3 text-sm">
            <span className="px-2 py-1 bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded">
              {champion.class}
            </span>
            {champion.ascendable && (
              <span className="px-2 py-1 bg-[var(--color-marvel-editorial)] text-[var(--color-paper)] rounded font-medium">
                Ascendable
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">Prestige reference (7-star)</h2>
        <table className="w-full text-sm border border-[var(--color-rule)] rounded">
          <thead className="bg-[var(--color-paper-soft)]">
            <tr>
              <th className="text-left p-3 font-medium">State</th>
              <th className="text-right p-3 font-medium">BHR</th>
            </tr>
          </thead>
          <tbody className="numeric">
            <tr className="border-t border-[var(--color-rule)]">
              <td className="p-3">R5 sig 0 A0</td>
              <td className="p-3 text-right">{champion.prestige.rank5['0'].toLocaleString()}</td>
            </tr>
            <tr className="border-t border-[var(--color-rule)]">
              <td className="p-3">R5 sig 200 A0</td>
              <td className="p-3 text-right">
                {champion.prestige.rank5['200'].toLocaleString()}
              </td>
            </tr>
            {champion.ascendable && (
              <>
                <tr className="border-t border-[var(--color-rule)]">
                  <td className="p-3">R5 sig 200 A1</td>
                  <td className="p-3 text-right">
                    {(
                      Math.round((champion.prestige.rank5['200'] * 1.08) / 10) * 10
                    ).toLocaleString()}
                  </td>
                </tr>
                <tr className="border-t border-[var(--color-rule)] font-medium">
                  <td className="p-3 text-[var(--color-marvel-editorial)]">
                    R5 sig 200 A2 (ceiling)
                  </td>
                  <td className="p-3 text-right text-[var(--color-marvel-editorial)]">
                    {ceiling.toLocaleString()}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="editorial-heading text-xl">BHR scaling</h2>
        <ScalingChart
          rank5Sig0={champion.prestige.rank5['0']}
          rank5Sig200={champion.prestige.rank5['200']}
          ascendable={champion.ascendable}
        />
      </section>

      <p className="text-sm text-[var(--color-ink-soft)] italic">
        Synergies, immunities, and ability data will be populated in Phase 1
        from MCOCHUB and the Fandom wiki.
      </p>
    </div>
  );
}
