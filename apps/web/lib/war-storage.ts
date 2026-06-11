'use client';

import type { Ascension, Rank } from '@prestige-tools/engine';

const STORAGE_KEY = 'mcoc-help-war-v1';

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

export type WarConfig = {
  /** Champion IDs the officer has ticked as war-worthy defenders. Alliance-wide. */
  pool: string[];
  /** Minimum acceptable state. Applied identically to every BG. */
  floor: { rank: Rank; ascension: Ascension };
  /** Three battlegroups, up to 10 players each. */
  bgs: WarBgs;
};

const PLAYERS_PER_BG = 10;
export const MAX_PLAYERS_PER_BG = PLAYERS_PER_BG;

const DEFAULT_CONFIG: WarConfig = {
  pool: [],
  floor: { rank: 4, ascension: 'A0' },
  bgs: [[], [], []],
};

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

/**
 * Load the war planner config from localStorage. Returns defaults if none
 * saved or parsing fails (defensive — schema may evolve).
 *
 * Migrates legacy v1 configs that stored a single `players: WarPlayerInput[]`
 * into `bgs[0]` so officers don't lose their saved BG1 roster across the
 * upgrade.
 */
export function loadWarConfig(): WarConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<WarConfig> & {
      players?: unknown;
    };

    // Migration: legacy single-list `players` becomes BG1.
    let bgs: WarBgs;
    if (Array.isArray(parsed.bgs) && parsed.bgs.length >= 1) {
      bgs = [
        sanitiseBg(parsed.bgs[0]),
        sanitiseBg(parsed.bgs[1] ?? []),
        sanitiseBg(parsed.bgs[2] ?? []),
      ];
    } else if (Array.isArray(parsed.players)) {
      bgs = [sanitiseBg(parsed.players), [], []];
    } else {
      bgs = [[], [], []];
    }

    return {
      pool: Array.isArray(parsed.pool)
        ? parsed.pool.filter((id): id is string => typeof id === 'string')
        : [],
      // Ascension is normalised to A0 — the UI floor axis is rank-only and
      // the engine now uses effective rank for ordering. Saved A1/A2 floors
      // from earlier alpha builds are discarded.
      floor:
        parsed.floor &&
        typeof parsed.floor.rank === 'number' &&
        parsed.floor.rank >= 3 &&
        parsed.floor.rank <= 6
          ? { rank: parsed.floor.rank as Rank, ascension: 'A0' }
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
