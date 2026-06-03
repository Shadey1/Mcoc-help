/**
 * Compare in-game BHR readings (provided by the user) against the engine's
 * prediction. All inputs are sig 200, varying rank/ascension. For each
 * champion we try all 6 (rank, asc) combos and pick the closest fit to the
 * in-game value; the residual error after best-fit reveals whether our
 * multipliers and/or scraped sig 200 anchors are correct.
 */
import { readFileSync } from 'fs';
import { calculateBHR } from '../packages/engine/src/bhr.ts';

const seed = JSON.parse(readFileSync('data/champions/seed.json', 'utf8'));
const A0 = 1.0, A1 = 1.08, A2 = 1.16;

// In-game readings from the screenshots, all at sig 200.
const inGame = [
  // image 3 (high tier)
  { name: 'Lizard',                  bhr: 46120 },
  { name: 'Patriot',                 bhr: 45770 },
  { name: 'Maestro',                 bhr: 45730 },
  { name: 'Infamous Iron Man',       bhr: 43620 },
  { name: 'High Evolutionary',       bhr: 40600 },
  { name: 'Kindred',                 bhr: 38780 },
  { name: 'Spot',                    bhr: 38690 },
  { name: 'Knull',                   bhr: 38540 },
  { name: 'Nova',                    bhr: 38500 },
  { name: 'Deadpool',                bhr: 37140 },
  { name: 'Spider-Man',              bhr: 36690 },
  { name: 'Dani Moonstar',           bhr: 36660 },
  // image 1 (middle tier)
  { name: 'Spider-Punk',             bhr: 36220 },
  { name: 'Star-Lord (Stellar Forged)', bhr: 36140 },
  { name: 'Iron Man',                bhr: 36110 },
  { name: 'White Tiger',             bhr: 36100 },
  { name: 'The Destroyer',           bhr: 36100 },
  { name: 'Dust',                    bhr: 36080 },
  { name: 'Arcade',                  bhr: 36080 },
  { name: 'Spiral',                  bhr: 35910 },
  { name: 'Hit-Monkey',              bhr: 35880 },
  { name: 'Gorr',                    bhr: 35880 },
  { name: 'Abomination',             bhr: 35880 },
  { name: 'Mister Negative',         bhr: 35860 },
  // image 2 (lower tier)
  { name: 'Attuma',                  bhr: 35840 },
  { name: 'Storm',                   bhr: 35800 },
  { name: 'Mojo',                    bhr: 35740 },
  { name: 'Korg',                    bhr: 35470 },
  { name: 'Corvus Glaive',           bhr: 35340 },
  { name: 'Yelena Belova',           bhr: 34210 },
  { name: 'Onslaught',               bhr: 34210 },
  { name: 'Dark Phoenix',            bhr: 34040 },
  { name: 'Shathra',                 bhr: 34030 },
  { name: 'Silver Surfer',           bhr: 34020 },
  { name: 'Quicksilver',             bhr: 33950 },
  { name: 'Baron Zemo',              bhr: 33850 },
];

function normalise(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Hand-disambiguation for screenshot labels that map ambiguously to seed
// variants. Without these, "Spider-Man" (one of 7 variants) doesn't match.
const SCREENSHOT_TO_SEED = {
  'Infamous Iron Man': 'iron-man-infamous',
  'Spider-Man': 'spider-man-pavitr-prabhakar', // inferred from BHR fit
  'Abomination': 'abomination-immortal',
  'Storm': 'storm-pyramid-x', // inferred from BHR fit
};

const byName = new Map(seed.champions.map((c) => [normalise(c.name), c]));
const byId = new Map(seed.champions.map((c) => [c.id, c]));

const COMBOS = [
  { label: 'R5 A0', rank: 5, ascension: 'A0' },
  { label: 'R5 A1', rank: 5, ascension: 'A1' },
  { label: 'R5 A2', rank: 5, ascension: 'A2' },
  { label: 'R4 A0', rank: 4, ascension: 'A0' },
  { label: 'R4 A1', rank: 4, ascension: 'A1' },
  { label: 'R4 A2', rank: 4, ascension: 'A2' },
];

let totalExact = 0, totalOff10 = 0, totalOff20plus = 0, totalUnmatched = 0;
const perCombo = new Map();
const offRows = [];

for (const row of inGame) {
  const c = SCREENSHOT_TO_SEED[row.name]
    ? byId.get(SCREENSHOT_TO_SEED[row.name])
    : byName.get(normalise(row.name));
  if (!c) {
    console.log(`UNMATCHED in seed: ${row.name}`);
    totalUnmatched++;
    continue;
  }
  const s200 = c.prestige.rank5['200'];
  let best = null;
  for (const combo of COMBOS) {
    if (!c.ascendable && combo.ascension !== 'A0') continue;
    const state = { championId: c.id, rank: combo.rank, sig: 200, ascension: combo.ascension, stateConfirmed: true, addedVia: 'manual' };
    const pred = calculateBHR(c, state);
    const diff = Math.abs(pred - row.bhr);
    if (!best || diff < best.diff) best = { ...combo, pred, diff };
  }
  if (best.diff === 0) totalExact++;
  else if (best.diff === 10) totalOff10++;
  else totalOff20plus++;
  const key = best.label;
  if (!perCombo.has(key)) perCombo.set(key, { exact: 0, off10: 0, off20plus: 0, residuals: [] });
  const bucket = perCombo.get(key);
  if (best.diff === 0) bucket.exact++;
  else if (best.diff === 10) bucket.off10++;
  else bucket.off20plus++;
  bucket.residuals.push(row.bhr - best.pred);
  if (best.diff !== 0) {
    offRows.push({ name: row.name, inGame: row.bhr, predicted: best.pred, combo: best.label, s200, diff: row.bhr - best.pred });
  }
}

console.log('────────────────────────────────────────────────');
console.log(`Total: ${inGame.length} | Unmatched: ${totalUnmatched}`);
console.log(`Exact match: ${totalExact}`);
console.log(`Off by 10: ${totalOff10}`);
console.log(`Off by 20+: ${totalOff20plus}`);
console.log('');
console.log('Per-combo breakdown:');
for (const [k, v] of perCombo) {
  const avgRes = v.residuals.reduce((s, r) => s + r, 0) / v.residuals.length;
  console.log(`  ${k}: ${v.exact} exact, ${v.off10} off-10, ${v.off20plus} off-20+, mean residual (in-game - pred): ${avgRes.toFixed(1)}`);
}
console.log('');
console.log('Off-by-some rows (sorted by combo):');
offRows.sort((a, b) => a.combo.localeCompare(b.combo) || a.name.localeCompare(b.name));
for (const o of offRows) {
  console.log(`  ${o.combo}  ${o.name.padEnd(28)} in-game=${o.inGame}  pred=${o.predicted}  diff=${o.diff>0?'+':''}${o.diff}  (s200=${o.s200})`);
}
