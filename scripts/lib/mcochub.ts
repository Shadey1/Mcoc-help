/**
 * MCOCHUB access shared by the automated refresh scripts: the 7-star
 * prestige feed (one JSON GET), per-champion pages (the Ascendable
 * badge), and the name ladder that maps a feed row onto a seed id.
 */

export const FEED_URL = 'https://mcochub.insaneskull.com/data/prestige.json';
export const USER_AGENT = 'mcoc.help data refresher (free MCOC tool; contact via mcoc.help)';
export const SIG_ANCHORS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200] as const;

export type FeedRow = {
  slug: string;
  name: string;
  class?: string;
  img?: string;
  url?: string;
  sigs: Record<string, number>;
};

export async function fetchFeed(): Promise<FeedRow[]> {
  const res = await fetch(FEED_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${FEED_URL} returned HTTP ${res.status}`);
  const payload = (await res.json()) as { tier: number; rank: number; rows: FeedRow[] };
  if (payload.tier !== 7 || payload.rank !== 5 || !Array.isArray(payload.rows) || payload.rows.length < 200) {
    throw new Error(`Unexpected MCOCHUB feed shape (tier ${payload.tier}, rank ${payload.rank}, ${payload.rows?.length} rows)`);
  }
  return payload.rows;
}

/** Lowercase alphanumerics only: "Spider-Man (Stark)" and "spiderman_stark" agree. */
export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Seed-style id from a display name: "Green Goblin (Stellar-Forged)" -> "green-goblin-stellar-forged". */
export function idFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function findSeedMatch<T extends { id: string; name: string }>(row: FeedRow, champions: T[]): T | null {
  const want = new Set([normaliseName(row.slug), normaliseName(row.name)]);
  return champions.find((c) => want.has(normaliseName(c.id)) || want.has(normaliseName(c.name))) ?? null;
}

/** True when the champion's MCOCHUB page carries the Ascendable badge.
 *  The badge is rendered server-side only for ascendable champions. */
export async function isAscendable(row: FeedRow): Promise<boolean> {
  const url = row.url ?? `https://mcochub.insaneskull.com/champions/${row.slug}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  const html = await res.text();
  // A page with no champion header means the layout changed; refuse to
  // read "no badge" as "not ascendable".
  if (!/<h1[^>]*>/.test(html)) throw new Error(`${url}: page layout not recognised`);
  return html.includes('aria-label="Ascendable"');
}
