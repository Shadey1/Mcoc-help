'use client';

import { useMemo, useState } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';

type BulkImportProps = {
  champions: Champion[];
  onImport: (states: ChampionState[]) => void;
};

type Rank = 3 | 4 | 5;
type Ascension = 'A0' | 'A1' | 'A2';

type ParsedRow = {
  lineIndex: number;
  raw: string;
  candidates: Champion[]; // ranked best→worst (top 5)
  selected: Champion | null; // null = unresolved or no candidates
  isManual: boolean;
  rank: Rank;
  sig: number;
  ascension: Ascension;
};

/**
 * Common community-vernacular abbreviations for champions whose canonical
 * name is long enough that players reliably abbreviate. Keys are normalised
 * (lowercased, alphanumeric only) — match what `normalize()` produces.
 *
 * Conservative list: only abbreviations widely-used in MCOC discourse where
 * there's no risk of mis-mapping. Anything ambiguous left out — the fuzzy
 * matcher will surface multiple candidates and the user picks.
 */
const ALIASES: Record<string, string> = {
  // Long names with established short forms
  iim: 'Iron Man (Infamous)',
  he: 'High Evolutionary',
  bwcv: 'Black Widow (Claire Voyant)',
  bwdo: 'Black Widow (Deadly Origin)',
  pavitr: 'Spider-Man (Pavitr Prabhakar)',
  stellarlord: 'Star-Lord (Stellar Forged)',
  starlordsf: 'Star-Lord (Stellar Forged)',
  bpcw: 'Black Panther (Civil War)',
  bpck: 'Black Panther (Civil War)',
  capiw: 'Captain America (Infinity War)',
  capwwii: 'Captain America (WWII)',
  cabucky: 'Captain America (Sam Wilson)',
  dpx23: 'Deadpool X-Force',
  dpxf: 'Deadpool X-Force',
  immortalabom: 'Abomination (Immortal)',
  abomimm: 'Abomination (Immortal)',
  dani: 'Dani Moonstar',
  spiderpunk: 'Spider-Punk',
  spm2099: 'Spider-Man 2099',
  spm: 'Spider-Man',
  ddhk: "Daredevil (Hell's Kitchen)",
  drdoom: 'Doctor Doom',
  drstrange: 'Doctor Strange',
  // Common short forms
  qs: 'QuickSilver',
  hb: 'Howard the Duck',
  ht: 'Human Torch',
  ss: 'Silver Surfer',
  dp: 'Deadpool',
  ws: 'Winter Soldier',
  bb: 'Black Bolt',
  bc: 'Black Cat',
  cm: 'Captain Marvel',
  cmm: 'Captain Marvel (Movie)',
  ddv: 'Daredevil',
  dd: 'Daredevil',
  drm: 'Doctor Voodoo',
  ag: 'Apocalypse',
  apoc: 'Apocalypse',
  hop: 'Hope Summers',
  mp: 'Madelyne Pryor',
};

