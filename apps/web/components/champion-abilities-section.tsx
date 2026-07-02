import Link from 'next/link';
import type { ChampionAbilities, AbilityPill } from '../lib/abilities-loader';
import { resolvePartnerSlug } from '../lib/abilities-loader';
import { findChampionById } from '../lib/data-loader';

type ChampionAbilitiesSectionProps = {
  abilities: ChampionAbilities;
  /** Prose passive lines from auntm.ai — rendered as a supplementary card
   *  when MCOCHUB's kit doesn't spell out immunities in prose (legacy
   *  champs). Empty array or absent = no auntm data. */
  auntmPassives?: string[];
};

/**
 * Renders the imported MCOCHUB ability data on the champion detail page.
 *
 * Layout mirrors MCOCHUB's own page: a compact pill row first
 * (Abilities / Immunities / Tags — useful for quick scan and matches the
 * roster-table filter dimensions), then the rich kit (Signature Ability
 * always-expanded, then collapsible cards per ability cluster).
 */
export function ChampionAbilitiesSection({
  abilities,
  auntmPassives = [],
}: ChampionAbilitiesSectionProps) {
  const { pills, kit, source } = abilities;
  const hasPills =
    pills.abilities.length > 0 ||
    pills.immunities.length > 0 ||
    pills.tags.length > 0;
  const hasKit = kit.signature !== null || kit.cards.length > 0;
  const hasAuntmPassives = auntmPassives.length > 0;

  if (!hasPills && !hasKit && !hasAuntmPassives) return null;

  return (
    <section className="space-y-5 border-t border-[var(--color-rule)] pt-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="editorial-heading text-xl">Abilities</h2>
        <a
          href={source.url}
          target="_blank"
          rel="noopener"
          className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline"
        >
          MCOCHUB ↗
        </a>
      </div>

      {hasPills && (
        <div className="space-y-3">
          {pills.immunities.length > 0 && (
            <PillRow
              label="Immunities"
              labelTone="emerald"
              pills={pills.immunities}
            />
          )}
          {pills.abilities.length > 0 && (
            <PillRow
              label="Abilities"
              labelTone="slate"
              pills={pills.abilities}
            />
          )}
          {pills.tags.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
                Tags
              </div>
              <div className="flex flex-wrap gap-1">
                {pills.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] text-indigo-700"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(hasKit || hasAuntmPassives) && (
        <div className="space-y-3">
          {kit.signature && (
            <KitCardBlock card={kit.signature} signature />
          )}
          {hasAuntmPassives && (
            <AuntmPassivesCard passives={auntmPassives} />
          )}
          {kit.cards.map((card, i) => (
            <KitCardBlock key={`${card.title}-${i}`} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Renders auntm.ai's prose passive lines as an ability card. Rendered
 * always-open (no <details>) because these are the plain-English
 * immunity descriptions the source-comparison story hinges on for
 * legacy champs whose MCOCHUB cards don't spell them out.
 */
function AuntmPassivesCard({ passives }: { passives: string[] }) {
  return (
    <div className="border border-[var(--color-rule)] rounded-lg overflow-hidden bg-[var(--color-paper-card)]">
      <div className="px-4 py-2 bg-[var(--color-marvel-editorial)]/10 border-b border-[var(--color-rule)] font-semibold text-sm flex items-baseline justify-between gap-2 flex-wrap">
        <span>PASSIVES — via auntm.ai</span>
        <span className="text-[10px] font-normal uppercase tracking-wider text-[var(--color-ink-soft)]">
          in-game text · frozen 2024
        </span>
      </div>
      <ul className="divide-y divide-[var(--color-rule)]/60">
        {passives.map((line, i) => (
          <li key={i} className="px-4 py-2 text-sm leading-relaxed">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

type PillRowProps = {
  label: string;
  labelTone: 'emerald' | 'slate';
  pills: AbilityPill[];
};

function PillRow({ label, labelTone, pills }: PillRowProps) {
  // Innate pills use the section's accent colour. Synergy-granted pills
  // are <details> elements: the summary IS the pill (so it's visibly
  // interactive), clicking expands a small panel below the row showing
  // the partner list (linked when in our seed) and the condition text.
  // Native <details> works on touch, doesn't need React state, and
  // doesn't need this to be a client component.
  const labelClass =
    labelTone === 'emerald'
      ? 'text-emerald-700'
      : 'text-[var(--color-ink-soft)]';
  const innateClass =
    labelTone === 'emerald'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
      : 'bg-[var(--color-paper-soft)] border-[var(--color-rule)] text-[var(--color-ink)]';
  return (
    <div className="space-y-1.5">
      <div
        className={`text-[11px] font-semibold uppercase tracking-wider ${labelClass}`}
      >
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pills.map((p, i) => {
          if (!p.synergy) {
            return (
              <span
                key={`${p.name}-${i}`}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none ${innateClass}`}
              >
                {p.name}
              </span>
            );
          }
          return <SynergyPill key={`${p.name}-${i}`} pill={p} />;
        })}
      </div>
    </div>
  );
}

function SynergyPill({ pill }: { pill: AbilityPill }) {
  const synergy = pill.synergy!;
  // Resolve each MCOCHUB partner slug back to a seed champion so we can
  // show the real display name and link through to their detail page.
  // Unresolved partners (e.g. legacy 6-star-only) fall back to a
  // best-effort prettified slug as plain text.
  const partners = synergy.partners.map((slug) => {
    const seedId = resolvePartnerSlug(slug);
    if (!seedId) {
      return { label: prettifySlug(slug), seedId: null };
    }
    const champ = findChampionById(seedId);
    return { label: champ?.name ?? prettifySlug(slug), seedId };
  });
  return (
    <details className="group inline-block align-middle">
      <summary className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-medium leading-none text-cyan-900 cursor-pointer hover:bg-cyan-100 list-none [&::-webkit-details-marker]:hidden">
        {pill.name}
        <SynergyGlyph />
      </summary>
      <div className="mt-1.5 ml-1 max-w-sm rounded-md border border-cyan-200 bg-cyan-50/70 px-3 py-2 text-xs leading-relaxed text-cyan-950">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-700 mb-1">
          Granted via synergy
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mb-1.5">
          {partners.map((p, j) =>
            p.seedId ? (
              <Link
                key={`${p.label}-${j}`}
                href={`/champions/${p.seedId}/`}
                className="underline decoration-cyan-400/60 hover:text-cyan-700"
              >
                {p.label}
              </Link>
            ) : (
              <span key={`${p.label}-${j}`}>{p.label}</span>
            ),
          )}
        </div>
        <div>{synergy.note}</div>
      </div>
    </details>
  );
}

function prettifySlug(slug: string): string {
  return slug.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function SynergyGlyph() {
  return (
    <svg
      className="h-2.5 w-2.5 text-cyan-600"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
  );
}

type KitCardBlockProps = {
  card: { title: string; trigger: string; lines: string[] };
  signature?: boolean;
};

function KitCardBlock({ card, signature }: KitCardBlockProps) {
  const heading = card.trigger
    ? `${card.title} — ${card.trigger}`
    : card.title;
  // Signature is always expanded; the rest are <details> the user opens.
  // Card body sits on --color-paper-card so it lifts off the page bg in
  // both modes (matches the rest of the site's panelled sections).
  if (signature) {
    return (
      <div className="border border-[var(--color-rule)] rounded-lg overflow-hidden bg-[var(--color-paper-card)]">
        <div className="px-4 py-2 bg-[var(--color-marvel-editorial)]/10 border-b border-[var(--color-rule)] font-semibold text-sm">
          {heading}
        </div>
        <ul className="divide-y divide-[var(--color-rule)]/60">
          {card.lines.map((line, i) => (
            <li key={i} className="px-4 py-2 text-sm leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <details className="border border-[var(--color-rule)] rounded-lg overflow-hidden group bg-[var(--color-paper-card)]">
      <summary className="px-4 py-2 cursor-pointer font-medium text-sm flex items-center justify-between gap-2 hover:bg-[var(--color-paper-soft)]">
        <span>{heading}</span>
        <span className="text-[var(--color-ink-soft)] text-xs group-open:rotate-180 transition-transform">
          ▾
        </span>
      </summary>
      <ul className="divide-y divide-[var(--color-rule)]/60 border-t border-[var(--color-rule)]">
        {card.lines.map((line, i) => (
          <li key={i} className="px-4 py-2 text-sm leading-relaxed">
            {line}
          </li>
        ))}
      </ul>
    </details>
  );
}
