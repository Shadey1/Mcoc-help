import type { ChampionAbilities, AbilityPill } from '../lib/abilities-loader';

type ChampionAbilitiesSectionProps = {
  abilities: ChampionAbilities;
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
}: ChampionAbilitiesSectionProps) {
  const { pills, kit, source } = abilities;
  const hasPills =
    pills.abilities.length > 0 ||
    pills.immunities.length > 0 ||
    pills.tags.length > 0;
  const hasKit = kit.signature !== null || kit.cards.length > 0;

  if (!hasPills && !hasKit) return null;

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

      {hasKit && (
        <div className="space-y-3">
          {kit.signature && (
            <KitCardBlock card={kit.signature} signature />
          )}
          {kit.cards.map((card, i) => (
            <KitCardBlock key={`${card.title}-${i}`} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}

type PillRowProps = {
  label: string;
  labelTone: 'emerald' | 'slate';
  pills: AbilityPill[];
};

function PillRow({ label, labelTone, pills }: PillRowProps) {
  // Innate pills use the section's accent colour; synergy-granted pills
  // share a common "cyan" treatment to match MCOCHUB's convention. The
  // condition text lives in the title attribute so a hover surfaces it
  // without the layout cost of always-visible expanded blocks.
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
          const synergy = p.synergy;
          if (!synergy) {
            return (
              <span
                key={`${p.name}-${i}`}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none ${innateClass}`}
              >
                {p.name}
              </span>
            );
          }
          const partnerList = synergy.partners.length
            ? synergy.partners.join(', ')
            : '';
          const tooltip =
            (partnerList ? `Granted via synergy with ${partnerList}\n` : '') +
            synergy.note;
          return (
            <span
              key={`${p.name}-${i}`}
              title={tooltip}
              className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-medium leading-none text-cyan-900 cursor-help"
            >
              {p.name}
              <SynergyGlyph />
            </span>
          );
        })}
      </div>
    </div>
  );
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
  if (signature) {
    return (
      <div className="border border-[var(--color-rule)] rounded-lg overflow-hidden">
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
    <details className="border border-[var(--color-rule)] rounded-lg overflow-hidden group">
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