export function BulkImport({ champions, onImport }: BulkImportProps) {
  const [text, setText] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  // Manual disambiguation per line index. Keyed by line index because
  // typing more text shifts other lines around — the lineIndex stays stable
  // for any line as long as the user appends below or edits inline.
  const [manual, setManual] = useState<Record<number, string>>({});

  const parsed = useMemo(
    () => parseRoster(text, champions, manual),
    [text, champions, manual],
  );

  const validRows = parsed.filter((r) => r.selected !== null);
  const ambiguousRows = parsed.filter(
    (r) => r.selected === null && r.candidates.length > 0,
  );
  const unmatchedRows = parsed.filter(
    (r) => r.selected === null && r.candidates.length === 0 && r.raw.trim().length > 0,
  );

  function handleImport() {
    const states: ChampionState[] = validRows.map((r) => ({
      championId: r.selected!.id,
      rank: r.rank,
      sig: r.sig,
      ascension: r.selected!.ascendable ? r.ascension : 'A0',
    }));
    onImport(states);
    setText('');
    setManual({});
  }

  function pickCandidate(lineIndex: number, championId: string) {
    setManual((prev) => ({ ...prev, [lineIndex]: championId }));
  }

  function clearManual(lineIndex: number) {
    setManual((prev) => {
      const next = { ...prev };
      delete next[lineIndex];
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <label className="block text-sm font-medium">
          Bulk import — paste your roster
        </label>
        <button
          type="button"
          onClick={() => setShowHelp((s) => !s)}
          className="text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-marvel-impact)]"
        >
          {showHelp ? 'Hide format help' : 'Show format help'}
        </button>
      </div>

      {showHelp && (
        <div className="text-xs text-[var(--color-ink-soft)] bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded p-3 space-y-2">
          <p>One champion per line. Examples of what works:</p>
          <pre className="numeric bg-[var(--color-paper)] border border-[var(--color-rule)] rounded p-2 overflow-x-auto">
{`Lizard R5 sig 200 A2
Maestro R4 sig 200 A2
Iron Man (Infamous) R4 200 A1
pavitr r4 s200 a1
IIM 4 200 1
HE R5 200
Onslaught R4
Nova 4/200/2`}
          </pre>
          <p>
            <strong>Defaults:</strong> rank 4, sig 200, A0. Ascension is ignored
            for non-ascendable champions.
          </p>
          <p>
            <strong>Name matching</strong> is fuzzy and forgiving — abbreviations,
            partial names, common typos all work. When a line is ambiguous,
            you&apos;ll see candidate buttons to pick the right one.
          </p>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Lizard R5 sig 200 A2\nMaestro R4 sig 200 A2\nNova R4 sig 200 A2\n…`}
        rows={10}
        className="w-full px-3 py-2 border border-[var(--color-rule)] rounded bg-[var(--color-paper-soft)] focus:outline-none focus:border-[var(--color-marvel-impact)] numeric text-sm"
      />

      {parsed.length > 0 && (
        <div className="space-y-3 text-sm">
          <div className="flex gap-4 text-xs flex-wrap">
            <span className="text-[var(--color-marvel-editorial)] font-medium">
              {validRows.length} matched
            </span>
            {ambiguousRows.length > 0 && (
              <span className="text-amber-700">
                {ambiguousRows.length} need a pick
              </span>
            )}
            {unmatchedRows.length > 0 && (
              <span className="text-[var(--color-ink-soft)]">
                {unmatchedRows.length} unmatched
              </span>
            )}
          </div>

          <ul className="border border-[var(--color-rule)] rounded divide-y divide-[var(--color-rule)] max-h-96 overflow-y-auto">
            {parsed.map((row) => (
              <ParsedRowDisplay
                key={row.lineIndex}
                row={row}
                onPick={(id) => pickCandidate(row.lineIndex, id)}
                onClearManual={() => clearManual(row.lineIndex)}
              />
            ))}
          </ul>

          {validRows.length > 0 && (
            <button
              type="button"
              onClick={handleImport}
              className="px-4 py-2 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
            >
              Import {validRows.length}{' '}
              {validRows.length === 1 ? 'champion' : 'champions'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Per-row preview component ──────────────────────────────────────────

function ParsedRowDisplay({
  row,
  onPick,
  onClearManual,
}: {
  row: ParsedRow;
  onPick: (id: string) => void;
  onClearManual: () => void;
}) {
  if (row.selected) {
    return (
      <li className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[var(--color-marvel-editorial)] flex-shrink-0">✓</span>
          <span className="font-medium truncate">{row.selected.name}</span>
          {row.isManual && (
            <button
              type="button"
              onClick={onClearManual}
              className="text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline flex-shrink-0"
              title="Revert to automatic pick"
            >
              undo
            </button>
          )}
        </div>
        <span className="text-[var(--color-ink-soft)] numeric flex-shrink-0">
          R{row.rank} sig {row.sig} {row.selected.ascendable ? row.ascension : 'A0'}
        </span>
      </li>
    );
  }

  if (row.candidates.length > 0) {
    return (
      <li className="px-3 py-2 bg-amber-50 text-xs space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">&ldquo;{row.raw}&rdquo;</span>
          <span className="text-amber-700 text-[10px] uppercase tracking-wide">
            pick one
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {row.candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.id)}
              className="px-2 py-0.5 bg-[var(--color-paper)] border border-amber-300 rounded hover:border-[var(--color-marvel-impact)] hover:bg-[var(--color-paper-card)] text-xs"
            >
              {c.name}
            </button>
          ))}
        </div>
      </li>
    );
  }

  return (
    <li className="px-3 py-2 text-xs flex items-center gap-2 text-[var(--color-ink-soft)]">
      <span className="flex-shrink-0">✗</span>
      <span className="truncate">&ldquo;{row.raw}&rdquo; — no match</span>
    </li>
  );
}

// ─── Parsing ────────────────────────────────────────────────────────────

function parseRoster(
  text: string,
  champions: Champion[],
  manual: Record<number, string>,
): ParsedRow[] {
  const lines = text.split('\n');
  return lines
    .map((raw, lineIndex) => ({ raw: raw.trim(), lineIndex }))
    .filter(({ raw }) => raw.length > 0)
    .map(({ raw, lineIndex }) => parseLine(raw, lineIndex, champions, manual));
}

function parseLine(
  line: string,
  lineIndex: number,
  champions: Champion[],
  manual: Record<number, string>,
): ParsedRow {
  // ── Numeric fields ──
  const rankMatch =
    line.match(/\b[rR]\s*([3-5])\b/) || line.match(/\brank\s*([3-5])\b/i);
  const rank: Rank = rankMatch ? (parseInt(rankMatch[1]!, 10) as Rank) : 4;

  const sigMatch =
    line.match(/\bsig\s*(\d{1,3})\b/i) ||
    line.match(/\bs\s*(\d{1,3})\b/i) ||
    line.match(/\b([12]?\d{2})\b/);
  let sig = sigMatch ? parseInt(sigMatch[1]!, 10) : 200;
  if (sig > 200) sig = 200;
  if (sig < 0) sig = 0;
  sig = Math.round(sig / 20) * 20;

  let ascension: Ascension = 'A0';
  const ascLetterMatch =
    line.match(/\b[aA]\s*([0-2])\b/) || line.match(/\bascend(?:ed)?\s*([0-2])\b/i);
  const ascSlashMatch = line.match(/\d{1,3}\s*\/\s*\d{1,3}\s*\/\s*([0-2])\b/);
  if (ascLetterMatch) {
    ascension = `A${ascLetterMatch[1]}` as Ascension;
  } else if (ascSlashMatch) {
    ascension = `A${ascSlashMatch[1]}` as Ascension;
  }

  // ── Name query: strip the structured fields, leave the rest ──
  let nameQuery = line
    .replace(/\b[rR]\s*[3-5]\b/g, '')
    .replace(/\brank\s*[3-5]\b/gi, '')
    .replace(/\bsig\s*\d{1,3}\b/gi, '')
    .replace(/\bs\s*\d{1,3}\b/gi, '')
    .replace(/\b[aA]\s*[0-2]\b/g, '')
    .replace(/\bascend(?:ed)?\s*[0-2]\b/gi, '')
    .replace(/\d{1,3}\s*\/\s*\d{1,3}\s*\/\s*\d/g, '')
    .replace(/\d{1,3}\b/g, '')
    .replace(/[\/|,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ── Manual disambiguation takes priority ──
  if (manual[lineIndex]) {
    const m = champions.find((c) => c.id === manual[lineIndex]);
    if (m) {
      return {
        lineIndex,
        raw: line,
        candidates: [m],
        selected: m,
        isManual: true,
        rank,
        sig,
        ascension,
      };
    }
  }

  if (!nameQuery) {
    return {
      lineIndex,
      raw: line,
      candidates: [],
      selected: null,
      isManual: false,
      rank,
      sig,
      ascension,
    };
  }

  // ── Find candidate matches ──
  const candidates = findCandidates(nameQuery, champions);
  const selected = pickAutomatic(nameQuery, candidates);

  return {
    lineIndex,
    raw: line,
    candidates,
    selected,
    isManual: false,
    rank,
    sig,
    ascension,
  };
}

// ─── Matching ───────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCandidates(query: string, champions: Champion[]): Champion[] {
  const q = normalize(query);
  if (q.length === 0) return [];

  // 1. Alias map hit — instant
  const aliasName = ALIASES[q];
  if (aliasName) {
    const aliased = champions.find((c) => c.name === aliasName);
    if (aliased) return [aliased];
  }

  // Score each champion. Lower score = better match.
  // Special scores: -3 exact match, -2 starts-with, -1 substring,
  //                  0 subsequence, N>0 edit distance (Levenshtein)
  const scored: Array<{ champion: Champion; score: number }> = [];

  for (const c of champions) {
    const n = normalize(c.name);

    if (n === q) {
      scored.push({ champion: c, score: -3 });
      continue;
    }
    if (n.startsWith(q) || q.startsWith(n)) {
      scored.push({ champion: c, score: -2 });
      continue;
    }
    if (n.includes(q) || q.includes(n)) {
      scored.push({ champion: c, score: -1 });
      continue;
    }
    if (isSubsequence(q, n)) {
      scored.push({ champion: c, score: 0 });
      continue;
    }
    // Typo tolerance via Levenshtein. Threshold scales with query length:
    // short queries are intolerant (one typo on "iim" is fatal), longer
    // queries forgive more (one typo on "wolverine" is fine).
    const threshold = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
    const dist = levenshtein(q, n);
    if (dist <= threshold) {
      scored.push({ champion: c, score: dist });
    }
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    // Tie-break by name length (shorter wins — prefers "Spider-Man" over
    // "Spider-Man (Pavitr Prabhakar)" when query is "spiderman").
    return a.champion.name.length - b.champion.name.length;
  });

  return scored.slice(0, 5).map((s) => s.champion);
}

function pickAutomatic(query: string, candidates: Champion[]): Champion | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // If the top candidate is an exact normalised match, take it without
  // asking the user.
  const q = normalize(query);
  const exact = candidates.find((c) => normalize(c.name) === q);
  if (exact) return exact;

  // Otherwise, the user picks.
  return null;
}

function isSubsequence(query: string, text: string): boolean {
  // Min query length 4 — anything shorter produces too many false positive
  // hits (e.g. "iim" subsequence-matches "abominationimmortal").
  if (query.length < 4) return false;
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/**
 * Standard Levenshtein edit distance. O(n*m) time/space. Champion names
 * are short (typically < 30 chars) so the cost is negligible.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) prev[i] = i;

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1);
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    prev = curr;
  }
  return prev[b.length];
}
