'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ALL_BANDS_ON,
  IMMUNITY_EFFECTS,
  coverAllButOne,
  effectRosterCounts,
  isEffectivelyImmune,
  queryImmunities,
  type BandFilter,
  type BandKind,
  type Champion,
  type EffectName,
  type ImmunityBand,
  type ImmunityDataset,
  type ImmunityHit,
  type QueryMode,
} from '@prestige-tools/engine';
import { loadRoster } from '../lib/roster-storage';
import { ChampionPortrait } from './champion-portrait';
import { displayRarity } from '../lib/champion-rarity';

type ImmunitiesViewProps = {
  dataset: ImmunityDataset;
  champions: Champion[];
  dataMeta: { source: string; capturedAt: string; championCount: number };
};

type Scope = 'roster' | 'all';

/**
 * The user query controls sit at the top; results below. Both operate on
 * the same set of hits — the query pipeline picks the pool (roster vs
 * all), the mode (ALL vs ANY), the band filter, then feeds
 * queryImmunities. Everything is memoised on those inputs.
 *
 * Roster is read on mount from the same localStorage key that
 * roster-storage.ts owns; hydration flag guards against SSR mismatch.
 */
export function ImmunitiesView({
  dataset,
  champions,
  dataMeta,
}: ImmunitiesViewProps) {
  const [selected, setSelected] = useState<EffectName[]>([]);
  const [mode, setMode] = useState<QueryMode>('all');
  const [scope, setScope] = useState<Scope>('roster');
  const [bandFilter, setBandFilter] = useState<BandFilter>({ ...ALL_BANDS_ON });
  const [rosterIds, setRosterIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const r = loadRoster();
    setRosterIds(r.champions.map((s) => s.championId));
    setHydrated(true);
  }, []);

  const championLookup = useMemo(() => {
    const m = new Map<string, Champion>();
    for (const c of champions) m.set(c.id, c);
    return m;
  }, [champions]);

  const allIds = useMemo(
    () => champions.map((c) => c.id),
    [champions],
  );

  const pool = scope === 'roster' ? rosterIds : allIds;

  const counts = useMemo(
    () => effectRosterCounts(dataset, pool, bandFilter),
    [dataset, pool, bandFilter],
  );

  const hits = useMemo(() => {
    if (selected.length === 0) return [];
    return queryImmunities(dataset, pool, selected, mode, bandFilter);
  }, [dataset, pool, selected, mode, bandFilter]);

  const nearMisses = useMemo(() => {
    if (mode !== 'all' || selected.length < 2) return [];
    return coverAllButOne(dataset, pool, selected, bandFilter);
  }, [dataset, pool, selected, mode, bandFilter]);

  const fullCoverers = mode === 'all' ? hits : [];
  const impactCount = mode === 'all' ? fullCoverers.length : hits.length;

  function toggleEffect(eff: EffectName) {
    setSelected((prev) =>
      prev.includes(eff) ? prev.filter((e) => e !== eff) : [...prev, eff],
    );
  }
  function toggleBand(k: BandKind) {
    setBandFilter((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  const showList = mode === 'all' ? fullCoverers : hits;
  const rosterEmpty = hydrated && scope === 'roster' && rosterIds.length === 0;
  const noCoverageData = pool.some((id) => dataset[id] !== undefined);

  return (
    <div className="space-y-6">
      {/* Query bar — the "damage on the path" chip row */}
      <section className="pb-5 border-b border-[var(--color-rule)]">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-ink-soft)]">
            Damage on the path
          </span>
          <div className="inline-flex border border-[var(--color-rule)] rounded overflow-hidden">
            {(['all', 'any'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`font-mono text-[11px] px-3 py-1.5 transition-colors ${
                  mode === m
                    ? 'bg-[var(--color-ink)] text-[var(--color-paper)]'
                    : 'bg-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
                }`}
                aria-pressed={mode === m}
              >
                {m === 'all' ? 'Need ALL' : 'Need ANY'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {IMMUNITY_EFFECTS.map((eff) => {
            const isSelected = selected.includes(eff);
            const n = counts[eff];
            return (
              <button
                key={eff}
                type="button"
                onClick={() => toggleEffect(eff)}
                className={`font-mono text-xs px-2.5 py-1.5 border rounded transition-colors ${
                  isSelected
                    ? 'bg-[var(--color-marvel-impact)] border-[var(--color-marvel-impact)] text-white'
                    : 'bg-[var(--color-paper-card)] border-[var(--color-rule)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:border-[var(--color-ink-soft)]'
                }`}
              >
                {eff}
                <span className={`ml-1.5 text-[10px] ${isSelected ? 'opacity-80' : 'opacity-50'} numeric`}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Scope + band filters */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="inline-flex border border-[var(--color-rule)] rounded overflow-hidden">
          {(['roster', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`font-mono text-xs px-3 py-1.5 transition-colors ${
                scope === s
                  ? 'bg-[var(--color-paper)] text-[var(--color-ink)]'
                  : 'bg-[var(--color-paper-card)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
              }`}
              aria-pressed={scope === s}
            >
              {s === 'roster' ? 'My roster' : 'All champs'}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(
            [
              { k: 'immune', label: 'immune' },
              { k: 'resist', label: 'resist %' },
              { k: 'mechanic', label: 'purify / duration' },
              { k: 'synergy', label: 'synergy' },
            ] as const
          ).map((b) => (
            <button
              key={b.k}
              type="button"
              onClick={() => toggleBand(b.k)}
              className={`font-mono text-[11px] px-2.5 py-1 border rounded transition-colors ${
                bandFilter[b.k]
                  ? 'bg-[var(--color-paper-soft)] border-[var(--color-ink-soft)] text-[var(--color-ink)]'
                  : 'bg-[var(--color-paper-card)] border-[var(--color-rule)] text-[var(--color-ink-soft)]/70 line-through'
              }`}
              aria-pressed={bandFilter[b.k]}
            >
              {b.label}
            </button>
          ))}
        </div>
      </section>

      {/* Impact readout + result list */}
      {selected.length === 0 ? (
        <p className="max-w-lg text-[var(--color-ink-soft)] italic pt-2">
          Pick the damage types a path or defender throws at you.{' '}
          <b className="font-semibold not-italic text-[var(--color-ink)]">
            Need ALL
          </b>{' '}
          shows the champions who shrug off every debuff on one body —
          bring them and take the fight.{' '}
          <b className="font-semibold not-italic text-[var(--color-ink)]">
            Need ANY
          </b>{' '}
          shows everyone safe against at least one, useful for spotting
          gaps.
        </p>
      ) : (
        <>
          <div className="pt-2">
            <div className="flex items-baseline gap-3">
              <span
                className={`font-mono text-5xl font-bold leading-none numeric ${
                  impactCount === 0
                    ? 'text-[var(--color-marvel-editorial)]'
                    : 'text-[var(--color-ink)]'
                }`}
              >
                {impactCount}
              </span>
              <span className="text-[var(--color-ink-soft)] text-[15px]">
                {mode === 'all' ? (
                  <>
                    champion{impactCount === 1 ? '' : 's'} shrug off{' '}
                    <b className="font-semibold text-[var(--color-ink)]">
                      {selected.join(' + ')}
                    </b>{' '}
                    {selected.length > 1
                      ? 'all at once — take the fight'
                      : '— safe to bring'}
                  </>
                ) : (
                  <>
                    champion{impactCount === 1 ? '' : 's'} shrug off at least one of{' '}
                    <b className="font-semibold text-[var(--color-ink)]">
                      {selected.join(', ')}
                    </b>
                  </>
                )}
              </span>
            </div>
          </div>

          {rosterEmpty && (
            <p className="text-sm italic text-[var(--color-ink-soft)]">
              Your roster is empty. Add champs on{' '}
              <Link
                href="/roster/"
                className="underline hover:text-[var(--color-marvel-impact)]"
              >
                Roster
              </Link>{' '}
              or switch to <b>All champs</b> above.
            </p>
          )}

          {showList.length > 0 && (
            <ResultsList
              hits={showList}
              selected={selected}
              championLookup={championLookup}
              mode={mode}
            />
          )}

          {mode === 'all' && nearMisses.length > 0 && (
            <>
              <div className="mt-6 pb-1 border-b border-[var(--color-rule)] font-mono text-[11px] uppercase tracking-widest text-[var(--color-ink-soft)]">
                Cover all but one — pair these on the path
              </div>
              <ResultsList
                hits={nearMisses}
                selected={selected}
                championLookup={championLookup}
                mode="all"
              />
            </>
          )}

          {impactCount === 0 && mode === 'all' && (
            <p className="text-sm italic text-[var(--color-ink-soft)] pt-1">
              No single champion covers all of these
              {noCoverageData ? '' : ' (no immunity data yet for this pool)'}.
              {nearMisses.length > 0
                ? ' Check the pair-on-the-path list below.'
                : ''}
            </p>
          )}
        </>
      )}

      {/* Legend + mastery caveat */}
      <div className="pt-4 border-t border-[var(--color-rule)] space-y-3">
        <Legend />
        <p className="text-xs text-[var(--color-ink-soft)] max-w-2xl leading-relaxed">
          Note:{' '}
          <b className="font-medium text-[var(--color-ink)]">
            full immune blocks the debuff entirely
          </b>{' '}
          — it never applies.{' '}
          <b className="font-medium text-[var(--color-ink)]">
            ≥100% resist takes no damage but the debuff still applies
          </b>
          , so masteries and node effects that key off debuffs (Willpower
          healing, Inequity, &quot;opponent has a debuff&quot; triggers)
          still fire. On some paths that matters; the number stays visible so
          you can judge.
        </p>
        <p className="text-[11px] text-[var(--color-ink-soft)]/80">
          Data: {dataMeta.source} · {dataMeta.championCount} champions ·
          captured {dataMeta.capturedAt}. Full-roster transcription in progress.
        </p>
      </div>
    </div>
  );
}

type ResultsListProps = {
  hits: ImmunityHit[];
  selected: EffectName[];
  championLookup: Map<string, Champion>;
  mode: QueryMode;
};

function ResultsList({
  hits,
  selected,
  championLookup,
  mode,
}: ResultsListProps) {
  return (
    <div className="flex flex-col divide-y divide-[var(--color-rule)]/60">
      {hits.map((h) => {
        const c = championLookup.get(h.championId);
        const isFull = h.covered === selected.length;
        return (
          <div
            key={h.championId}
            className={`grid grid-cols-[44px_1fr] sm:grid-cols-[44px_1fr_auto] items-center gap-3 py-2.5 px-1 ${
              mode === 'all' && isFull
                ? 'bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-marvel-impact)_9%,transparent),transparent_70%)]'
                : ''
            }`}
          >
            <ChampionCell champion={c} championId={h.championId} />
            <NameCell champion={c} championId={h.championId} />
            <div className="col-span-2 sm:col-span-1 flex flex-wrap gap-1.5 justify-start sm:justify-end pl-[56px] sm:pl-0">
              {selected.map((eff) => (
                <Badge key={eff} eff={eff} mark={h.marks[eff] ?? null} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChampionCell({
  champion,
  championId,
}: {
  champion: Champion | undefined;
  championId: string;
}) {
  if (!champion) {
    return (
      <div className="w-11 h-11 rounded-full bg-[var(--color-paper-card)] border border-[var(--color-rule)] flex items-center justify-center text-[10px] font-mono text-[var(--color-ink-soft)]">
        ?
      </div>
    );
  }
  return (
    <div className="w-11 h-11">
      <ChampionPortrait
        name={champion.name}
        klass={champion.class}
        portraitUrl={champion.portraitUrl ?? null}
        fill
        rarity={displayRarity(champion)}
        showClassOverlay={Boolean(champion.portraitUrl)}
      />
    </div>
  );
}

function NameCell({
  champion,
  championId,
}: {
  champion: Champion | undefined;
  championId: string;
}) {
  if (!champion) {
    return (
      <span className="text-sm">
        <span className="font-medium">{championId}</span>
      </span>
    );
  }
  return (
    <Link
      href={`/champions/${champion.id}/`}
      className="text-[15px] font-medium hover:text-[var(--color-marvel-impact)] transition-colors"
    >
      {champion.name}
      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-soft)]">
        {champion.class}
      </span>
    </Link>
  );
}

function Badge({ eff, mark }: { eff: EffectName; mark: ImmunityBand | null }) {
  if (!mark) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] px-2 py-[3px] rounded border border-dashed border-[var(--color-rule)] text-[var(--color-ink-soft)]/70">
        <span className="opacity-60">{eff}</span> —
      </span>
    );
  }
  if (mark.band === 'immune') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] px-2 py-[3px] rounded bg-[var(--color-paper)] text-[var(--color-marvel-editorial)] border border-[var(--color-ink)]/20 font-medium">
        <span className="opacity-60 text-[var(--color-ink-soft)]">{eff}</span> immune
      </span>
    );
  }
  if (mark.band === 'resist') {
    const eff100 = isEffectivelyImmune(mark);
    return (
      <span
        className={`inline-flex items-center gap-1 font-mono text-[10.5px] px-2 py-[3px] rounded border ${
          eff100
            ? 'border-amber-500 text-amber-700 font-medium'
            : 'border-amber-400/60 text-amber-600'
        }`}
        title={eff100 ? 'Effective immunity — no damage, but debuff still applies' : undefined}
      >
        <span className="opacity-60">{eff}</span> {mark.qual}
        {eff100 ? ' · no dmg' : ''}
      </span>
    );
  }
  if (mark.band === 'mechanic') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] px-2 py-[3px] rounded border border-sky-500/60 text-sky-700">
        <span className="opacity-60">{eff}</span> {mark.qual}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[10.5px] px-2 py-[3px] rounded border border-[var(--color-marvel-editorial)] text-[var(--color-marvel-editorial)]"
      title={`Only when ${mark.partner} is on the squad`}
    >
      <span className="opacity-60">{eff}</span> syn: {mark.partner}
    </span>
  );
}

function Legend() {
  const items: Array<{ label: string; cls: string }> = [
    { label: 'full immune', cls: 'bg-[var(--color-paper)] border-[var(--color-ink)]/20' },
    { label: '≥100% resist — no damage', cls: 'border border-amber-500' },
    { label: 'partial resist %', cls: 'border border-amber-400/60' },
    { label: 'purify / duration cut', cls: 'border border-sky-500/60' },
    { label: 'needs synergy partner', cls: 'border border-[var(--color-marvel-editorial)]' },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11px] text-[var(--color-ink-soft)]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block w-5 h-3 rounded-sm ${it.cls}`} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
