/**
 * Build a static HTML review page for a season extraction.
 *
 * Shows each of the 400 cells (50 nodes × 8 slots) next to the top-3
 * portrait-matcher candidates so a reviewer can eyeball each row and
 * spot wrong picks in seconds.
 *
 * Cells that the extractor considered strong matches are shown with a
 * green outline; weak ones with amber. Click any candidate to copy its
 * champion id — paste into season-<N>.json to correct.
 *
 * Output: data/aw/_review-s<N>/index.html
 *
 * Usage: tsx scripts/build-aw-review-page.ts <season>
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { centerCropDHash, hammingHex } from './lib/phash.js';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
if (positional.length < 1) {
  console.error('Usage: tsx scripts/build-aw-review-page.ts <season>');
  process.exit(64);
}
const SEASON = parseInt(positional[0]!, 10);
if (!Number.isInteger(SEASON) || SEASON < 1) {
  console.error('Invalid season number.');
  process.exit(64);
}

const REPO_ROOT = resolve(import.meta.dirname, '..');
const HASH_CACHE_PATH = resolve(REPO_ROOT, 'data/champions/portrait-hashes.json');
const SEED_PATH = resolve(REPO_ROOT, 'data/champions/seed.json');
const CELLS_DIR = resolve(REPO_ROOT, `data/aw/_cells-s${SEASON}`);
const PORTRAITS_DIR = resolve(REPO_ROOT, 'data/champions/portraits-cache');
const REVIEW_DIR = resolve(REPO_ROOT, `data/aw/_review-s${SEASON}`);
const OUT = resolve(REVIEW_DIR, 'index.html');
const SEASON_FILE = resolve(REPO_ROOT, `data/aw/season-${SEASON}.json`);

// Same thresholds as the extractor.
const CONFIDENCE_OK = 80;
const MIN_GAP_TO_SECOND = 15;

type Champion = { id: string; name: string };
type Seed = { champions: Champion[] };
type Season = {
  nodes: Array<{ node: number; guideDefenders: string[]; reviewFlags?: string[] }>;
};

import { relative } from 'node:path';

function relPath(from: string, to: string): string {
  return relative(from, to).replaceAll('\\', '/');
}

async function main(): Promise<void> {
  const cache = (JSON.parse(readFileSync(HASH_CACHE_PATH, 'utf-8')) as {
    hashes: Record<string, string>;
  }).hashes;
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as Seed;
  const nameById = new Map(seed.champions.map((c) => [c.id, c.name]));
  const season = JSON.parse(readFileSync(SEASON_FILE, 'utf-8')) as Season;
  const guideByNode = new Map(season.nodes.map((n) => [n.node, n.guideDefenders]));

  // Reference portraits by relative path (much smaller HTML than inline data URIs).
  const portraitRel = new Map<string, string>();
  for (const id of Object.keys(cache)) {
    const p = resolve(PORTRAITS_DIR, `${id}.png`);
    if (existsSync(p)) portraitRel.set(id, relPath(REVIEW_DIR, p));
  }

  const rows: string[] = [];
  for (let node = 1; node <= 50; node++) {
    const guides = guideByNode.get(node) ?? [];
    rows.push(`<h2 id="node-${node}">Node ${node}</h2>`);
    rows.push('<div class="row">');
    for (let slot = 1; slot <= 8; slot++) {
      const cellPath = resolve(CELLS_DIR, `node-${String(node).padStart(2, '0')}-slot-${slot}.png`);
      if (!existsSync(cellPath)) continue;
      const cellHash = await centerCropDHash(cellPath);
      const top = Object.entries(cache)
        .map(([id, h]) => ({ id, dist: hammingHex(cellHash, h) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 4);
      const secondDist = top[1]?.dist ?? 999;
      const gap = secondDist - (top[0]?.dist ?? 0);
      const strong =
        (top[0]?.dist ?? 999) <= CONFIDENCE_OK && gap >= MIN_GAP_TO_SECOND;
      const cellRel = relPath(REVIEW_DIR, cellPath);
      const currentPick = guides[slot - 1] ?? '';
      rows.push(`<div class="slot ${strong ? 'ok' : 'weak'}">`);
      rows.push(`  <div class="slot-hd">slot ${slot} · <b>${nameById.get(currentPick) ?? currentPick}</b></div>`);
      rows.push(`  <div class="cell"><img src="${cellRel}" alt="cell ${node}-${slot}"><div class="lbl">crop</div></div>`);
      for (const cand of top) {
        const nm = nameById.get(cand.id) ?? cand.id;
        const url = portraitRel.get(cand.id) ?? '';
        const active = cand.id === currentPick ? ' active' : '';
        rows.push(
          `  <div class="cand${active}" onclick="navigator.clipboard.writeText('${cand.id}')" title="Click to copy ${cand.id}"><img src="${url}" alt="${nm}"><div class="lbl">${nm} <span class="d">${cand.dist}</span></div></div>`,
        );
      }
      rows.push('</div>');
    }
    rows.push('</div>');
  }

  const html = `<!doctype html>
<html><head><title>Season ${SEASON} extraction review</title>
<meta charset="utf-8">
<style>
body{font:14px system-ui;background:#14110d;color:#efe6d4;margin:0;padding:16px}
h1{margin:0 0 16px}h2{margin:24px 0 6px;font-size:16px}
.row{display:flex;flex-wrap:wrap;gap:8px}
.slot{border:1px solid #362f24;border-radius:6px;padding:6px;background:#1e1a14;display:flex;flex-direction:column;gap:4px;min-width:230px}
.slot.weak{border-left:3px solid #d9a93f}
.slot.ok{border-left:3px solid #4e8a4e}
.slot-hd{font-size:12px;color:#a89a82}
.slot-hd b{color:#efe6d4}
.cell,.cand{display:flex;align-items:center;gap:6px;padding:3px;border-radius:4px}
.cand{cursor:pointer}
.cand:hover{background:#2a241c}
.cand.active{background:#3a3127;outline:1px solid #d9a93f}
.cell{background:#0f0d0a}
.cell img,.cand img{width:56px;height:56px;object-fit:cover;border-radius:4px}
.lbl{font-size:11px}
.d{color:#a89a82;margin-left:4px}
.nav{position:sticky;top:0;background:#14110d;padding:8px 0;margin:-16px -16px 16px;padding:8px 16px;border-bottom:1px solid #362f24}
.nav a{color:#a89a82;text-decoration:none;margin-right:8px;font-size:12px}
.nav a:hover{color:#efe6d4}
</style>
</head><body>
<h1>Season ${SEASON} extraction review</h1>
<div class="nav">Jump to: ${Array.from({ length: 50 }, (_, i) => `<a href="#node-${i + 1}">${i + 1}</a>`).join(' ')}</div>
<p>Each slot shows the extractor's current pick (bold) then the top-4 phash candidates. Click any candidate to copy its champion id. Amber slots are low-confidence guesses; green are strong matches.</p>
${rows.join('\n')}
</body></html>`;

  writeFileSync(OUT, html);
  console.log(`wrote ${OUT}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
