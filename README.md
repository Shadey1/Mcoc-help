# MCOC Prestige Tools

A free, roster-aware prestige optimisation tool for Marvel Contest of Champions.
Deployed at [mcoc.help](https://mcoc.help). Architecture overview in
[`architecture-v5.md`](./architecture-v5.md).

## Repo structure

```
prestige-tools/
├── apps/
│   └── web/                Next.js 15 app (static export → Cloudflare Pages)
│       ├── app/                Route handlers
│       ├── components/         Client components (picker, table, recs view)
│       └── lib/                Format helpers, roster storage, data loader
├── packages/
│   └── engine/             Pure-TS @prestige-tools/engine
│       ├── src/
│       │   ├── types.ts        Champion / Roster / Move / CostGate
│       │   ├── bhr.ts          BHR computation with per-rank sig curves
│       │   ├── prestige.ts     Top-30 averaging
│       │   ├── optimise.ts     Atomic moves enumeration & ranking
│       │   ├── ceiling.ts      Ceiling view (long-term planning lens)
│       │   └── costs.ts        Four-axis cost gating
│       └── __tests__/      Vitest suite — reproduces §16 verified data
├── data/
│   ├── formulas/
│   │   └── multipliers.json    Rank × ascension × sig-curve constants
│   ├── champions/
│   │   └── seed.json           254 champions (full 7-star roster)
│   └── _verified/
│       └── known-rosters.json  Regression target (Dave's verified roster)
└── scripts/
    ├── seed-from-mcochub.ts        Ingestion stub (full impl Phase 2)
    └── scrape-fandom-portraits.ts  Populate portraitUrl from Fandom CDN
```

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm` if you don't have it)

## Get running

```bash
pnpm install
pnpm -F @prestige-tools/engine build  # required: builds the engine to dist/
pnpm test                              # engine Vitest suite — reproduces §16
pnpm dev                               # Next.js on localhost:3000
```

The engine builds to `packages/engine/dist/`. The Next.js app consumes the
built output rather than source — re-run the engine build after any engine
code change. (Phase 1.x will improve this with a watch script.)

Visit `http://localhost:3000/roster/` to add champions, then `/` for the
recommendations.

## Populating portraits

The seed ships with `portraitUrl: null` on every champion — the champions
page renders class-icon placeholders until you populate the portrait URLs:

```bash
pnpm scrape-portraits
```

This walks every champion, hits the Fandom wiki API, extracts the headshot
URL, writes it back to `data/champions/seed.json`. ~5 minutes for the full
254 (rate-limited to 1 request/sec).

Idempotent — re-running only fetches champions still missing a URL.
Use `--force` to refresh all. Use `--only "Name1,Name2"` to target specific
champions. Failures are logged to `scripts/scrape-failures.json` for manual
review.

See `architecture-v5.md` §17 for the portrait sourcing decision.

## Roster sharing

New in iter6. Users can generate a short link (`mcoc.help/r/?id=abc12345`)
showing their roster as view-only — useful for alliance-war / AQ planning.
Backed by Cloudflare Pages Functions and KV storage; entries auto-expire
after 6 months. See `architecture-v5.md` §22 for the design rationale and
`DEPLOY.md` for the KV namespace setup steps.

The share feature requires the `ROSTERS` KV binding to work. Without it
(local dev with `pnpm dev`, or missing dashboard binding in production),
the rest of the app works fine — only share creation and the `/r/` page fail.

## What works in this iteration

- **Roster picker:** typeahead search across all 254 7-star champions,
  inline rank/sig/ascension entry. Ascension dropdown auto-disables for
  non-ascendable champions. Adding the same champion twice overwrites the
  existing state.
- **Bulk paste import:** paste your whole roster as text, the parser
  understands many formats (`Lizard R5 sig 200 A2`, `maestro r4 200 a2`,
  `Pavitr 4/200/1`, etc.). Shows matched / ambiguous / unmatched counts
  before committing.
- **Roster table:** every owned champion with current BHR, ceiling,
  headroom Δ, prestige-impact-if-maxed, in-top-30 indicator, plus a summary
  bar (champion count, top-30 prestige, cutoff BHR, highest BHR).
- **Recommendations view (atomic):** top-10 ranked moves with cost-gate
  badges (rank-cats / sig-stones / ascension), partitioned into "proceed" and
  "deferred — ascend first" per the v5 deferral rule.
- **Recommendations view (ceiling):** top-10 long-term plays sorted by
  prestige delta if fully developed. The Phase 0 "Blue Marvel +449" insight
  shows up automatically when you've got him in your roster.
- **Persistence:** roster lives in `localStorage`. Nothing leaves your device.
- **Champion list + detail pages** (statically generated for all 254 champs).
- **Variant D Hybrid styling:** editorial typography, Marvel red accents,
  burst rendering reserved for the #1 recommendation card.
- **Production-ready deploy config:** `DEPLOY.md` walks through the
  Cloudflare Pages setup; `.nvmrc` pins Node 20.

## What's NOT here yet

- **Sortable / filterable roster table**: columns are defined but click-to-
  sort and filter chips (class, ascendable, in-top-30, cost-gate) are
  Phase 1.x work.
- **URL-hash sharing**: `encodeRosterToHash` / `decodeRosterFromHash` are
  implemented in `lib/roster-storage.ts` but not wired to the UI.
- **Champion detail page synergies / immunities**: deferred until the
  metadata pipeline lands.
- **Drift detection / community correction flow**: Phase 2.
- **Class assignments may have minor errors**: 254 champions classified by
  rule; the rare unusual variant (Sam Wilson Cap, scope of Mystic vs Skill
  for some characters) might need manual correction post-launch.

## Data sources

- **MCOCHUB** (InsaneSkull) — primary BHR reference: https://mcochub.insaneskull.com
- **mcoc.gg** (BrutalDX) — secondary cross-check: https://mcoc.gg
- **Fandom wiki** — champion metadata (CC-BY-SA):
  https://marvel-contestofchampions.fandom.com

See `architecture-v5.md` §17 for the full sourcing chain.

## Engine accuracy

End-to-end check against Dave's verified §16 roster:

```
Champions:        30 / 30 within ±30 BHR
Exact matches:    17 / 30
Aggregate Δ:      −140 BHR across 30 champions
Predicted prestige: 36,115
Observed prestige:  36,120 (off by 5)
```

The accuracy is bounded by in-game BHR rounding (every value is rounded to
the nearest 10), so per-champion ±10 is the noise floor. The R3 multiplier
(0.6906) was independently confirmed against Onslaught, Silver Surfer, and
QuickSilver — verified during Phase 0 from auntm.ai data.
