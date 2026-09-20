/**
 * mcoc.gg per-rank prestige curves. MCOCHUB only publishes R5; the game
 * stores a separate R4 table per champion, and R5 x 0.8431 is off by
 * 10-30 BHR for many of them. mcoc.gg serves the real R4 table as JSON.
 */

import { SIG_ANCHORS, USER_AGENT, normaliseName } from './mcochub.js';

const BASE = 'https://mcoc.gg';

type MasterEntry = { id: number; name: string; image: string };
type PrestigeFile = { data: Array<{ rarity: number; rank: number; values: number[] }> };
export type Curve = Record<string, number>;

// The 500 KB champion list routinely takes 10-15 s to arrive.
const TIMEOUT_MS = 60_000;

async function getJson<T>(url: string): Promise<T | null> {
  const get = () =>
    fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const res = await get().catch(get);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

let master: Map<string, MasterEntry> | null = null;

async function masterList(): Promise<Map<string, MasterEntry>> {
  if (master) return master;
  const list = (await getJson<{ data?: MasterEntry[] }>(`${BASE}/json/champions.json`))?.data;
  if (!Array.isArray(list) || list.length < 200) throw new Error('mcoc.gg champion list missing or implausibly short');
  master = new Map();
  for (const m of list) {
    master.set(normaliseName(m.name), m);
    master.set(normaliseName(m.image), m);
  }
  return master;
}

/** "Spider-Man (Stark)" is listed as "Stark Spider-Man" on mcoc.gg. */
function candidateKeys(name: string): string[] {
  const keys = [normaliseName(name)];
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) keys.push(normaliseName(`${m[2]} ${m[1]}`));
  return keys;
}

function toCurve(values: number[] | undefined): Curve | null {
  if (!values || values.length !== SIG_ANCHORS.length) return null;
  return Object.fromEntries(SIG_ANCHORS.map((a, i) => [String(a), values[i]!]));
}

/** The champion's 7-star R4 and R5 curves, or null when mcoc.gg does not
 *  list the champion (or its 7-star R4 row) yet. */
export async function fetchRankCurves(name: string): Promise<{ r4: Curve; r5: Curve | null } | null> {
  const list = await masterList();
  const entry = candidateKeys(name).map((k) => list.get(k)).find(Boolean);
  if (!entry) return null;
  const file = await getJson<PrestigeFile>(`${BASE}/json/prestige/${entry.image}.json`);
  const row = (rank: number) => toCurve(file?.data.find((d) => d.rarity === 7 && d.rank === rank)?.values);
  const r4 = row(4);
  return r4 ? { r4, r5: row(5) } : null;
}
