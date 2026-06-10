import Link from 'next/link';
import type { Champion, ChampionClass } from '@prestige-tools/engine';
import type { Synergy, PartnerRef } from '../lib/synergies-loader';
import { ChampionPortrait } from './champion-portrait';

type PartnerWithMeta = PartnerRef & {
  klass: ChampionClass | null;
  portraitUrl: string | null;
};

/**
 * Per-champion synergies. Server-rendered; the 724 KB synergies.json
 * bundle stays out of the client. Each partner portrait is a Link to that
 * partner's detail page when we have them in our seed; otherwise plain text.
 */
export function SynergiesSection({
  synergies,
  championLookup,
}: {
  synergies: Synergy[];
  /** Slug → Champion, for resolving partner class/portrait. */
  championLookup: Map<string, Champion>;
}) {
  if (synergies.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="editorial-heading text-xl">
        Synergies
        <span className="text-sm font-normal text-[var(--color-ink-soft)] ml-2">
          ({synergies.length})
        </span>
      </h2>
      <div className="space-y-3">
        {synergies.map((s) => {
          const partners: PartnerWithMeta[] = s.partners.map((p) => {
            const c = p.slug ? championLookup.get(p.slug) : undefined;
            return {
              ...p,
              klass: c?.class ?? null,
              portraitUrl: c?.portraitUrl ?? null,
            };
          });
          return <SynergyCard key={s.synergyId} synergy={s} partners={partners} />;
        })}
      </div>
    </section>
  );
}

function SynergyCard({
  synergy,
  partners,
}: {
  synergy: Synergy;
  partners: PartnerWithMeta[];
}) {
  return (
    <article className="border border-[var(--color-rule)] rounded bg-[var(--color-paper)] p-3 space-y-2">
      <header className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-medium text-base">{synergy.name}</h3>
        {synergy.unique && (
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-marvel-impact)]/15 text-[var(--color-marvel-impact)]"
            title="This synergy can only activate once per team."
          >
            UNIQUE
          </span>
        )}
      </header>

      <div className="flex flex-wrap gap-2 pb-1">
        {partners.map((p, i) => (
          <PartnerTile key={`${p.slug ?? p.name}-${i}`} partner={p} />
        ))}
      </div>

      <ul className="space-y-1.5 text-sm text-[var(--color-ink)]">
        {synergy.effects.map((effect, i) => (
          <li
            key={i}
            className="border-l-2 border-[var(--color-rule)] pl-2.5 text-[var(--color-ink-soft)] leading-snug"
          >
            {effect}
          </li>
        ))}
      </ul>
    </article>
  );
}

function PartnerTile({ partner }: { partner: PartnerWithMeta }) {
  const inner = (
    <>
      {partner.klass ? (
        <ChampionPortrait
          name={partner.name}
          klass={partner.klass}
          portraitUrl={partner.portraitUrl}
          size={32}
        />
      ) : (
        <span className="inline-block w-8 h-8 bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded" />
      )}
      <span className="text-xs">{partner.name}</span>
    </>
  );

  const baseClasses =
    'inline-flex items-center gap-1.5 px-1.5 py-1 rounded border border-[var(--color-rule)] bg-[var(--color-paper-soft)]';

  if (partner.slug) {
    return (
      <Link
        href={`/champions/${partner.slug}/`}
        className={`${baseClasses} hover:border-[var(--color-marvel-impact)] hover:text-[var(--color-marvel-impact)] transition-colors`}
      >
        {inner}
      </Link>
    );
  }
  return (
    <span
      className={`${baseClasses} text-[var(--color-ink-soft)] opacity-75`}
      title="Not in our 7★ seed — can't link to a detail page."
    >
      {inner}
    </span>
  );
}
