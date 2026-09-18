/**
 * War planner — Alliance War season extractor.
 *
 * Usage:
 *   tsx scripts/extract-aw-season.ts <season-number> <guide-url> [--apply]
 *
 * What it does (per the handover):
 *   1. Fetch the guide season page and its table images.
 *   2. For each image, detect the row layout (4 / 3 / 5 rows depending on
 *      section). Never hardcode a count.
 *   3. Read the node number from the left cell of each row (image OCR).
 *   4. Crop the 4×2 defender grid from the middle column, run each cell
 *      through the portrait matcher.
 *   5. OCR the buff text (Tesseract). Handle wrapped lines — join a
 *      continuation onto the previous buff when the buff ends in ":"
 *      or the continuation isn't bold.
 *   6. Write confident results to data/aw/season-<N>.json; low-confidence
 *      to data/aw/_review-season-<N>.md with crop image paths.
 *   7. Attribute the source explicitly.
 *
 * Status: SCAFFOLD. Stages 1, 6, 7 are wired and pluggable. Stages 2–5
 * are per-source (they depend on how the guide lays its tables out) and
 * need a live URL to inspect against — see `docs/extractor-notes.md` for
 * the remaining checklist and the exact hooks to fill in.
 *
 * Run in dry-run mode without --apply. Only --apply writes files.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// ── Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const positional = args.filter((a) => !a.startsWith('--'));

if (positional.length < 2) {
  console.error(
    'Usage: tsx scripts/extract-aw-season.ts <season-number> <guide-url> [--apply]',
  );
  process.exit(64);
}

const seasonNumber = parseInt(positional[0]!, 10);
const guideUrl = positional[1]!;

if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
  console.error('Invalid season number.');
  process.exit(64);
}
try {
  new URL(guideUrl);
} catch {
  console.error('Invalid guide URL.');
  process.exit(64);
}

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SEASON_FILE = resolve(REPO_ROOT, `data/aw/season-${seasonNumber}.json`);
const REVIEW_FILE = resolve(REPO_ROOT, `data/aw/_review-season-${seasonNumber}.md`);

// ── Stage 1: fetch ──────────────────────────────────────────────────────

/** Fetch the guide page HTML. Fandom, GuiaMTC and similar sources
 *  usually require a proper browser UA to serve real content instead of
 *  a 403. */
async function fetchGuidePage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// ── Stage 2–5: extraction ───────────────────────────────────────────────

/**
 * Per-source table extractor. Returns one entry per node parsed from the
 * guide's table images. Confidence: 0..1 per cell — the matcher reports
 * its own confidence, and OCR reports its.
 *
 * NOT IMPLEMENTED — needs live GuiaMTC page inspection to know:
 *   - How the season page links to its table images (Cloudinary?
 *     wp-content? inline SVG?)
 *   - Table image dimensions (fixed or responsive)
 *   - Defender cell geometry within a table row (px offsets, cell size)
 *   - Buff text region (font size, background colour for OCR contrast)
 *   - How the SUBS section numbers its rows differently from paths 1..9
 *
 * See docs/extractor-notes.md for the walkthrough of what to add.
 */
type ExtractedNode = {
  node: number;
  buffs: string[];
  guideDefenders: string[];
  reviewFlags: string[];
};

async function extractFromGuide(_html: string, _url: string): Promise<ExtractedNode[]> {
  throw new Error(
    "Extractor's per-source parser is not implemented. See docs/extractor-notes.md.\n" +
      'The scaffold handles fetch, output, review-queue, and attribution — only the\n' +
      'guide-specific defender-cell + buff parser is missing.',
  );
}

// ── Stage 6: write ──────────────────────────────────────────────────────

type SeasonNode = {
  node: number;
  buffs: string[];
  guideDefenders: string[];
  reviewFlags?: string[];
};

type Season = {
  season: number;
  source: { name: string; url: string; capturedAt: string };
  nodes: SeasonNode[];
  defaultKeyNodes: number[];
};

function readExistingSeason(): Season | null {
  if (!existsSync(SEASON_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SEASON_FILE, 'utf-8')) as Season;
  } catch {
    return null;
  }
}

function inferSourceName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return 'unknown';
  }
}

function writeSeasonFile(nodes: ExtractedNode[]): void {
  const existing = readExistingSeason();
  const defaultKeyNodes = existing?.defaultKeyNodes ?? [48, 49, 50];
  const cleaned: SeasonNode[] = nodes.map((n) => {
    const out: SeasonNode = {
      node: n.node,
      buffs: n.buffs,
      guideDefenders: n.guideDefenders,
    };
    if (n.reviewFlags.length > 0) out.reviewFlags = n.reviewFlags;
    return out;
  });
  const season: Season = {
    season: seasonNumber,
    source: {
      name: inferSourceName(guideUrl),
      url: guideUrl,
      capturedAt: new Date().toISOString().slice(0, 10),
    },
    nodes: cleaned,
    defaultKeyNodes,
  };
  mkdirSync(dirname(SEASON_FILE), { recursive: true });
  writeFileSync(SEASON_FILE, JSON.stringify(season, null, 2) + '\n', 'utf-8');
  console.log(`wrote ${SEASON_FILE}`);
}

function writeReviewQueue(nodes: ExtractedNode[]): void {
  const flagged = nodes.filter((n) => n.reviewFlags.length > 0);
  if (flagged.length === 0) {
    console.log('review queue: empty — every node extracted with confidence');
    return;
  }
  const lines: string[] = [
    `# Season ${seasonNumber} extraction review queue`,
    '',
    `Source: ${guideUrl}`,
    `Captured: ${new Date().toISOString().slice(0, 10)}`,
    '',
    `${flagged.length} node(s) need review before the season file is trusted.`,
    '',
  ];
  for (const n of flagged) {
    lines.push(`## Node ${n.node}`);
    lines.push('');
    for (const f of n.reviewFlags) lines.push(`- ${f}`);
    lines.push('');
  }
  mkdirSync(dirname(REVIEW_FILE), { recursive: true });
  writeFileSync(REVIEW_FILE, lines.join('\n'), 'utf-8');
  console.log(`wrote ${REVIEW_FILE} — ${flagged.length} node(s) flagged`);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Extracting season ${seasonNumber} from ${guideUrl}`);
  console.log(apply ? '(apply mode — will write files)' : '(dry-run — pass --apply to write)');
  const html = await fetchGuidePage(guideUrl);
  console.log(`fetched ${html.length} bytes of HTML`);
  const nodes = await extractFromGuide(html, guideUrl);
  if (nodes.length !== 50) {
    console.warn(`WARN: extracted ${nodes.length} nodes — expected 50`);
  }
  if (!apply) {
    console.log('dry run: would write:');
    console.log(` - ${SEASON_FILE}`);
    console.log(` - ${REVIEW_FILE} (if any node was flagged)`);
    return;
  }
  writeSeasonFile(nodes);
  writeReviewQueue(nodes);
}

main().catch((e: unknown) => {
  console.error('extract-aw-season failed:');
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
