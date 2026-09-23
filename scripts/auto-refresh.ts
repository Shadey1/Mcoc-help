/**
 * Unattended data refresh. Run by .github/workflows/data-refresh.yml;
 * safe to run by hand.
 *
 *   pnpm auto-refresh              # daily set
 *   pnpm auto-refresh -- --weekly  # daily set + ascension sweep + class refresh
 *
 * Daily:  new 7-star champions and BHR curve changes from MCOCHUB's feed;
 *         missing R4 curves from mcoc.gg;
 *         has the AW guide changed, or has the next season's page appeared.
 * Weekly: the Ascendable badge on every champion's MCOCHUB page; champion
 *         classes and newly created pages on the Fandom wiki; every
 *         champion's ability text from MCOCHUB.
 *
 * It edits data files only and never commits. Every finding lands in one
 * of three lists, and the workflow acts on each differently:
 *   changes  - routine; applied. Shipped to main once tests + build pass.
 *   risky    - would change data, but is the kind of change a bad upstream
 *              edit produces: a big BHR swing, a class change on the wiki,
 *              a guide extraction with unmatched cells. Held back unless
 *              --include-risky, which is how the workflow builds its PR.
 *   advisory - things it declined to do at all (a champion that nearly
 *              matches an existing one, an ascension being taken away).
 *              Reported in an issue; needs a person.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchRankCurves } from './lib/mcocgg.js';
import { fetchFeed, findSeedMatch, idFromName, isAscendable, normaliseName, SIG_ANCHORS, type FeedRow } from './lib/mcochub.js';

const WEEKLY = process.argv.slice(2).includes('--weekly');
const INCLUDE_RISKY = process.argv.slice(2).includes('--include-risky');
const SEED_PATH = 'data/champions/seed.json';
const CLASS_REPORT_PATH = 'scripts/class-corrections.json';
const POINTER_PATH = 'data/aw/current.ts';
const ABILITIES_PATH = 'data/champions/abilities.json';
const REPORT_PATH = 'auto-refresh-report.md';
const GUIDE_URL = (n: number) => `https://www.guiamtc.com/aw-season-${n}`;

const CLASSES = ['Mutant', 'Skill', 'Science', 'Mystic', 'Cosmic', 'Tech'];
// Kabam rebalances move a curve by well under this; a bigger jump is
// more likely a bad upstream edit than a real change.
const BHR_REVIEW_THRESHOLD = 0.03;
const PAGE_DELAY_MS = 1000;

type Champion = {
  id: string;
  name: string;
  class: string;
  ascendable: boolean;
  prestige?: { rank5?: Record<string, number>; rank4?: Record<string, number> } & Record<string, unknown>;
  sigCurve: null;
  tags: string[];
  _meta: Record<string, unknown>;
  portraitUrl: string | null;
  sevenStarReleased: boolean;
  released?: string;
};

const changes: string[] = [];
const risky: string[] = [];
const advisory: string[] = [];
const notes: string[] = [];
// What each step looked at, so "nothing changed" can be told apart from "nothing ran".
const checked: string[] = [];
const today = new Date().toISOString().slice(0, 10);

function readSeed(): { champions: Champion[] } {
  return JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as { champions: Champion[] };
}
function writeSeed(seed: { champions: Champion[] }): void {
  seed.champions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next = JSON.stringify(seed, null, 2) + '\n';
  if (next !== readFileSync(SEED_PATH, 'utf-8').replaceAll('\r\n', '\n')) writeFileSync(SEED_PATH, next);
}

function run(script: string, args: string[]): { status: number; output: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { encoding: 'utf-8' });
  return { status: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const tail = (s: string, lines = 12): string => s.trim().split('\n').slice(-lines).join('\n');

// ── Champions and BHR ───────────────────────────────────────────────────

function curveOf(row: FeedRow): Record<string, number> | null {
  const curve: Record<string, number> = {};
  let prev = 0;
  for (const anchor of SIG_ANCHORS) {
    const v = row.sigs[String(anchor)];
    if (typeof v !== 'number' || v < 15_000 || v > 80_000 || v < prev) return null;
    curve[String(anchor)] = v;
    prev = v;
  }
  return curve;
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

/** An existing champion whose name is a typo away from this one. */
function nearDuplicate(name: string, champions: Champion[]): Champion | undefined {
  const n = normaliseName(name);
  return champions.find((c) => {
    const m = normaliseName(c.name);
    return m !== n && Math.abs(m.length - n.length) <= 2 && editDistance(m, n) <= 2;
  });
}

