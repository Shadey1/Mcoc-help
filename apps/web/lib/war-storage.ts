'use client';

import type { Ascension, Rank, WarTier } from '@prestige-tools/engine';

const STORAGE_KEY = 'mcoc-help-war-v2';
const LEGACY_STORAGE_KEY = 'mcoc-help-war-v1';

export type WarPlayerInput = {
  /** Pasted share URL — e.g. https://mcoc.help/r?d=abc123 */
  url: string;
  /** Officer-set in-game name. Defaults to whatever the share payload carries. */
  name: string;
};

/**
 * Three alliance war battlegroups. Each BG runs an independent placement
 * pass against the shared pool — a player sits in exactly one BG per war.
 * Stored as a fixed-length tuple so consumers don't have to bounds-check.
 */
export type WarBgs = [WarPlayerInput[], WarPlayerInput[], WarPlayerInput[]];

/**
 * Tiered defender pool. Three disjoint lists; algorithm fills Strong
 * placements first, then Mid, then Base. A champion id should appear in
 * at most one list — the tickbox UI enforces this client-side.
 */
export type WarPool = {
  strong: string[];
  mid: string[];
  base: string[];
};

export type WarConfig = {
  pool: WarPool;
  /** Minimum acceptable state. Applied identically to every BG. */
  floor: { rank: Rank; ascension: Ascension };
  /** Three battlegroups, up to 10 players each. */
  bgs: WarBgs;
};

const PLAYERS_PER_BG = 10;
export const MAX_PLAYERS_PER_BG = PLAYERS_PER_BG;

const EMPTY_POOL: WarPool = { strong: [], mid: [], base: [] };
const DEFAULT_CONFIG: WarConfig = {
  pool: EMPTY_POOL,
  floor: { rank: 4, ascension: 'A0' },
  bgs: [[], [], []],
};

/** Total count across all tiers. */
export function poolSize(pool: WarPool): number {
  return pool.strong.length + pool.mid.length + pool.base.length;
}

/** Build a tier-keyed Map suitable as engine input. */
export function poolToTierMap(pool: WarPool): Map<string, WarTier> {
  const m = new Map<string, WarTier>();
  for (const id of pool.strong) m.set(id, 'strong');
  for (const id of pool.mid) m.set(id, 'mid');
  for (const id of pool.base) m.set(id, 'base');
  return m;
}

/** Set of every championId in any tier — for membership checks in UI. */
export function poolIdSet(pool: WarPool): Set<string> {
  const s = new Set<string>();
  for (const id of pool.strong) s.add(id);
  for (const id of pool.mid) s.add(id);
  for (const id of pool.base) s.add(id);
  return s;
}

/**
 * Set a single champion's tier in the pool. Removes from any other tier
 * first so a champion only ever appears in one list. Passing tier=null
 * removes it from the pool entirely.
 */
export function setPoolTier(
  pool: WarPool,
  championId: string,
  tier: WarTier | null,
): WarPool {
  const strong = pool.strong.filter((id) => id !== championId);
  const mid = pool.mid.filter((id) => id !== championId);
  const base = pool.base.filter((id) => id !== championId);
  if (tier === 'strong') strong.push(championId);
  else if (tier === 'mid') mid.push(championId);
  else if (tier === 'base') base.push(championId);
  return {
    strong: strong.sort(),
    mid: mid.sort(),
    base: base.sort(),
  };
}

function sanitisePlayerRow(value: unknown): WarPlayerInput | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<WarPlayerInput>;
  if (typeof v.url !== 'string' || typeof v.name !== 'string') return null;
  return { url: v.url, name: v.name };
}

function sanitiseBg(value: unknown): WarPlayerInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(sanitisePlayerRow)
    .filter((p): p is WarPlayerInput => p !== null)
    .slice(0, PLAYERS_PER_BG);
}

function sanitisePool(value: unknown): WarPool {
  if (!value || typeof value !== 'object') return EMPTY_POOL;
  const v = value as Partial<Record<keyof WarPool, unknown>>;
  const cleanList = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string')
      : [];
  return {
    strong: cleanList(v.strong),
    mid: cleanList(v.mid),
    base: cleanList(v.base),
  };
}

