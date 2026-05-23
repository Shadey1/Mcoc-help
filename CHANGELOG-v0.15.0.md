# v0.15.0 — Tickbox grid + identity-only roster entries

## Why

The prestige modal gives you 30 champions. Your roster has ~250. The atomic-move optimiser is blind to anything beyond the top 30 — including R3 versions of recent strong champions whose ceilings would vault them into top-10 if invested in. To fix this, the engine needs *identity* for everyone you own, even if state is unknown.

This release adds a fourth add-mode — "Tick everyone you own" — built around the observation that the vast majority of a 250-champion roster sits at the floor default (R3 sig 0 A0). Asking the user for state on every entry is friction without value; ticking a checkbox per champion is.

## What changed

**New add mode.** `/roster` → "Tick everyone you own" surfaces all 254 champions in six class-grouped columns with checkboxes and search. Already-rostered champions appear pre-ticked and locked. Tick what you own, hit "Add N champions" — they enter the roster as R3 sig 0 A0 with `stateConfirmed: false`.

**Data model.** `ChampionState` gains two optional fields, both defaulted via Zod on load so existing rosters migrate automatically:
- `stateConfirmed: boolean` — defaults `true` for legacy entries; `false` for tickbox-added
- `addedVia: 'screenshot' | 'tickbox' | 'manual'` — defaults `'manual'` for legacy

**Engine.** Atomic-move enumeration now skips entries with `stateConfirmed: false`. Generating moves against placeholder state would be misleading; identity-only entries are visible in the ceiling view (where state precision matters less, since ceilings are R5 sig 200 A2 max by definition) but excluded from the "what should I do next" list.

**Roster table.** Banner appears at top when any champions are identity-only, with a one-click "Review the N →" toggle that filters the table to just those rows. State column renders "unconfirmed" in italic for those entries instead of "R3 sig 0 A0" — clearer signal that the value is a default, not a confirmation.

**Provenance.** Every entry point — picker, bulk paste, screenshot import, tickbox — now records `addedVia` so future surfaces can sort/filter by provenance if useful.

## Files changed

- `packages/engine/src/types.ts` — `ChampionState` schema gains `stateConfirmed` + `addedVia`
- `packages/engine/src/optimise.ts` — `enumerateMoves` skips unconfirmed entries
- `apps/web/lib/roster-storage.ts` — `loadRoster` + `decodeRosterFromHash` apply Zod defaults per-entry on load (legacy migration)
- `apps/web/components/champion-tickbox-grid.tsx` — NEW: class-grouped checkbox grid
- `apps/web/components/roster-manager.tsx` — fourth tab + banner + unconfirmed-only filter + unconfirmed-state row treatment
- `apps/web/components/roster-picker.tsx` — sets `stateConfirmed: true, addedVia: 'manual'`
- `apps/web/components/bulk-import.tsx` — sets `stateConfirmed: true, addedVia: 'manual'`
- `apps/web/components/confirmation-grid.tsx` — sets `stateConfirmed: true, addedVia: 'screenshot'`

## OCR patches carried over

The OCR patches accumulated during v0.14.x debugging are included in this release:
- `apps/web/lib/ocr/grid-detect.ts` — extends card cells downward beyond variance band to include name + BHR text
- `apps/web/lib/ocr/bhr-anchor.ts` — flexible regex (comma OR period, optional separator) + 2200px OCR resolution + diagnostic logging

These weren't shipped as a tagged release; they accrued as ocr-patch tarballs during the screenshot-import debugging cycle. v0.15.0 bundles them so you have a clean source of truth.

## Screenshot import status

The screenshot import surface is shelved in v0.15.0. The auto-identify pipeline (variance row detection → OCR anchors → portrait hash matching) works at the grid-detection layer but portrait identification is unreliable enough (~3 in 7 correct on testing) that exposing it during soft launch would damage trust more than the feature is worth.

**The OCR pipeline code remains in-tree** as dormant infrastructure at `apps/web/lib/ocr/*` and the components `screenshot-import.tsx` + `confirmation-grid.tsx`. Re-enabling for v0.16.0 is a UI-wiring exercise (one import block + one tab button + one rendering branch in `roster-manager.tsx`), not a from-scratch rebuild.

**Planned v0.16.0 rework:** replace the auto-identify confirmation grid with autocomplete-per-card. Each detected card shows its cropped portrait next to a champion-name autocomplete. User types or picks; we get user-affirmed identity + BHR-derived state. This is the "hybrid" option from Phase 1 debugging — keeps the grid + BHR OCR (which work), drops the portrait hashing (which doesn't).

For v0.15.0 launch, the recommended import flow is:
1. **Tick everyone you own** — fills out the long tail at floor defaults
2. **Bulk paste or picker** for any champions whose state isn't R3 sig 0 A0 — adds with confirmed state, overwriting the tickbox entries

This gets you a complete, optimiser-ready roster in 2–3 minutes without needing screenshot OCR to be reliable.

## Migration

Open `/roster` once; existing entries silently gain `stateConfirmed: true, addedVia: 'manual'` on load. No user-visible change for anyone already using the tool.