/** A placeholder waiting for a 7-star release: a synergy-partner stub with
 *  no curve, or a Fandom-discovered stub with the sentinel curve. A stub
 *  that has a real curve (Goldpool, Platinum Pool) is held back on
 *  purpose and must never be released automatically. */
function isPendingStub(c: Champion): boolean {
  if (c.sevenStarReleased !== false) return false;
  const top = c.prestige?.rank5?.['200'];
  return top === undefined || top < 15_000;
}

async function refreshChampions(rows: FeedRow[]): Promise<string[]> {
  const seed = readSeed();
  const added: string[] = [];
  for (const row of rows) {
    const curve = curveOf(row);
    const existing = findSeedMatch(row, seed.champions);

    if (!existing || isPendingStub(existing)) {
      const label = existing ? `${existing.name} (stub)` : row.name;
      const cls = CLASSES.find((c) => c.toLowerCase() === (row.class ?? existing?.class ?? '').toLowerCase());
      const twin = existing ? undefined : nearDuplicate(row.name, seed.champions);
      if (twin) {
        advisory.push(`New on MCOCHUB: **${row.name}** looks like existing **${twin.name}** (\`${twin.id}\`). Not added; rename or add by hand.`);
        continue;
      }
      if (!curve || !cls) {
        advisory.push(`New on MCOCHUB: **${label}** has ${!curve ? 'an incomplete or implausible BHR curve' : `an unknown class "${row.class}"`}. Not added.`);
        continue;
      }
      let ascendable: boolean;
      try {
        ascendable = await isAscendable(row);
      } catch (e) {
        advisory.push(`New on MCOCHUB: **${label}**: could not read its page for the Ascendable badge (${(e as Error).message}). Not added.`);
        continue;
      }
      const meta = {
        bhrSource: `mcochub.insaneskull.com (JSON API, R5 11-anchor curve, refreshed ${today})`,
        lastVerified: today,
        ascendableSource: `mcochub.insaneskull.com (Ascendable badge, verified ${today})`,
        addedBy: `auto-refresh ${today}`,
      };
      if (existing) {
        Object.assign(existing, { class: cls, ascendable, prestige: { ...existing.prestige, rank5: curve }, _meta: meta, sevenStarReleased: true });
        existing.released ??= today.slice(0, 4);
      } else {
        seed.champions.push({
          id: idFromName(row.name),
          name: row.name,
          class: cls,
          ascendable,
          prestige: { rank5: curve },
          sigCurve: null,
          tags: [],
          _meta: meta,
          portraitUrl: null,
          sevenStarReleased: true,
          released: today.slice(0, 4),
        });
      }
      added.push(existing?.name ?? row.name);
      changes.push(`New 7★ champion: **${existing?.name ?? row.name}** (${cls}, ${ascendable ? 'ascendable' : 'not ascendable'}, R5 sig 200 = ${curve['200']}).`);
      continue;
    }

    if (!curve) {
      advisory.push(`MCOCHUB curve for **${existing.name}** is incomplete or implausible; kept ours.`);
      continue;
    }
    const old = existing.prestige?.rank5 ?? {};
    const moved = SIG_ANCHORS.filter((a) => old[String(a)] !== curve[String(a)]);
    if (moved.length === 0) continue;
    const swing = Math.max(...moved.map((a) => Math.abs(curve[String(a)]! - (old[String(a)] ?? 0)) / (old[String(a)] || 1)));
    const big = swing > BHR_REVIEW_THRESHOLD;
    if (!big || INCLUDE_RISKY) {
      existing.prestige = { ...existing.prestige, rank5: curve };
      existing._meta = { ...existing._meta, bhrSource: `mcochub.insaneskull.com (JSON API, R5 11-anchor curve, refreshed ${today})`, lastVerified: today };
    }
    const line = `BHR curve for **${existing.name}**: ${moved.length} anchors moved, largest ${(swing * 100).toFixed(1)}% (sig 200: ${old['200'] ?? 'n/a'} → ${curve['200']}).`;
    (big ? risky : changes).push(line);
  }

  const missing = seed.champions.filter((c) => c.sevenStarReleased !== false && !rows.some((r) => findSeedMatch(r, [c])));
  if (missing.length > 0) notes.push(`Released in our seed but absent from MCOCHUB's feed: ${missing.map((c) => c.name).join(', ')}.`);

  checked.push(`MCOCHUB feed: ${rows.length} champions compared against the seed.`);
  writeSeed(seed);
  return added;
}

