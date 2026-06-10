# CLAUDE.md — MCOC Prestige Tools

Read `architecture-v5.md` for the full spec. This file is the quick-start for a new session.

## What this is

A free web tool that answers "what should I do with my MCOC roster?" — roster-aware prestige optimisation. User inputs their 7-star champion roster; the tool returns atomic move recommendations (ranked by prestige delta), a ceiling/headroom view, and a sortable roster table.

## Tech stack (locked)

- Next.js 15 App Router, static export (`output: 'export'`)
- TypeScript strict, no `any`
- Tailwind CSS v4
- Vitest for engine tests
- Cloudflare Pages hosting
- Pure-TS engine in `packages/engine` — no runtime dependencies
- pnpm workspaces monorepo

## Repo structure

```
apps/web/          Next.js app (routes, components, lib)
packages/engine/   Pure TS optimisation engine (BHR, prestige, optimise, ceiling, costs)
data/              Champion JSON, formulas, generated artefacts, verified ground truth
scripts/           Seed ingestion, drift check, graph builder
```

## Current phase

**Phase 0: complete.** Engine math verified against ground-truth roster (§16) — 36,115 predicted vs 36,120 in-game, within 5 BHR aggregate.

**Phase 1 (web v1): shipped 2026-06-10.** Live on Cloudflare Pages, soft-launched to the alliance and posted to Reddit. Originally-scoped critical path all delivered:

1. Roster input with persistent local storage
2. Recommendations view (atomic + ceiling, cost-labelled)
3. Roster table view (sortable, filterable)
4. Champion list + detail pages (now also with synergies + clickable partner navigation)
5. Variant D visual direction
6. Cloudflare Pages deploy + alliance soft launch

Extras shipped alongside v1 (originally tagged v2):
- Multi-step planner ("next 10 moves" view)
- Alliance shared defender pool for /war
- 6★ relic catalog (statcasts + battlecasts) with per-relic calibration overrides
- BHR overrides for local roster-state calibration
- Champion synergies with partner-stub pages for non-7★ partners

**Phase 2 (post-launch): in progress.** Watching alliance + Reddit feedback; iterating on user-reported issues. Don't redo what's shipped — start from current state.

## What's out of scope (still v2/v3 territory)

- **Screenshot OCR import** — live behind `FEATURE_SCREENSHOT_IMPORT = false`. In alpha, accessible only via the always-visible "Seed portraits" tab. Stays gated until accuracy is solid.
- **Relic prestige optimiser** — engine math TBD. Champion prestige is 94% of total; relics are a separate loop.
- **User accounts / cloud sync** — local storage + KV-backed share links only.
- **APK extraction fallback** — Phase 4 contingency.

## Dormant Phase 3 code (behind feature flags)

These files are in the tree but not user-reachable in v1:

- `apps/web/lib/ocr/` — OCR pipeline, Tesseract wrapper, grid detection, champion matching, phash, BHR reverse lookup
- `apps/web/components/screenshot-import.tsx` — import surface
- `apps/web/components/confirmation-grid.tsx` — review UI after OCR

Entry point hidden by `FEATURE_SCREENSHOT_IMPORT = false` in `apps/web/components/roster-manager.tsx`. Do not enable for v1. Do not refactor or remove these files.

## Build & test

```bash
pnpm --filter engine test    # Engine unit tests (Vitest) — must pass
pnpm --filter web build      # Static export build — must pass
```

Engine tests reproduce the §16 ground-truth roster within +-30 BHR per champion and +-5 aggregate.

## Ground-truth roster (engine regression target)

Summoner mu3rto, captured 2026-05-06. Top-30 prestige: 38,410 (champion 36,120 + relic 2,290). See `architecture-v5.md` §16 for the full roster and verified multipliers. Engine changes must not regress against this data.

Key locked constants:
- R5 = 1.0000, R4 = 0.8431, R3 = 0.6906
- A0 = 1.00, A1 = 1.08, A2 = 1.16

## Constraints

- Boring stack only. No new frameworks, no backend for the main app loop (share feature is the sole exception — Cloudflare KV).
- Cite data sources prominently: MCOCHUB (primary), mcoc.gg (cross-check), Fandom wiki (metadata, CC-BY-SA).
- No champion portrait images stored in repo — class icon fallback for v1, Fandom CDN hotlink planned for v2.
