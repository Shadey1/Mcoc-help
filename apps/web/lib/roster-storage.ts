'use client';

import type { Roster } from '@prestige-tools/engine';

const STORAGE_KEY = 'mcoc-help-roster-v1';

/**
 * Load the saved roster from localStorage. Returns empty roster if none saved
 * or if parsing fails (defensive — schema may evolve).
 */
export function loadRoster(): Roster {
  if (typeof window === 'undefined') return { champions: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { champions: [] };
    const parsed = JSON.parse(raw) as Roster;
    if (!parsed || !Array.isArray(parsed.champions)) return { champions: [] };
    return parsed;
  } catch {
    return { champions: [] };
  }
}

/**
 * Save the roster to localStorage.
 */
export function saveRoster(roster: Roster): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
}

/**
 * Encode the roster as a URL hash fragment for sharing.
 * Format is intentionally compact: base64 of a JSON payload.
 */
export function encodeRosterToHash(roster: Roster): string {
  if (typeof window === 'undefined') return '';
  const json = JSON.stringify(roster);
  // btoa needs latin-1 — UTF-8 safe encode
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return window.btoa(binary);
}

/**
 * Decode a roster from a URL hash fragment. Returns null if invalid.
 */
export function decodeRosterFromHash(hash: string): Roster | null {
  if (typeof window === 'undefined') return null;
  try {
    const binary = window.atob(hash);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as Roster;
    if (!parsed || !Array.isArray(parsed.champions)) return null;
    return parsed;
  } catch {
    return null;
  }
}