// ── R4 curves ───────────────────────────────────────────────────────────

/** MCOCHUB has no R4. Fill it from mcoc.gg for released champions that
 *  lack one, typically ones this job added. Existing R4 curves are never
 *  touched: several are hand-calibrated against in-game values. */
async function fillMissingR4(): Promise<void> {
  const seed = readSeed();
  const missing = seed.champions.filter((c) => c.sevenStarReleased !== false && c.prestige?.rank5 && !c.prestige.rank4);
  const waiting: string[] = [];
  for (const champ of missing) {
    let curves: Awaited<ReturnType<typeof fetchRankCurves>>;
    try {
      curves = await fetchRankCurves(champ.name);
    } catch (e) {
      notes.push(`mcoc.gg unavailable, R4 curves not checked: ${(e as Error).message}`);
      break;
    } finally {
      await sleep(500);
    }
    if (!curves) {
      waiting.push(champ.name);
      continue;
    }
    const r5 = champ.prestige!.rank5!;
    // Proof the name mapped to the right champion and the data is sane:
    // their R5 must be ours (the sites round the odd anchor differently).
    const r5Agrees = curves.r5 !== null && SIG_ANCHORS.every((a) => Math.abs(curves!.r5![String(a)]! - r5[String(a)]!) <= r5[String(a)]! * 0.005);
    const ratioOk = SIG_ANCHORS.every((a) => {
      const ratio = curves!.r4[String(a)]! / r5[String(a)]!;
      return ratio > 0.78 && ratio < 0.9;
    });
    if (!r5Agrees || !ratioOk) {
      advisory.push(`R4 curve for **${champ.name}**: mcoc.gg's data ${!r5Agrees ? 'has a different R5 curve from ours' : 'is not a plausible R4 for our R5'}, so it was not used. The engine keeps estimating R4 as R5 × 0.8431.`);
      continue;
    }
    champ.prestige = { ...champ.prestige, rank4: curves.r4 };
    champ._meta = { ...champ._meta, r4Source: `mcoc.gg per-rank curve (R4 11-anchor, fetched ${today})` };
    changes.push(`R4 curve for **${champ.name}** from mcoc.gg (sig 200 = ${curves.r4['200']}; was estimated from R5).`);
  }
  checked.push(`R4 curves: ${missing.length} released champions lacked one${waiting.length > 0 ? `; mcoc.gg does not list ${waiting.join(', ')} yet` : ''}.`);
  writeSeed(seed);
}

// ── Ascension sweep ─────────────────────────────────────────────────────

async function sweepAscendable(rows: FeedRow[]): Promise<void> {
  const seed = readSeed();
  const unread: string[] = [];
  for (const row of rows) {
    const champ = findSeedMatch(row, seed.champions);
    if (!champ || champ.sevenStarReleased === false) continue;
    let badge: boolean;
    try {
      badge = await isAscendable(row);
    } catch {
      unread.push(champ.name);
      if (unread.length > 25) {
        notes.push('Ascension sweep abandoned: MCOCHUB champion pages kept failing.');
        break;
      }
      continue;
    } finally {
      await sleep(PAGE_DELAY_MS);
    }
    if (badge === champ.ascendable) continue;
    if (badge) {
      champ.ascendable = true;
      champ._meta = { ...champ._meta, ascendableSource: `mcochub.insaneskull.com (Ascendable badge, verified ${today})` };
      changes.push(`**${champ.name}** is now ascendable (MCOCHUB badge).`);
    } else {
      // Kabam has only ever widened the pool, so this is more likely a
      // MCOCHUB slip than a real removal.
      advisory.push(`MCOCHUB no longer shows **${champ.name}** as ascendable. Left as ascendable; check before changing.`);
    }
  }
  checked.push(`Ascension sweep: ${rows.length - unread.length} MCOCHUB champion pages read.`);
  if (unread.length > 0) notes.push(`Ascension sweep: could not read the MCOCHUB page for ${unread.join(', ')} this run.`);
  writeSeed(seed);
}

// ── Fandom: portraits for new champions, weekly class refresh ───────────

