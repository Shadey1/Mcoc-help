# v0.14.0 — BHR-anchor OCR pipeline

Replaces the v0.13.0 state-text OCR with the validated variance-rows + OCR-anchors approach.

## Why

v0.13.0 assumed state text ("R5 sig 200 A2") existed on the prestige page. It doesn't — that page only shows BHR. The pipeline OCR'd noise and produced 6 garbage results out of 30 cards.

## What changed

**Algorithm:** Grid detection is now driven by three signals working together — content-region detection (skip dim sidebars, status bars, close-X), variance-based row detection within content (find Y bands), and BHR-anchor column extrapolation (whole-image OCR finds NN,NNN patterns, the densest row's spacing yields column pitch). Validated cross-platform on Windows ultrawide (9 cols) and phone landscape (5 cols) with zero per-platform tuning.

**Pipeline:** Per card, we now OCR the BHR number directly (focused crop, three-digit-with-comma regex), detect ascension visually from the pip badge, and reverse-derive (rank, sig) from `calculateBHR(champion, state)` via brute-force enumeration (3 ranks × 201 sig values, <1ms). Round-sig preference breaks ties toward what players actually have.

**UI:** Progress copy themed to Variant D's "comic moments inside editorial restraint" — "Searching the multiverse for BHR markers…", "Multiverse mapped", "Reality skipped" on failure. Confirmation grid now shows the OCR'd BHR and the engine derivation inline ("BHR 46,120 → R5 sig 200 A2"), with amber ±N annotation when the derivation is loose.

## Files changed

- `apps/web/lib/ocr/types.ts` — `ParsedState` removed, `BHRAnchor` and `DerivedState` added, `ProcessedTile.state` → `derivedState`
- `apps/web/lib/ocr/grid-detect.ts` — rewritten (variance rows + OCR anchor columns, median-pitch, row-height filter)
- `apps/web/lib/ocr/bhr-anchor.ts` — new, whole-image OCR pass returning `BHRAnchor[]`
- `apps/web/lib/ocr/bhr-reverse.ts` — new, brute-force engine inversion `(champion, BHR, ascension) → (rank, sig)`
- `apps/web/lib/ocr/ascension-detect.ts` — new, visual pip-count detection from the bottom-right badge
- `apps/web/lib/ocr/tesseract.ts` — `ocrStateText` removed, `ocrBHR` added (digit/comma whitelist, NN,NNN regex)
- `apps/web/lib/ocr/pipeline.ts` — rewritten orchestration, themed progress events
- `apps/web/lib/ocr/state-parser.ts` — deleted
- `apps/web/components/screenshot-import.tsx` — uses `progress.copy` directly, updated help text
- `apps/web/components/confirmation-grid.tsx` — reads `derivedState`, shows BHR→state diagnostic strip

## Known caveats

- **My Champions tab is a secondary target.** The prestige modal layout is the validated case (5 cards per row on phone, 9 on Windows). My Champions is denser and per-card OCR accuracy will be lower. Prestige modal is the recommended source.
- **Battlegrounds is not a roster import source.** The big number on each battlegrounds card is PI (Power Index), not BHR — the BHR regex correctly produces zero anchors and the import fails gracefully.
- **Empirical validation pending.** The algorithm is verified on the Python prototype against 5 reference screenshots. The TS port should behave identically, but tile-level OCR accuracy can only be measured on real imports. Soft-launch testers will surface any tuning needs.

## Tested

- Algorithm grid alignment: 5/5 reference screenshots (both Windows and phone) — combined-v014.py validates pre-port.
- Cross-platform: Windows ultrawide (3437×1363, 9 cols) and phone landscape (1736×789, 5 cols) both produce clean grids without source-specific tuning.

## Not addressed (deferred)

- My Champions multi-screenshot stitching for sub-top-30 imports → v2
- Per-card BHR confidence weighting feeding into match confidence → next iteration if needed
- Manual calibration fallback ("click two corners") if anchor pass returns 0 → only if soft-launch hits this failure mode
