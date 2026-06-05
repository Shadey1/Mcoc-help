'use client';

import { useEffect, useState } from 'react';

const TOKEN_KEY = 'mcoc-help-admin-token-v1';

type StoredReport = {
  key: string;
  championId: string;
  rank: 3 | 4 | 5;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
  predictedBhr: number;
  actualBhr: number;
  delta: number;
  createdAt: string;
};

type StoredRelicReport = {
  key: string;
  kind?: 'statcast' | 'battlecast';
  relicId?: string | null;
  rank: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  level: number;
  rating: number;
  predictedRating: number | null;
  isAlpha: boolean | null;
  delta: number | null;
  createdAt: string;
};

type FetchState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; reports: T[]; truncated: boolean; count: number };

/**
 * Token entry + report list for /admin/calibrations. The token is stored
 * in localStorage so Dave only has to paste it once per browser. Click
 * "Forget token" to remove.
 *
 * Aggregates by (championId, rank, sig, ascension) so duplicates surface
 * as repeated reports against the same state — a stronger signal that
 * the curve needs updating than a single report.
 */
export function CalibrationsAdmin() {
  const [token, setToken] = useState<string>('');
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [state, setState] = useState<FetchState<StoredReport>>({ kind: 'idle' });
  const [relicState, setRelicState] = useState<FetchState<StoredRelicReport>>({
    kind: 'idle',
  });

  useEffect(() => {
    const t = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (t) {
      setSavedToken(t);
      void fetchReports(t);
      void fetchRelicReports(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchReports(t: string) {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/calibration-report', {
        headers: { authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        setState({ kind: 'error', message: 'Token rejected (401)' });
        return;
      }
      if (res.status === 503) {
        setState({
          kind: 'error',
          message: 'Admin endpoint not configured (ADMIN_TOKEN env var missing on Cloudflare Pages)',
        });
        return;
      }
      if (!res.ok) {
        setState({ kind: 'error', message: `Request failed (${res.status})` });
        return;
      }
      const body = (await res.json()) as {
        reports: StoredReport[];
        truncated: boolean;
        count: number;
      };
      setState({
        kind: 'ok',
        reports: body.reports,
        truncated: body.truncated,
        count: body.count,
      });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }

  async function fetchRelicReports(t: string) {
    setRelicState({ kind: 'loading' });
    try {
      const res = await fetch('/api/relic-report', {
        headers: { authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        setRelicState({ kind: 'error', message: 'Token rejected (401)' });
        return;
      }
      if (res.status === 503) {
        setRelicState({
          kind: 'error',
          message: 'Admin endpoint not configured',
        });
        return;
      }
      if (!res.ok) {
        setRelicState({ kind: 'error', message: `Request failed (${res.status})` });
        return;
      }
      const body = (await res.json()) as {
        reports: StoredRelicReport[];
        truncated: boolean;
        count: number;
      };
      setRelicState({
        kind: 'ok',
        reports: body.reports,
        truncated: body.truncated,
        count: body.count,
      });
    } catch (err) {
      setRelicState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    window.localStorage.setItem(TOKEN_KEY, token.trim());
    setSavedToken(token.trim());
    setToken('');
    void fetchReports(token.trim());
    void fetchRelicReports(token.trim());
  }

  function forgetToken() {
    window.localStorage.removeItem(TOKEN_KEY);
    setSavedToken(null);
    setState({ kind: 'idle' });
    setRelicState({ kind: 'idle' });
  }

  if (!savedToken) {
    return (
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 max-w-sm"
      >
        <label className="text-sm">
          Admin token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="block w-full mt-1 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
            autoFocus
          />
        </label>
        <button
          type="submit"
          disabled={!token.trim()}
          className="text-sm px-4 py-1.5 bg-[var(--color-marvel-impact)] text-white rounded disabled:opacity-50"
        >
          Load reports
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => {
            void fetchReports(savedToken);
            void fetchRelicReports(savedToken);
          }}
          className="px-3 py-1 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)]"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={forgetToken}
          className="text-[var(--color-ink-soft)] underline hover:text-[var(--color-marvel-impact)]"
        >
          Forget token
        </button>
        {state.kind === 'ok' && (
          <span className="text-[var(--color-ink-soft)]">
            {state.count} report{state.count === 1 ? '' : 's'}
            {state.truncated && ` (truncated)`}
          </span>
        )}
      </div>

      {state.kind === 'loading' && (
        <div className="text-sm text-[var(--color-ink-soft)] italic">Loading…</div>
      )}
      {state.kind === 'error' && (
        <div className="text-sm text-[var(--color-marvel-impact)] border border-[var(--color-marvel-impact)] rounded p-3">
          {state.message}
        </div>
      )}
      {state.kind === 'ok' && state.reports.length === 0 && (
        <div className="text-sm text-[var(--color-ink-soft)] italic">
          No reports yet.
        </div>
      )}
      {state.kind === 'ok' && state.reports.length > 0 && (
        <ReportsTable reports={state.reports} />
      )}

      <section className="space-y-2 border-t border-[var(--color-rule)] pt-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="editorial-heading text-2xl">6★ relic readings</h2>
          {relicState.kind === 'ok' && (
            <span className="text-xs text-[var(--color-ink-soft)]">
              {relicState.count} report{relicState.count === 1 ? '' : 's'}
              {relicState.truncated && ` (truncated)`}
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--color-ink-soft)]">
          User-submitted ratings for 6★ Standard Statcasts. Multiple reports
          at the same (rank, level) are stronger signal; if a group is tight,
          fold the median into RELIC_RATING and the next deploy flips that
          cell from α to verified.
        </p>
        {relicState.kind === 'loading' && (
          <div className="text-sm text-[var(--color-ink-soft)] italic">Loading…</div>
        )}
        {relicState.kind === 'error' && (
          <div className="text-sm text-[var(--color-marvel-impact)] border border-[var(--color-marvel-impact)] rounded p-3">
            {relicState.message}
          </div>
        )}
        {relicState.kind === 'ok' && relicState.reports.length === 0 && (
          <div className="text-sm text-[var(--color-ink-soft)] italic">
            No relic reports yet.
          </div>
        )}
        {relicState.kind === 'ok' && relicState.reports.length > 0 && (
          <RelicReportsTable reports={relicState.reports} />
        )}
      </section>
    </div>
  );
}

function RelicReportsTable({ reports }: { reports: StoredRelicReport[] }) {
  // Split by kind so each section reads cleanly. Older reports may not have
  // `kind` set — treat those as statcast (the original endpoint shape).
  const statcasts = reports.filter((r) => (r.kind ?? 'statcast') === 'statcast');
  const battlecasts = reports.filter((r) => r.kind === 'battlecast');

  type Group = {
    relicId: string | null;
    rank: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
    level: number;
    reports: StoredRelicReport[];
  };
  const groups = new Map<string, Group>();
  for (const r of statcasts) {
    const k = `${r.rank}|${r.level}`;
    const existing = groups.get(k);
    if (existing) existing.reports.push(r);
    else groups.set(k, { relicId: null, rank: r.rank, level: r.level, reports: [r] });
  }
  const groupList = [...groups.values()].sort(
    (a, b) => b.reports.length - a.reports.length,
  );

  const battlecastGroups = new Map<string, Group>();
  for (const r of battlecasts) {
    const k = `${r.relicId ?? '?'}|${r.rank}|${r.level}`;
    const existing = battlecastGroups.get(k);
    if (existing) existing.reports.push(r);
    else
      battlecastGroups.set(k, {
        relicId: r.relicId ?? null,
        rank: r.rank,
        level: r.level,
        reports: [r],
      });
  }
  const battlecastGroupList = [...battlecastGroups.values()].sort(
    (a, b) => b.reports.length - a.reports.length,
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="editorial-heading text-lg">
          Statcast — grouped by (rank, sig)
        </h3>
        <div className="overflow-x-auto border border-[var(--color-rule)] rounded">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]">
              <tr>
                <th className="text-center p-3">State</th>
                <th className="text-right p-3">Reports</th>
                <th className="text-right p-3">Predicted (median)</th>
                <th className="text-right p-3">Actual (median)</th>
                <th className="text-right p-3">Δ (median)</th>
                <th className="text-right p-3">Δ range</th>
                <th className="text-left p-3">α at submission?</th>
              </tr>
            </thead>
            <tbody>
              {groupList.map((g) => {
                const predicteds = g.reports
                  .map((r) => r.predictedRating)
                  .filter((p): p is number => p !== null);
                const predictedMedian = predicteds.length > 0 ? median(predicteds) : null;
                const actualMedian = median(g.reports.map((r) => r.rating));
                const deltas = g.reports
                  .map((r) => r.delta)
                  .filter((d): d is number => d !== null)
                  .sort((a, b) => a - b);
                const deltaMedian = deltas.length > 0 ? median(deltas) : null;
                const deltaMin = deltas.length > 0 ? deltas[0]! : null;
                const deltaMax = deltas.length > 0 ? deltas[deltas.length - 1]! : null;
                const alphaCount = g.reports.filter((r) => r.isAlpha === true).length;
                return (
                  <tr
                    key={`${g.rank}|${g.level}`}
                    className="border-t border-[var(--color-rule)]/40"
                  >
                    <td className="p-3 text-center numeric text-xs">
                      {g.rank} L{g.level}
                    </td>
                    <td className="p-3 text-right numeric">{g.reports.length}</td>
                    <td className="p-3 text-right numeric">
                      {predictedMedian ?? '—'}
                    </td>
                    <td className="p-3 text-right numeric">{actualMedian}</td>
                    <td
                      className={`p-3 text-right numeric font-medium ${
                        deltaMedian === null || deltaMedian === 0
                          ? 'text-[var(--color-ink-soft)]'
                          : 'text-[var(--color-marvel-editorial)]'
                      }`}
                    >
                      {deltaMedian === null
                        ? '—'
                        : `${deltaMedian > 0 ? '+' : ''}${deltaMedian}`}
                    </td>
                    <td className="p-3 text-right numeric text-xs text-[var(--color-ink-soft)]">
                      {deltaMin === null || deltaMin === deltaMax
                        ? '—'
                        : `${deltaMin > 0 ? '+' : ''}${deltaMin} … ${
                            (deltaMax ?? 0) > 0 ? '+' : ''
                          }${deltaMax}`}
                    </td>
                    <td className="p-3 text-xs text-[var(--color-ink-soft)]">
                      {alphaCount}/{g.reports.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {battlecastGroupList.length > 0 && (
        <section className="space-y-2">
          <h3 className="editorial-heading text-lg">
            Battlecast — grouped by (relic, rank, sig)
          </h3>
          <div className="overflow-x-auto border border-[var(--color-rule)] rounded">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]">
                <tr>
                  <th className="text-left p-3">Relic</th>
                  <th className="text-center p-3">State</th>
                  <th className="text-right p-3">Reports</th>
                  <th className="text-right p-3">Actual (median)</th>
                  <th className="text-right p-3">Δ vs MCOCHUB α</th>
                </tr>
              </thead>
              <tbody>
                {battlecastGroupList.map((g) => {
                  const actualMedian = median(g.reports.map((r) => r.rating));
                  const deltas = g.reports
                    .map((r) => r.delta)
                    .filter((d): d is number => d !== null);
                  const deltaMedian = deltas.length > 0 ? median(deltas) : null;
                  return (
                    <tr
                      key={`${g.relicId}|${g.rank}|${g.level}`}
                      className="border-t border-[var(--color-rule)]/40"
                    >
                      <td className="p-3 numeric text-xs">{g.relicId ?? '?'}</td>
                      <td className="p-3 text-center numeric text-xs">
                        {g.rank} sig {g.level}
                      </td>
                      <td className="p-3 text-right numeric">{g.reports.length}</td>
                      <td className="p-3 text-right numeric">{actualMedian}</td>
                      <td
                        className={`p-3 text-right numeric ${
                          deltaMedian === null || deltaMedian === 0
                            ? 'text-[var(--color-ink-soft)]'
                            : 'text-[var(--color-marvel-editorial)]'
                        }`}
                      >
                        {deltaMedian === null
                          ? '—'
                          : `${deltaMedian > 0 ? '+' : ''}${deltaMedian}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="editorial-heading text-lg">All relic reports (raw)</h3>
        <div className="overflow-x-auto border border-[var(--color-rule)] rounded">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]">
              <tr>
                <th className="text-left p-2">Submitted</th>
                <th className="text-left p-2">Kind</th>
                <th className="text-left p-2">Relic</th>
                <th className="text-center p-2">State</th>
                <th className="text-right p-2">Predicted</th>
                <th className="text-right p-2">Actual</th>
                <th className="text-right p-2">Δ</th>
                <th className="text-center p-2">α?</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr
                  key={r.key}
                  className="border-t border-[var(--color-rule)]/40"
                >
                  <td className="p-2 numeric text-[10px] text-[var(--color-ink-soft)]">
                    {r.createdAt.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="p-2 text-[var(--color-ink-soft)]">
                    {r.kind ?? 'statcast'}
                  </td>
                  <td className="p-2 numeric text-[10px]">
                    {r.relicId ?? '—'}
                  </td>
                  <td className="p-2 text-center numeric">
                    {r.rank} sig {r.level}
                  </td>
                  <td className="p-2 text-right numeric">
                    {r.predictedRating ?? '—'}
                  </td>
                  <td className="p-2 text-right numeric">{r.rating}</td>
                  <td
                    className={`p-2 text-right numeric ${
                      r.delta === null || r.delta === 0
                        ? 'text-[var(--color-ink-soft)]'
                        : 'text-[var(--color-marvel-editorial)]'
                    }`}
                  >
                    {r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta}`}
                  </td>
                  <td className="p-2 text-center text-[var(--color-ink-soft)]">
                    {r.isAlpha === true ? '✓' : r.isAlpha === false ? '—' : '?'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportsTable({ reports }: { reports: StoredReport[] }) {
  // Group by (championId, rank, sig, ascension) so repeated reports against
  // the same state surface as count + median delta — the actionable signal.
  type Group = {
    championId: string;
    rank: 3 | 4 | 5;
    sig: number;
    ascension: 'A0' | 'A1' | 'A2';
    reports: StoredReport[];
  };
  const groups = new Map<string, Group>();
  for (const r of reports) {
    const k = `${r.championId}|${r.rank}|${r.sig}|${r.ascension}`;
    const existing = groups.get(k);
    if (existing) existing.reports.push(r);
    else
      groups.set(k, {
        championId: r.championId,
        rank: r.rank,
        sig: r.sig,
        ascension: r.ascension,
        reports: [r],
      });
  }
  const groupList = [...groups.values()].sort(
    (a, b) => b.reports.length - a.reports.length,
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="editorial-heading text-xl">Grouped (signal strength)</h2>
        <p className="text-xs text-[var(--color-ink-soft)]">
          Multiple reports for the same state are stronger signal. Take the
          median actual; if reports are tight, fold into the seed.
        </p>
        <div className="overflow-x-auto border border-[var(--color-rule)] rounded">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]">
              <tr>
                <th className="text-left p-3">Champion</th>
                <th className="text-center p-3">State</th>
                <th className="text-right p-3">Reports</th>
                <th className="text-right p-3">Predicted (median)</th>
                <th className="text-right p-3">Actual (median)</th>
                <th className="text-right p-3">Δ (median)</th>
                <th className="text-right p-3">Δ range</th>
              </tr>
            </thead>
            <tbody>
              {groupList.map((g) => {
                const predictedMedian = median(g.reports.map((r) => r.predictedBhr));
                const actualMedian = median(g.reports.map((r) => r.actualBhr));
                const deltas = g.reports.map((r) => r.delta).sort((a, b) => a - b);
                const deltaMedian = median(deltas);
                const deltaMin = deltas[0]!;
                const deltaMax = deltas[deltas.length - 1]!;
                return (
                  <tr
                    key={`${g.championId}|${g.rank}|${g.sig}|${g.ascension}`}
                    className="border-t border-[var(--color-rule)]/40"
                  >
                    <td className="p-3 numeric text-xs">{g.championId}</td>
                    <td className="p-3 text-center numeric text-xs">
                      R{g.rank} {g.ascension} sig {g.sig}
                    </td>
                    <td className="p-3 text-right numeric">{g.reports.length}</td>
                    <td className="p-3 text-right numeric">{predictedMedian}</td>
                    <td className="p-3 text-right numeric">{actualMedian}</td>
                    <td
                      className={`p-3 text-right numeric font-medium ${
                        deltaMedian === 0
                          ? 'text-[var(--color-ink-soft)]'
                          : 'text-[var(--color-marvel-editorial)]'
                      }`}
                    >
                      {deltaMedian > 0 ? '+' : ''}
                      {deltaMedian}
                    </td>
                    <td className="p-3 text-right numeric text-xs text-[var(--color-ink-soft)]">
                      {deltaMin === deltaMax
                        ? '—'
                        : `${deltaMin > 0 ? '+' : ''}${deltaMin} … ${deltaMax > 0 ? '+' : ''}${deltaMax}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="editorial-heading text-xl">All reports (raw)</h2>
        <div className="overflow-x-auto border border-[var(--color-rule)] rounded">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]">
              <tr>
                <th className="text-left p-2">Submitted</th>
                <th className="text-left p-2">Champion</th>
                <th className="text-center p-2">State</th>
                <th className="text-right p-2">Predicted</th>
                <th className="text-right p-2">Actual</th>
                <th className="text-right p-2">Δ</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr
                  key={r.key}
                  className="border-t border-[var(--color-rule)]/40"
                >
                  <td className="p-2 numeric text-[10px] text-[var(--color-ink-soft)]">
                    {r.createdAt.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="p-2 numeric">{r.championId}</td>
                  <td className="p-2 text-center numeric">
                    R{r.rank} {r.ascension} sig {r.sig}
                  </td>
                  <td className="p-2 text-right numeric">{r.predictedBhr}</td>
                  <td className="p-2 text-right numeric">{r.actualBhr}</td>
                  <td
                    className={`p-2 text-right numeric ${
                      r.delta === 0
                        ? 'text-[var(--color-ink-soft)]'
                        : 'text-[var(--color-marvel-editorial)]'
                    }`}
                  >
                    {r.delta > 0 ? '+' : ''}
                    {r.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}