function fetchPortraitUrls(names: string[]): void {
  const r = run('scripts/scrape-fandom-portraits.ts', ['--only', names.join(',')]);
  const seed = readSeed();
  const without = seed.champions.filter((c) => names.includes(c.name) && !c.portraitUrl).map((c) => c.name);
  if (without.length > 0) notes.push(`No Fandom portrait found yet for ${without.join(', ')} (class icon shows until one exists).`);
  if (r.status !== 0) notes.push(`Portrait lookup exited ${r.status}:\n${tail(r.output, 5)}`);
}

function refreshClasses(): void {
  const before = readSeed().champions.length;
  const dry = run('scripts/refresh-classes-from-fandom.ts', []);
  if (dry.status !== 0) {
    notes.push(`Fandom class refresh exited ${dry.status}:\n${tail(dry.output, 6)}`);
    return;
  }
  const report = JSON.parse(readFileSync(CLASS_REPORT_PATH, 'utf-8')) as {
    corrections: Array<{ name: string; currentClass: string; proposedClass: string }>;
  } & Record<string, unknown>;
  for (const c of report.corrections) {
    risky.push(`Fandom now lists **${c.name}** as ${c.proposedClass} (was ${c.currentClass}). Wiki edits can be wrong; check in game.`);
  }
  // The script applies whatever the report file holds, so holding class
  // changes back means taking them out of it.
  if (!INCLUDE_RISKY) writeFileSync(CLASS_REPORT_PATH, JSON.stringify({ ...report, corrections: [] }, null, 2) + '\n');
  const applied = run('scripts/refresh-classes-from-fandom.ts', ['--apply']);
  if (applied.status !== 0) notes.push(`Applying the Fandom refresh exited ${applied.status}:\n${tail(applied.output, 6)}`);

  checked.push(`Fandom: classes and new pages checked (${report.corrections.length} class changes proposed).`);
  const seed = readSeed();
  if (seed.champions.length > before) {
    const stubs = seed.champions.filter((c) => String(c._meta?.bhrSource ?? '').startsWith('PENDING') && String(c._meta?.bhrSource).includes(today));
    changes.push(`Fandom has new champion pages, added as unreleased stubs until MCOCHUB lists them: ${stubs.map((c) => c.name).join(', ') || `${seed.champions.length - before} entries`}.`);
  }
  const names = new Map<string, string>();
  for (const c of seed.champions) {
    const n = normaliseName(c.name);
    if (names.has(n)) advisory.push(`Duplicate champion in seed: \`${names.get(n)}\` and \`${c.id}\` are both "${c.name}".`);
    names.set(n, c.id);
  }
  writeSeed(seed);
}

// ── Abilities text ──────────────────────────────────────────────────────

/** Weekly re-import of every champion's ability text from MCOCHUB. The
 *  importer keeps a champion's previous kit when a page parses to nothing
 *  and exits 2, which is the sign its parser no longer fits the layout. */
function refreshAbilities(): void {
  const before = readFileSync(ABILITIES_PATH, 'utf-8');
  const r = run('scripts/refresh-abilities-from-mcochub.ts', ['--no-cache']);
  if (r.status !== 0 && r.status !== 2) {
    notes.push(`Abilities import exited ${r.status}:
${tail(r.output, 6)}`);
    return;
  }
  const emptied = r.output.match(/parsed to an empty kit; previous kit kept: ([^\n]+)/)?.[1];
  if (emptied) advisory.push(`Abilities: MCOCHUB pages for **${emptied}** parsed to no kit, previous text kept. If it is more than a champion or two, MCOCHUB has changed its layout and \`scripts/refresh-abilities-from-mcochub.ts\` needs its parser updated.`);
  const after = readFileSync(ABILITIES_PATH, 'utf-8');
  const changed = diffChampions(before, after);
  checked.push(`Abilities: ${(r.output.match(/Processing (\d+) champion/)?.[1] ?? '?')} MCOCHUB champion pages re-read.`);
  if (changed.length > 0) changes.push(`Ability text updated for ${changed.length} champion${changed.length === 1 ? '' : 's'}: ${changed.slice(0, 12).join(', ')}${changed.length > 12 ? ', …' : ''}.`);
}

function diffChampions(beforeJson: string, afterJson: string): string[] {
  const a = (JSON.parse(beforeJson) as { champions: Record<string, unknown> }).champions;
  const b = (JSON.parse(afterJson) as { champions: Record<string, unknown> }).champions;
  return Object.keys(b).filter((id) => JSON.stringify(a[id]) !== JSON.stringify(b[id]));
}