/**
 * Load the war planner config from localStorage. Returns defaults if none
 * saved or parsing fails (defensive — schema may evolve).
 *
 * v2 schema introduces tiered pools (Strong/Mid/Base). v1 pools (flat
 * string lists) are intentionally NOT migrated — the user explicitly opted
 * to wipe and rebuild from scratch when the tier feature shipped. The v1
 * localStorage key is left untouched so any side-channel reads still work,
 * but the planner reads v2 only.
 */
export function loadWarConfig(): WarConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Cold-start case: NO v2 data. If a v1 record exists, preserve BG
      // rosters + floor (those don't change shape between schemas) and
      // start with an empty tiered pool — the user rebuilds it.
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacy) return DEFAULT_CONFIG;
      const legacyParsed = JSON.parse(legacy) as Partial<{
        floor: { rank: Rank; ascension: Ascension };
        bgs: unknown[];
        players: unknown;
      }>;
      let bgs: WarBgs;
      if (Array.isArray(legacyParsed.bgs) && legacyParsed.bgs.length >= 1) {
        bgs = [
          sanitiseBg(legacyParsed.bgs[0]),
          sanitiseBg(legacyParsed.bgs[1] ?? []),
          sanitiseBg(legacyParsed.bgs[2] ?? []),
        ];
      } else if (Array.isArray(legacyParsed.players)) {
        bgs = [sanitiseBg(legacyParsed.players), [], []];
      } else {
        bgs = [[], [], []];
      }
      return {
        pool: EMPTY_POOL,
        floor:
          legacyParsed.floor &&
          typeof legacyParsed.floor.rank === 'number' &&
          legacyParsed.floor.rank >= 3 &&
          legacyParsed.floor.rank <= 6
            ? {
                rank: legacyParsed.floor.rank,
                ascension:
                  legacyParsed.floor.ascension === 'A1' ||
                  legacyParsed.floor.ascension === 'A2'
                    ? legacyParsed.floor.ascension
                    : 'A0',
              }
            : DEFAULT_CONFIG.floor,
        bgs,
      };
    }
    const parsed = JSON.parse(raw) as Partial<WarConfig>;

    let bgs: WarBgs;
    if (Array.isArray(parsed.bgs) && parsed.bgs.length >= 1) {
      bgs = [
        sanitiseBg(parsed.bgs[0]),
        sanitiseBg(parsed.bgs[1] ?? []),
        sanitiseBg(parsed.bgs[2] ?? []),
      ];
    } else {
      bgs = [[], [], []];
    }

    return {
      pool: sanitisePool(parsed.pool),
      floor:
        parsed.floor &&
        typeof parsed.floor.rank === 'number' &&
        parsed.floor.rank >= 3 &&
        parsed.floor.rank <= 6
          ? {
              rank: parsed.floor.rank as Rank,
              ascension:
                parsed.floor.ascension === 'A1' ||
                parsed.floor.ascension === 'A2'
                  ? parsed.floor.ascension
                  : 'A0',
            }
          : DEFAULT_CONFIG.floor,
      bgs,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveWarConfig(config: WarConfig): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/**
 * Encode a BG's player rows into a URL-safe base64 payload for sharing.
 * Tiny enough (10 short URLs + names ~ <1KB) to round-trip in a query
 * string without needing the KV-backed share infra.
 */
export function encodeBgShare(rows: WarPlayerInput[]): string {
  const json = JSON.stringify(
    rows.filter((r) => r.url.trim().length > 0),
  );
  if (typeof window === 'undefined') return '';
  // btoa needs latin-1; encode UTF-8 first for safety even though URLs
  // usually stay ASCII.
  const b64 = window.btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a BG-share payload from a URL query value. Returns null if
 * malformed.
 */
export function decodeBgShare(value: string): WarPlayerInput[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const json = decodeURIComponent(escape(window.atob(b64 + pad)));
    const parsed = JSON.parse(json) as unknown;
    return sanitiseBg(parsed);
  } catch {
    return null;
  }
}
