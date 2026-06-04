'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Ascension, Rank } from '@prestige-tools/engine';
import {
  clearOverride as clearOverrideOp,
  hasOverride,
  loadOverrides,
  saveOverrides,
  setOverride as setOverrideOp,
  type BHROverrideRecord,
} from './bhr-overrides';

/**
 * React context wrapping the user's BHR override map. Single source of
 * truth — any consumer reads the same map, and a write here re-renders
 * every consumer simultaneously (roster table, recommendations view,
 * roster summary, ceiling view).
 *
 * Mount the provider once at the app/route level; use the hook anywhere
 * within. The provider lazily loads from localStorage on mount, so SSR
 * sees `null` until hydration and consumers should guard on `loaded`.
 */

type BHROverridesContextValue = {
  overrides: Map<string, number>;
  loaded: boolean;
  hasOverride: (
    championId: string,
    rank: Rank,
    sig: number,
    ascension: Ascension,
  ) => boolean;
  setOverride: (record: BHROverrideRecord) => void;
  clearOverride: (
    championId: string,
    rank: Rank,
    sig: number,
    ascension: Ascension,
  ) => void;
};

const Ctx = createContext<BHROverridesContextValue | null>(null);

export function BHROverridesProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setOverrides(loadOverrides());
    setLoaded(true);
  }, []);

  const set = useCallback((record: BHROverrideRecord) => {
    setOverrides((prev) => {
      const next = setOverrideOp(prev, record);
      saveOverrides(next);
      return next;
    });
  }, []);

  const clear = useCallback(
    (championId: string, rank: Rank, sig: number, ascension: Ascension) => {
      setOverrides((prev) => {
        const next = clearOverrideOp(prev, championId, rank, sig, ascension);
        saveOverrides(next);
        return next;
      });
    },
    [],
  );

  const value = useMemo<BHROverridesContextValue>(
    () => ({
      overrides,
      loaded,
      hasOverride: (championId, rank, sig, ascension) =>
        hasOverride(overrides, championId, rank, sig, ascension),
      setOverride: set,
      clearOverride: clear,
    }),
    [overrides, loaded, set, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Read the overrides context. Components outside the provider get an
 * always-empty map — safe fallback that keeps the engine API happy
 * without forcing every component to be inside the provider tree.
 */
export function useBHROverrides(): BHROverridesContextValue {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  // No provider — return a no-op stub. Lets components render outside the
  // provider tree (e.g. shared-roster-view loading someone else's data)
  // without errors. Writes are silent no-ops.
  const empty = new Map<string, number>();
  return {
    overrides: empty,
    loaded: true,
    hasOverride: () => false,
    setOverride: () => {},
    clearOverride: () => {},
  };
}
