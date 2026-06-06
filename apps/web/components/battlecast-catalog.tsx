import {
  BATTLECAST_6STAR_CATALOG,
  BATTLECAST_6STAR_IDS,
} from '@prestige-tools/engine';

/**
 * 6★ Battlecast catalogue — one row per relic with its verified anchors
 * from in-game captures. No more MCOCHUB column — those values turned
 * out to be a stale roster snapshot, not a normalised reference.
 */
export function BattlecastCatalog() {
  const rows = BATTLECAST_6STAR_IDS.map((id) => BATTLECAST_6STAR_CATALOG[id]);

  return (
    <div className="border border-[var(--color-rule)] rounded bg-[var(--color-paper-card)]">
      <div className="px-4 py-3 border-b border-[var(--color-rule)]">
        <h3 className="editorial-heading text-xl">6★ Battlecast catalogue</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]/60">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Relic</th>
              <th className="text-left px-3 py-2 font-medium">Class</th>
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
        Battlecasts are champion-bound; each relic has its own curve. A
        relic only contributes to top-30 when its current (rank, sig)
        matches a verified anchor. Submit readings via the form below to
        fill in more states.
      </div>
    </div>
  );
}
