'use client';

import type { Ascension, Rank } from '@prestige-tools/engine';

const STORAGE_KEY = 'mcoc-help-war-v1';

export type WarPlayerInput = {
  /** Pasted share URL — e.g. https://mcoc.help/r?d=abc123 */
  url: string;
  /** Officer-set in-game name. Defaults to whatever the share payload carries. */
  name: string;
};

export type WarConfig = {
  /** Champion IDs the officer has ticked as war-worthy defenders. */
  pool: string[];
  /** Minimum acceptable state. */
  floor: { rank: Rank; ascension: Ascension };
  /** Up to 10 alliance member rosters to load. */
  players: WarPlayerInput[];
};

const DEFAULT_CONFIG: WarConfig = {
  pool: [],
  floor: { rank: 4, ascension: 'A0' },
  players: [],
};

/**
 * Load the war planner config from localStorage. Returns defaults if none
 * saved or parsing fails (defensive — schema may evolve).
 */
export function loadWarConfig(): WarConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<WarConfig>;
    return {
      pool: Array.isArray(parsed.pool) ? parsed.pool.filter((id) => typeof id === 'string') : [],
      floor:
        parsed.floor &&
        typeof parsed.floor.rank === 'number' &&
        (parsed.floor.rank === 3 || parsed.floor.rank === 4 || parsed.floor.rank === 5) &&
        (parsed.floor.ascension === 'A0' ||
          parsed.floor.ascension === 'A1' ||
          parsed.floor.ascension === 'A2')
          ? { rank: parsed.floor.rank, ascension: parsed.floor.ascension }
          : DEFAULT_CONFIG.floor,
      players: Array.isArray(parsed.players)
        ? parsed.players
            .filter(
              (p): p is WarPlayerInput =>
                p !== null &&
                typeof p === 'object' &&
                typeof (p as WarPlayerInput).url === 'string' &&
                typeof (p as WarPlayerInput).name === 'string',
            )
            .slice(0, 10)
        : [],
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveWarConfig(config: WarConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
