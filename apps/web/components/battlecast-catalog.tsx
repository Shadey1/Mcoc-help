import {
  BATTLECAST_6STAR_CATALOG,
  BATTLECAST_6STAR_IDS,
} from '@prestige-tools/engine';

/**
 * 6★ Battlecast catalogue — one row per relic.
 *
 * Verified anchors come from direct in-game captures. The MCOCHUB column
 * shows community-ranking values for reference; their state is unattested
 * (originally thought to be R1 sig 0, but cross-checking against verified
 * captures shows they're actually snapshots of one summoner's specific
 * relic states across varying ranks + sigs). They don't contribute to
 * top-30 prestige.
 */
export function BattlecastCatalog() {
  const rows = BATTLECAST_6STAR_IDS.map((id) => BATTLECAST_6STAR_CATALOG[id]);

  return (
    <div className="border border-[var(--color-rule)] rounded bg-[var(--color-paper-card)]">
      <div className="px-4 py-3 border-b border-[var(--color-rule)] flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="editorial-heading text-xl">6★ Battlecast catalogue</h3>
        <div className="text-xs text-[var(--color-ink-soft)]">
          <span className="font-medium">verified</span> = direct in-game capture
          <span className="mx-2">·</span>
          <span className="italic">MCOCHUB</span> = community ranking, state unattested (no top-30 contribution)
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]/60">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Relic</th>
              <th className="text-left px-3 py-2 font-medium">Class</th>
              <th className="text-right px-3 py-2 font-medium">MCOCHUB rank</th>
              <th className="text-left px-3 py-2 font-medium">Verified anchors</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((def) => (
              <tr
                key={def.id}
                className="border-t border-[var(--color-rule)]/40"
              >
                <td className="px-3 py-2 font-medium">{def.name}</td>
                <td className="px-3 py-2 text-[var(--color-ink-soft)]">
                  {def.class}
                </td>
                <td className="px-3 py-2 numeric text-[var(--color-ink-soft)] italic text-right">
                  {def.mcochubAnchor !== null
                    ? def.mcochubAnchor.toLocaleString()
                    : '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {def.verified.length === 0 ? (
                    <span className="text-[var(--color-ink-soft)] italic">
                      none yet
                    </span>
                  ) : (
                    <ul className="space-y-0.5">
                      {def.verified.map((v, i) => (
                        <li key={i} className="numeric">
                          {v.rank} sig {v.sig} = {v.rating.toLocaleString()}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-[var(--color-rule)] text-xs text-[var(--color-ink-soft)]">
        Battlecasts are champion-bound; each relic has its own curve.
        Submit a reading via the form below to fill in more states.
      </div>
    </div>
  );
}
