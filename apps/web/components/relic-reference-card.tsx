import {
  R6_STATCAST_LEVELS,
  R6_STATCAST_RANKS,
  r6StatcastRating,
} from '@prestige-tools/engine';

/**
 * 6★ Standard Statcast reference card.
 *
 * Renders the verified BHR anchors and the alpha-fill extrapolation in one
 * table. Verified cells show plain values; alpha cells dim and pick up an
 * "α" badge so users know they're seeing a best-guess estimate, not fact.
 *
 * Pure server component — reads from `Statcast6.RELIC_RATING` at render
 * time. When more captures land in the seed, this UI updates with no
 * additional work.
 */
export function RelicReferenceCard() {
  const ranks = R6_STATCAST_RANKS;
  const levels = R6_STATCAST_LEVELS;

  return (
    <div className="border border-[var(--color-rule)] rounded bg-[var(--color-paper-card)]">
      <div className="px-4 py-3 border-b border-[var(--color-rule)] flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="editorial-heading text-xl">6★ Standard Statcast — what we know</h3>
        <div className="text-xs text-[var(--color-ink-soft)]">
          <span className="inline-flex items-center gap-1">
            <span className="font-medium">bold</span> = verified
          </span>
          <span className="mx-2">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="text-[var(--color-ink-soft)] italic">dim α</span> = alpha estimate
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm numeric">
          <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]/60">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Rank</th>
              {levels.map((l) => (
                <th key={l} className="text-right px-2 py-2 font-medium">
                  sig {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranks.map((rank) => (
              <tr key={rank} className="border-t border-[var(--color-rule)]/40">
                <td className="px-3 py-2 font-medium">{rank}</td>
                {levels.map((level) => {
                  const { rating, isAlpha } = r6StatcastRating(rank, level);
                  return (
                    <td
                      key={level}
                      className={`px-2 py-2 text-right ${
                        isAlpha
                          ? 'text-[var(--color-ink-soft)]/60 italic'
                          : 'font-medium'
                      }`}
                      title={
                        isAlpha
                          ? 'Alpha — estimated by extrapolating the verified curve. Not a confirmed in-game reading.'
                          : 'Verified from in-game capture'
                      }
                    >
                      {rating.toLocaleString()}
                      {isAlpha && (
                        <sup className="text-[9px] ml-0.5 not-italic">α</sup>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-[var(--color-rule)] text-xs text-[var(--color-ink-soft)]">
        Class, type, flavour and bound-champion don&apos;t affect this curve
        — verified across six different relic adjectives × five classes.
        Single continuous ladder: R(n) sig 60 = R(n+1) sig 0.
      </div>
    </div>
  );
}
