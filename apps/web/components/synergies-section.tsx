import Link from 'next/link';
import type { Champion, ChampionClass } from '@prestige-tools/engine';
import type {
  ReciprocalSynergy,
  Synergy,
  PartnerRef,
} from '../lib/synergies-loader';
import { ChampionPortrait, type Rarity } from './champion-portrait';
import { displayRarity } from '../lib/champion-rarity';

type PartnerWithMeta = PartnerRef & {
  klass: ChampionClass | null;
  portraitUrl: string | null;
  rarity: Rarity;
};

/**
 * Per-champion synergies. Server-rendered; the 724 KB synergies.json
 * bundle stays out of the client. Each partner portrait is a Link to that
 * partner's detail page when we have them in our seed; otherwise plain text.
 *
 * Renders two groups:
 *   1. "Team synergies" — where this champion is the host / primary
 *      beneficiary (data.champions[slug] on mcoc.gg's model).
 *   2. "You enable for other champions" — synergies where this champion
 *      appears as a partner, not host. This surfaces the "who to bring"
 *      side of the relationship: with THIS champ on the team, these
 *      other champions gain the following. Computed via the reverse
 *      index in synergies-loader.
 */
export function SynergiesSection({
  synergies,
  reciprocals,
  championLookup,
}: {
  synergies: Synergy[];
  reciprocals?: ReciprocalSynergy[];
  /** Slug → Champion, for resolving partner class/portrait. */
  championLookup: Map<string, Champion>;
}) {
  const reciprocalList = reciprocals ?? [];
  if (synergies.length === 0 && reciprocalList.length === 0) return null;

  function partnersWithMeta(s: Synergy): PartnerWithMeta[] {
    return s.partners.map((p) => {
      const c = p.slug ? championLookup.get(p.slug) : undefined;
      return {
        ...p,
        klass: c?.class ?? null,
        portraitUrl: c?.portraitUrl ?? null,
        rarity: displayRarity(c),
      };
    });
  }

  return (
    <div className="space-y-6">
      {synergies.length > 0 && (
        <section className="space-y-3">
          <h2 className="editorial-heading text-xl">
            Team synergies
            <span className="text-sm font-normal text-[var(--color-ink-soft)] ml-2">
              ({synergies.length})
            </span>
          </h2>
          <div className="space-y-3">
            {synergies.map((s) => (
              <SynergyCard
                key={s.synergyId}
                synergy={s}
                partners={partnersWithMeta(s)}
              />
            ))}
          </div>
        </section>
      )}

      {reciprocalList.length > 0 && (
        <section className="space-y-3">
          <h2 className="editorial-heading text-xl">
            You enable for other champions
            <span className="text-sm font-normal text-[var(--color-ink-soft)] ml-2">
              ({reciprocalList.length})
            </span>
          </h2>
          <p className="text-xs text-[var(--color-ink-soft)] max-w-xl">
            Bringing this champion enables the following synergies for
            other champions in your team. The host&apos;s effect text is
            shown so you can see what benefit the pairing unlocks.
          </p>
          <div className="space-y-3">
            {reciprocalList.map(({ hostSlug, synergy }) => {
              const host = championLookup.get(hostSlug);
              return (
                <SynergyCard
                  key={`${hostSlug}-${synergy.synergyId}`}
                  synergy={synergy}
                  partners={partnersWithMeta(synergy)}
                  hostSlug={hostSlug}
                  hostName={host?.name ?? hostSlug}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SynergyCard({
  synergy,
  partners,
  hostSlug,
  hostName,
}: {
  synergy: Synergy;
  partners: PartnerWithMeta[];
  /** Present on reciprocal cards — the champion whose page normally
   *  hosts this synergy's effect text. Renders as a "From <name>" line. */
  hostSlug?: string;
  hostName?: string;
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

      {hostSlug && hostName && (
        <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-ink-soft)]">
          Benefit for{' '}
          <Link
            href={`/champions/${hostSlug}/`}
            className="normal-case font-sans font-medium text-[var(--color-marvel-impact)] hover:underline tracking-normal"
          >
            {hostName}
          </Link>
        </div>
      )}

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
          rarity={partner.rarity}
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
