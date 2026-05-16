/**
 * Seed champion data from MCOCHUB.
 *
 * Status as of Phase 1: STUB. The current `data/champions/seed.json` was
 * hand-built from the verified data dumps captured in architecture-v5.md §16
 * and the mcoc.gg / auntm.ai cross-validation work. That gets us the first
 * 75 champions.
 *
 * Phase 2 will replace this stub with:
 *   1. A nightly CI cron that fetches MCOCHUB's /prestige page
 *   2. Parses the table out of the HTML (no public API)
 *   3. Diffs against the committed seed.json, opens an issue if values moved
 *   4. Optionally auto-PRs new champions for human review
 *
 * For now this script is a placeholder so the npm scripts wire up cleanly.
 */

console.log('Seed-from-MCOCHUB ingestion: stub mode.');
console.log('Phase 1: seed.json was hand-built from verified data dumps.');
console.log('Phase 2: full nightly ingestion + drift detection will land here.');
console.log('');
console.log('See architecture-v5.md §17 and §18 for the data sourcing chain.');
