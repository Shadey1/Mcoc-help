/**
 * Format a BHR or prestige value for display. Always uses tabular
 * thousand-separators — matches the in-game prestige page convention.
 */
export function formatBHR(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Format a prestige delta — always signed, always non-fractional.
 * Used pervasively in recommendations & ceiling views.
 */
export function formatDelta(n: number): string {
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded.toLocaleString('en-US')}`;
  if (rounded < 0) return rounded.toLocaleString('en-US');
  return '±0';
}

/**
 * Format ascension as a compact badge — "A0", "A1", "A2".
 */
export function formatAscension(asc: 'A0' | 'A1' | 'A2'): string {
  return asc;
}

/**
 * Format rank as a compact label — "R3", "R4", "R5".
 */
export function formatRank(rank: number): string {
  return `R${rank}`;
}
