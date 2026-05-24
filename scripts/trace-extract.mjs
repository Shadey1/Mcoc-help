// Diagnostic: runs the ACTUAL refresh-classes extractor pipeline against a
// single champion and dumps every intermediate value. Used to figure out
// where the parser is silently disagreeing with the wikitext.
//
// Usage: node scripts/trace-extract.mjs Bastion

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/trace-extract.mjs <ChampionName>');
  process.exit(1);
}

// ─── Fetch wikitext ─────────────────────────────────────────────────────

const url = new URL('https://marvel-contestofchampions.fandom.com/api.php');
url.searchParams.set('action', 'query');
url.searchParams.set('titles', name);
url.searchParams.set('prop', 'revisions');
url.searchParams.set('rvprop', 'content');
url.searchParams.set('rvslots', 'main');
url.searchParams.set('format', 'json');
url.searchParams.set('formatversion', '2');

const res = await fetch(url.toString(), {
  headers: { 'User-Agent': 'mcoc.help trace', Accept: 'application/json' },
});
const data = await res.json();
const wikitext = data.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content;
if (!wikitext) {
  console.error('No wikitext returned');
  process.exit(1);
}

// ─── Same extractInfoboxBody as refresh-classes-from-fandom.ts ──────────

function extractInfoboxBody(wikitext) {
  const templateNames = ['ChampionInfoBox', 'Champion', 'Infobox Champion', 'ChampionInfobox'];
  for (const tpl of templateNames) {
    const re = new RegExp(`\\{\\{\\s*${tpl.replace(/ /g, '[ _]')}\\b`, 'i');
    const m = wikitext.match(re);
    console.log(`  trying template "${tpl}": ${m ? `MATCH at index ${m.index}, text "${m[0]}"` : 'no match'}`);
    if (!m || m.index === undefined) continue;
    const startIdx = m.index + m[0].length;
    let depth = 1;
    let i = startIdx;
    while (i < wikitext.length - 1) {
      const two = wikitext.slice(i, i + 2);
      if (two === '{{') {
        depth++;
        i += 2;
      } else if (two === '}}') {
        depth--;
        if (depth === 0) {
          console.log(`  → matched on "${tpl}", body length ${i - startIdx}`);
          return wikitext.slice(startIdx, i);
        }
        i += 2;
      } else {
        i++;
      }
    }
    console.log(`  → never closed for "${tpl}" (unbalanced)`);
  }
  return null;
}

// ─── Same extractRawClass ───────────────────────────────────────────────

function extractRawClass(infoboxBody) {
  const m = infoboxBody.match(/\|\s*class\s*=\s*([^\n]*)/i);
  if (!m || !m[1]) {
    console.log('  no |class= field matched');
    return null;
  }
  let value = m[1].trim();
  console.log(`  raw match: "${value}"`);
  const tplMatch = value.match(/\{\{[^|]+\|\s*([A-Za-z]+)\s*\}\}/);
  if (tplMatch && tplMatch[1]) {
    console.log(`  template wrapper detected, inner: "${tplMatch[1]}"`);
    value = tplMatch[1];
  } else {
    const before = value;
    value = value.replace(/\}\}\s*$/, '').trim();
    if (before !== value) console.log(`  stripped trailing braces: "${before}" → "${value}"`);
  }
  const linkMatch = value.match(/\[\[([^\]|]+)/);
  if (linkMatch && linkMatch[1]) {
    console.log(`  wikilink detected, inner: "${linkMatch[1]}"`);
    value = linkMatch[1];
  }
  return value.trim() || null;
}

// ─── Run ────────────────────────────────────────────────────────────────

console.log(`\n=== EXTRACT INFOBOX BODY ===`);
const body = extractInfoboxBody(wikitext);
if (!body) {
  console.log('NO INFOBOX FOUND');
  process.exit(0);
}

console.log(`\n--- INFOBOX BODY (first 600 chars) ---`);
console.log(body.slice(0, 600));

console.log(`\n=== EXTRACT RAW CLASS ===`);
const raw = extractRawClass(body);
console.log(`\nFinal raw class: ${JSON.stringify(raw)}`);

const VALID = ['Mutant', 'Skill', 'Science', 'Mystic', 'Cosmic', 'Tech'];
const normalised = raw ? VALID.find((c) => c.toLowerCase() === raw.toLowerCase()) ?? null : null;
console.log(`Normalised:      ${JSON.stringify(normalised)}`);