// ── Alliance War guide ──────────────────────────────────────────────────

function extractSeason(season: number, fetchFirst: boolean, why: string): void {
  const portraits = run('scripts/fetch-portrait-cache.ts', []);
  if (portraits.status !== 0) notes.push(`Portrait fetch had failures:\n${tail(portraits.output, 4)}`);
  const flags = [...(fetchFirst ? ['--fetch'] : []), ...(INCLUDE_RISKY ? [] : ['--strict']), '--apply'];
  const r = run('scripts/extract-aw-season.ts', [String(season), ...flags]);
  const summary = r.output.match(/Extracted (\d+)\/50 nodes; (\d+) items need review; (\d+) structural problems/);
  const differs = r.output.match(/Differs from the current season file on (\d+) nodes: ([0-9, ]+)/);
  const line = `AW season ${season}: ${why}; ${differs ? `nodes ${differs[2]!.trim()} changed` : 'new season file'}.`;
  const unmatched = `${summary?.[2]} defender cells could not be matched confidently and are left out of the picks; see \`data/aw/_review-season-${season}.md\`.`;
  if (r.status === 3) risky.push(`${line} ${unmatched}`);
  else if (r.status !== 0 || !summary) advisory.push(`AW season ${season}: ${why}, but the extraction did not complete, so nothing was written.\n\n\`\`\`\n${tail(r.output)}\n\`\`\``);
  else if (Number(summary[2]) > 0) risky.push(`${line} ${unmatched}`);
  else changes.push(line);
}

async function refreshWarGuide(): Promise<void> {
  const current = Number(readFileSync(POINTER_PATH, 'utf-8').match(/season-([0-9]+)[.]json/)?.[1]);
  if (!current) {
    notes.push(`Could not read the current season from ${POINTER_PATH}.`);
    return;
  }
  const next = await fetch(GUIDE_URL(current + 1), { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
  checked.push(`AW season ${current + 1} guide page: ${next ? (next.status === 200 ? 'live' : `not live (HTTP ${next.status})`) : 'unreachable'}.`);
  if (next?.status === 200) {
    extractSeason(current + 1, true, 'the guide page for the new season is live');
    return;
  }
  const check = run('scripts/extract-aw-season.ts', [String(current), '--check']);
  const print = check.output.match(/guide fingerprint: ([0-9a-f]+)/)?.[1];
  if (check.status === 0 || check.status === 2) checked.push(`AW season ${current} guide: downloaded, fingerprint ${print} (${check.status === 0 ? 'unchanged' : 'changed'}).`);
  if (check.status === 2) extractSeason(current, false, 'the guide was edited');
  else if (check.status !== 0) notes.push(`Could not check the AW guide this run:\n${tail(check.output, 4)}`);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let rows: FeedRow[] | null = null;
  try {
    rows = await fetchFeed();
  } catch (e) {
    notes.push(`MCOCHUB feed unavailable, champion steps skipped: ${(e as Error).message}`);
  }
  if (rows) {
    const added = await refreshChampions(rows);
    if (added.length > 0) fetchPortraitUrls(added);
    await fillMissingR4();
    if (WEEKLY) await sweepAscendable(rows);
  }
  if (WEEKLY) {
    refreshClasses();
    refreshAbilities();
  }
  await refreshWarGuide();

  const all = [...changes, ...risky, ...advisory];
  const title = changes.length === 1 ? changes[0]!.replace(/\*\*|`/g, '').split('\n')[0]!.slice(0, 68) : `${changes.length} data updates`;
  const section = (heading: string, items: string[]): string => (items.length > 0 ? `## ${heading}\n\n${items.map((i) => `- ${i}`).join('\n')}\n\n` : '');
  const report =
    (all.length === 0 ? 'Nothing changed.\n\n' : '') +
    section(INCLUDE_RISKY ? 'Risky changes in this PR' : 'Held back for a PR', risky) +
    section('Declined, needs a person', advisory) +
    section(INCLUDE_RISKY ? 'Routine changes' : 'Shipped', changes) +
    section('Notes', notes) +
    section('Checked', checked);
  writeFileSync(REPORT_PATH, report);

  console.log(report);
  console.log(`changes=${changes.length} risky=${risky.length} advisory=${advisory.length}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `risky=${risky.length}\nadvisory=${advisory.length}\ntitle=${title}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# Data refresh${INCLUDE_RISKY ? ' (PR pass)' : ''}\n\n${report}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
