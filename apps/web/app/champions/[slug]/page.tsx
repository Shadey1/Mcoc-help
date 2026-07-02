import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  loadAllChampions,
  loadChampionLookup,
  findChampionById,
} from '../../../lib/data-loader';
import { loadSynergiesForChampion } from '../../../lib/synergies-loader';
import { loadAbilitiesFor, loadAuntmPassivesFor } from '../../../lib/abilities-loader';
import { ChampionPortrait } from '../../../components/champion-portrait';
import { ScalingChart } from '../../../components/scaling-chart';
import { BhrReferenceTable } from '../../../components/bhr-reference-table';
import { SynergiesSection } from '../../../components/synergies-section';
import { ChampionAbilitiesSection } from '../../../components/champion-abilities-section';
import { displayRarity } from '../../../lib/champion-rarity';

// Required for Next.js static export
export function generateStaticParams() {
  return loadAllChampions().map((c) => ({ slug: c.id }));
}

export default async function ChampionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const champion = findChampionById(slug);
  if (!champion) notFound();

  const synergies = loadSynergiesForChampion(slug);
  const abilities = loadAbilitiesFor(slug);
  const auntmPassives = loadAuntmPassivesFor(slug);
  const championLookup = loadChampionLookup();
  const hasPrestige = champion.prestige !== undefined;
  const unreleased = champion.sevenStarReleased === false;
  // Partner-only stubs: never released at 7★, no prestige data — display
  // identity + synergies only and link out for full champ details.
  const partnerOnly = unreleased && !hasPrestige;
  const fandomUrl = `https://marvel-contestofchampions.fandom.com/wiki/${encodeURIComponent(
    champion.name.replace(/ /g, '_'),
  )}`;

  return (
    <div className="space-y-8 max-w-3xl">
      <nav className="text-sm text-[var(--color-ink-soft)]">
        <Link href="/champions/" className="hover:text-[var(--color-marvel-impact)]">
          ← All champions
        </Link>
      </nav>

      {unreleased && !partnerOnly && (
        <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-900">
          <strong>Not yet released at 7-star.</strong> Prestige reference shown below is
          anticipated. This champion is excluded from your roster recommendations and
          ceiling calculations until released.
        </div>
      )}
      {partnerOnly && (
        <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-900">
          <strong>Not currently available at 7-star.</strong> Shown as a synergy
          partner reference. No prestige curves are tracked yet — when Kabam releases
          this champion at 7★ we&rsquo;ll fill them in.
        </div>
      )}

      <section className="flex items-start gap-6">
        <ChampionPortrait
          name={champion.name}
          klass={champion.class}
          portraitUrl={champion.portraitUrl ?? null}
          size={120}
          showClassOverlay={Boolean(champion.portraitUrl)}
          rarity={displayRarity(champion)}
        />
        <div className="flex-1 min-w-0">
          <h1 className="editorial-heading text-4xl mb-2">{champion.name}</h1>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="px-2 py-1 bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded">
              {champion.class}
            </span>
            {champion.ascendable && (
              <span className="px-2 py-1 bg-[var(--color-marvel-editorial)] text-[var(--color-paper)] rounded font-medium">
                Ascendable
              </span>
            )}
            {champion.released && (
              <span className="px-2 py-1 bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded text-[var(--color-ink-soft)]">
                Released {champion.released}
              </span>
            )}
            {champion.tags?.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 bg-[var(--color-paper)] border border-[var(--color-rule)]/60 rounded text-xs text-[var(--color-ink-soft)]"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      {champion.prestige && (
        <>
          <BhrReferenceTable champion={champion} />

          <section className="space-y-3">
            <h2 className="editorial-heading text-xl">BHR scaling</h2>
            <ScalingChart
              rank5Sig0={champion.prestige.rank5['0']}
              rank5Sig200={champion.prestige.rank5['200']}
              ascendable={champion.ascendable}
            />
          </section>
        </>
      )}

      {abilities && (
        <ChampionAbilitiesSection
          abilities={abilities}
          auntmPassives={auntmPassives}
        />
      )}

      <SynergiesSection synergies={synergies} championLookup={championLookup} />

      <section className="space-y-2 border-t border-[var(--color-rule)] pt-6">
        <h2 className="editorial-heading text-xl">Sources</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {champion._meta?.bhrSource && (
            <>
              <dt className="text-[var(--color-ink-soft)]">BHR curves</dt>
              <dd>{champion._meta.bhrSource}</dd>
            </>
          )}
          {champion._meta?.ascendableSource && (
            <>
              <dt className="text-[var(--color-ink-soft)]">Ascendable flag</dt>
              <dd>{champion._meta.ascendableSource}</dd>
            </>
          )}
          {champion._meta?.lastVerified && (
            <>
              <dt className="text-[var(--color-ink-soft)]">Last verified</dt>
              <dd className="numeric">{champion._meta.lastVerified}</dd>
            </>
          )}
          <dt className="text-[var(--color-ink-soft)]">Verify externally</dt>
          <dd className="flex flex-wrap gap-x-3 gap-y-1">
            <a
              href={fandomUrl}
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-marvel-impact)]"
            >
              Fandom wiki ↗
            </a>
            <a
              href="https://mcochub.insaneskull.com/prestige"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-marvel-impact)]"
              title={`Open MCOCHUB prestige page (Ctrl+F "${champion.name}")`}
            >
              MCOCHUB prestige ↗
            </a>
            <a
              href="https://mcoc.gg"
              target="_blank"
              rel="noopener"
              className="underline hover:text-[var(--color-marvel-impact)]"
            >
              mcoc.gg ↗
            </a>
          </dd>
        </dl>
      </section>
    </div>
  );
}
