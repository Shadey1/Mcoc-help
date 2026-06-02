import {
  calculateBHR,
  type Champion,
  type Roster,
} from '@prestige-tools/engine';
import { formatBHR } from '../lib/format';

/**
 * Four-up stat block summarising a roster: count, top-30 prestige, top-30
 * cutoff BHR, highest BHR. Shared between the /roster manager and the front
 * recommendations page so the headline numbers stay consistent.
 *
 * Pure presentational — caller passes the roster + lookup, no localStorage
 * access, no client-side hooks. Renders nothing for an empty roster.
 */
export function RosterSummary({
  roster,
  championLookup,
}: {
  roster: Roster;
  championLookup: Map<string, Champion>;
}) {
  if (roster.champions.length === 0) return null;

  const bhrs = roster.champions.map((s) => {
    const c = championLookup.get(s.championId)!;
    return calculateBHR(c, s);
  });
  const sorted = [...bhrs].sort((a, b) => b - a);
  const top30 = sorted.slice(0, 30);
  const prestige = Math.floor(top30.reduce((a, b) => a + b, 0) / top30.length);
  const cutoff = top30.length === 30 ? top30[29]! : 0;

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Stat label="Champions in roster" value={roster.champions.length.toString()} />
      <Stat
        label="Top-30 prestige"
        value={top30.length === 30 ? formatBHR(prestige) : '—'}
        note={top30.length < 30 ? `${30 - top30.length} more needed` : undefined}
      />
      <Stat
        label="Cutoff BHR"
        value={cutoff > 0 ? formatBHR(cutoff) : '—'}
        note={cutoff > 0 ? 'rank #30' : undefined}
      />
      <Stat
        label="Highest BHR"
        value={top30.length > 0 ? formatBHR(top30[0]!) : '—'}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
        {label}
      </div>
      <div className="numeric text-2xl font-medium mt-1">{value}</div>
      {note && (
        <div className="text-xs text-[var(--color-ink-soft)] mt-1">{note}</div>
      )}
    </div>
  );
}
