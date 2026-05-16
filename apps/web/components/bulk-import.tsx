'use client';

import { useMemo, useState } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';

type BulkImportProps = {
  champions: Champion[];
  onImport: (states: ChampionState[]) => void;
};

type ParsedRow = {
  raw: string;
  matched: Champion | null;
  ambiguousMatches: Champion[];
  rank: 3 | 4 | 5;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
  warnings: string[];
};

/**
 * Parse a free-form pasted roster into structured states. Supports a few
 * common formats:
 *
 *   Lizard R5 sig 200 A2
 *   maestro R4 200 A2
 *   nova r4 s200 a2
 *   Pavitr 4/200/1
 *   Iron Man (Infamous) R4 sig 200 A1
 *
 * Liberal in what it accepts. Unmatched champions surface as warnings; the
 * user reviews everything before committing.
 */
export function BulkImport({ champions, onImport }: BulkImportProps) {
  const [text, setText] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const parsed = useMemo(() => parseRoster(text, champions), [text, champions]);

  const validRows = parsed.filter((r) => r.matched);
  const ambiguousRows = parsed.filter((r) => !r.matched && r.ambiguousMatches.length > 1);
  const unmatchedRows = parsed.filter(
    (r) => !r.matched && r.ambiguousMatches.length === 0 && r.raw.trim().length > 0,
  );

  function handleImport() {
    const states: ChampionState[] = validRows.map((r) => ({
      championId: r.matched!.id,
      rank: r.rank,
      sig: r.sig,
      ascension: r.matched!.ascendable ? r.ascension : 'A0',
    }));
    onImport(states);
    setText('');
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
          <p>One champion per line. The parser is permissive about format:</p>
          <pre className="numeric bg-[var(--color-paper)] border border-[var(--color-rule)] rounded p-2 overflow-x-auto">
{`Lizard R5 sig 200 A2
Maestro R4 sig 200 A2
Iron Man (Infamous) R4 200 A1
pavitr r4 s200 a1
Nova 4/200/2
Onslaught R4 200`}
          </pre>
          <p>
            Defaults: rank 4, sig 200, A0. Ascension level is ignored for
            non-ascendable champions. Champion name matching is fuzzy — partial
            names work but ambiguous matches need disambiguating.
          </p>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Lizard R5 sig 200 A2\nMaestro R4 sig 200 A2\nNova R4 sig 200 A2\n…`}
        rows={8}
        className="w-full px-3 py-2 border border-[var(--color-rule)] rounded bg-[var(--color-paper-soft)] focus:outline-none focus:border-[var(--color-marvel-impact)] numeric text-sm"
      />

      {text.trim().length > 0 && (
        <div className="space-y-3 text-sm">
          <div className="flex gap-4 text-xs">
            <span className="text-[var(--color-marvel-editorial)] font-medium">
              {validRows.length} matched
            </span>
            {ambiguousRows.length > 0 && (
              <span className="text-amber-700">
                {ambiguousRows.length} ambiguous
              </span>
            )}
            {unmatchedRows.length > 0 && (
              <span className="text-[var(--color-ink-soft)]">
                {unmatchedRows.length} unmatched
              </span>
            )}
          </div>

          {validRows.length > 0 && (
            <details className="border border-[var(--color-rule)] rounded">
              <summary className="px-3 py-2 cursor-pointer bg-[var(--color-paper-soft)] text-sm">
                {validRows.length} ready to import
              </summary>
              <ul className="divide-y divide-[var(--color-rule)] max-h-64 overflow-y-auto">
                {validRows.map((r, i) => (
                  <li key={i} className="px-3 py-2 flex items-center justify-between text-xs">
                    <span>{r.matched!.name}</span>
                    <span className="text-[var(--color-ink-soft)] numeric">
                      R{r.rank} sig {r.sig} {r.matched!.ascendable ? r.ascension : 'A0'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(ambiguousRows.length > 0 || unmatchedRows.length > 0) && (
            <details className="border border-amber-300 rounded">
              <summary className="px-3 py-2 cursor-pointer bg-amber-50 text-sm text-amber-900">
                {ambiguousRows.length + unmatchedRows.length} need review
              </summary>
              <ul className="divide-y divide-amber-200 max-h-64 overflow-y-auto bg-amber-50">
                {ambiguousRows.map((r, i) => (
                  <li key={`a${i}`} className="px-3 py-2 text-xs">
                    <div className="font-medium">&ldquo;{r.raw}&rdquo;</div>
                    <div className="text-amber-700 mt-1">
                      Ambiguous: matches {r.ambiguousMatches.map((c) => c.name).join(', ')}
                    </div>
                  </li>
                ))}
                {unmatchedRows.map((r, i) => (
                  <li key={`u${i}`} className="px-3 py-2 text-xs">
                    <div className="font-medium">&ldquo;{r.raw}&rdquo;</div>
                    <div className="text-amber-700 mt-1">No match found</div>
                  </li>
                ))}
              </ul>
            </details>
          )}

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

// ─── Parsing ────────────────────────────────────────────────────────────

function parseRoster(text: string, champions: Champion[]): ParsedRow[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.map((line) => parseLine(line, champions));
}

function parseLine(line: string, champions: Champion[]): ParsedRow {
  const warnings: string[] = [];

  // Extract rank: R3 / R4 / R5 / rank 3 etc.
  const rankMatch = line.match(/\b[rR]\s*([3-5])\b/) || line.match(/\brank\s*([3-5])\b/i);
  const rank = rankMatch ? (parseInt(rankMatch[1]!, 10) as 3 | 4 | 5) : 4;

  // Extract sig: sig 200 / s200 / 200 (after rank or alone)
  const sigMatch =
    line.match(/\bsig\s*(\d{1,3})\b/i) ||
    line.match(/\bs\s*(\d{1,3})\b/i) ||
    line.match(/\b([12]?\d{2})\b/); // any 1-3 digit number (heuristic last resort)
  let sig = sigMatch ? parseInt(sigMatch[1]!, 10) : 200;
  if (sig > 200) sig = 200;
  if (sig < 0) sig = 0;
  // Round to nearest 20-sig bracket
  sig = Math.round(sig / 20) * 20;

  // Extract ascension: A0/A1/A2, or third position of "N/N/N" slash format
  let ascension: 'A0' | 'A1' | 'A2' = 'A0';
  const ascLetterMatch =
    line.match(/\b[aA]\s*([0-2])\b/) || line.match(/\bascend(?:ed)?\s*([0-2])\b/i);
  const ascSlashMatch = line.match(/\d{1,3}\s*\/\s*\d{1,3}\s*\/\s*([0-2])\b/);
  if (ascLetterMatch) {
    ascension = `A${ascLetterMatch[1]}` as 'A0' | 'A1' | 'A2';
  } else if (ascSlashMatch) {
    ascension = `A${ascSlashMatch[1]}` as 'A0' | 'A1' | 'A2';
  }

  // Strip the rank/sig/ascension markers from the line to find the name
  let nameQuery = line
    .replace(/\b[rR]\s*[3-5]\b/g, '')
    .replace(/\brank\s*[3-5]\b/gi, '')
    .replace(/\bsig\s*\d{1,3}\b/gi, '')
    .replace(/\bs\s*\d{1,3}\b/gi, '')
    .replace(/\b[aA]\s*[0-2]\b/g, '')
    .replace(/\bascend(?:ed)?\s*[0-2]\b/gi, '')
    .replace(/\d{1,3}\s*\/\s*\d{1,3}\s*\/\s*\d/g, '') // strip "4/200/2" patterns
    .replace(/\d{1,3}\b/g, '') // remaining bare numbers
    .replace(/[\/|,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!nameQuery) {
    return {
      raw: line,
      matched: null,
      ambiguousMatches: [],
      rank,
      sig,
      ascension,
      warnings: ['No name found'],
    };
  }

  // Find candidate matches — case-insensitive substring on both directions
  const q = nameQuery.toLowerCase();
  const exactMatches = champions.filter((c) => c.name.toLowerCase() === q);
  const substringMatches = champions.filter((c) => {
    const n = c.name.toLowerCase();
    return n.includes(q) || q.includes(n);
  });
  const fuzzyMatches = champions.filter((c) =>
    fuzzyMatch(q, c.name.toLowerCase()),
  );

  const candidates =
    exactMatches.length > 0
      ? exactMatches
      : substringMatches.length > 0
        ? substringMatches
        : fuzzyMatches;

  // Pick the shortest-name match if multiple (prefers "Spider-Man" over "Spider-Man (Pavitr Prabhakar)" for query "spider-man")
  let matched: Champion | null = null;
  let ambiguousMatches: Champion[] = [];

  if (candidates.length === 1) {
    matched = candidates[0]!;
  } else if (candidates.length > 1) {
    // If one is an exact match (case-insensitive), prefer it
    const exact = candidates.find((c) => c.name.toLowerCase() === q);
    if (exact) {
      matched = exact;
    } else {
      ambiguousMatches = candidates.slice(0, 5);
    }
  }

  return {
    raw: line,
    matched,
    ambiguousMatches,
    rank,
    sig,
    ascension,
    warnings,
  };
}

/**
 * Permissive fuzzy match: query letters appear in order in the name.
 * Catches "iim" → "Iron Man (Infamous)", "pavitr" → "Spider-Man (Pavitr Prabhakar)".
 */
function fuzzyMatch(query: string, name: string): boolean {
  const q = query.replace(/[^a-z0-9]/g, '');
  const n = name.replace(/[^a-z0-9]/g, '');
  if (q.length < 3) return false;
  let qi = 0;
  for (let ni = 0; ni < n.length && qi < q.length; ni++) {
    if (n[ni] === q[qi]) qi++;
  }
  return qi === q.length;
}
