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
import {
  battlecast6Key,
  clearRelicOverride as clearOp,
  loadRelicOverrides,
  saveRelicOverrides,
  setRelicOverride as setOp,
  statcast6Key,
  type RelicOverrideMap,
} from './relic-overrides';
import type { R6StatcastLevel, R6StatcastRank } from '@prestige-tools/engine';

type RelicOverridesContextValue = {
  overrides: RelicOverrideMap;
  loaded: boolean;
  /** Pin the 6★ statcast value at this exact (rank, sig). */
  setStatcast6: (rank: R6StatcastRank, sig: R6StatcastLevel, value: number) => void;
  /** Pin a specific 6★ battlecast's value at (rank, sig). */
  setBattlecast6: (
    relicId: string,
    rank: R6StatcastRank,
    sig: R6StatcastLevel,
    value: number,
  ) => void;
  clearStatcast6: (rank: R6StatcastRank, sig: R6StatcastLevel) => void;
  clearBattlecast6: (relicId: string, rank: R6StatcastRank, sig: R6StatcastLevel) => void;
  getStatcast6: (rank: R6StatcastRank, sig: R6StatcastLevel) => number | undefined;
  getBattlecast6: (
    relicId: string,
    rank: R6StatcastRank,
    sig: R6StatcastLevel,
  ) => number | undefined;
};

const Ctx = createContext<RelicOverridesContextValue | null>(null);

export function RelicOverridesProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<RelicOverrideMap>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setOverrides(loadRelicOverrides());
    setLoaded(true);
  }, []);

  const setStatcast6 = useCallback(
    (rank: R6StatcastRank, sig: R6StatcastLevel, value: number) => {
      setOverrides((prev) => {
        const next = setOp(prev, statcast6Key(rank, sig), value);
        saveRelicOverrides(next);
        return next;
      });
    },
    [],
  );

  const setBattlecast6 = useCallback(
    (relicId: string, rank: R6StatcastRank, sig: R6StatcastLevel, value: number) => {
      setOverrides((prev) => {
        const next = setOp(prev, battlecast6Key(relicId, rank, sig), value);
        saveRelicOverrides(next);
        return next;
      });
    },
    [],
  );

  const clearStatcast6 = useCallback(
    (rank: R6StatcastRank, sig: R6StatcastLevel) => {
      setOverrides((prev) => {
        const next = clearOp(prev, statcast6Key(rank, sig));
        saveRelicOverrides(next);
        return next;
      });
    },
    [],
  );

  const clearBattlecast6 = useCallback(
    (relicId: string, rank: R6StatcastRank, sig: R6StatcastLevel) => {
      setOverrides((prev) => {
        const next = clearOp(prev, battlecast6Key(relicId, rank, sig));
        saveRelicOverrides(next);
        return next;
      });
    },
    [],
  );

  const value = useMemo<RelicOverridesContextValue>(
    () => ({
      overrides,
      loaded,
      setStatcast6,
      setBattlecast6,
      clearStatcast6,
      clearBattlecast6,
      getStatcast6: (rank, sig) => overrides.get(statcast6Key(rank, sig)),
      getBattlecast6: (id, rank, sig) =>
        overrides.get(battlecast6Key(id, rank, sig)),
    }),
    [overrides, loaded, setStatcast6, setBattlecast6, clearStatcast6, clearBattlecast6],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read the relic-overrides context. Returns an empty no-op stub outside
 *  the provider tree so components render safely. */
export function useRelicOverrides(): RelicOverridesContextValue {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  const empty = new Map<string, number>();
  return {
    overrides: empty,
    loaded: true,
    setStatcast6: () => {},
    setBattlecast6: () => {},
    clearStatcast6: () => {},
    clearBattlecast6: () => {},
    getStatcast6: () => undefined,
    getBattlecast6: () => undefined,
  };
}
