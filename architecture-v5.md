# MCOC Prestige Tools — Architecture (Master)

*Version 5 · supersedes v1, v2, v3, v4*

---

## v5 changelog (read first if you've seen v4)

1. **Phase 0 complete.** Engine math verified against Dave's roster within 5 BHR aggregate. All rank multipliers locked. All ascension multipliers locked. Sig curves derived from empirical data.
2. **Data source chain finalised.** MCOCHUB primary (InsaneSkull), mcoc.gg secondary cross-check (BrutalDX), Fandom wiki for metadata (CC-BY-SA). Outreach plan defined.
3. **Schema rewritten.** Per-rank sig brackets at 0/50/100/150/200, optional per-champion `sigCurve` override. Linear interpolation replaced with rank-dependent normalised curves from auntm.ai R3 + R5 reference data.
4. **Rank multipliers fully locked.** R3 = 0.6906, R4 = 0.8431, R5 = 1.000. All three values independently confirmed across multiple champions and sources.
5. **Ascension pool model simplified.** Single binary `ascendable: true/false`. No rotation tracking — once a champion is in *any* pool (base, featured, sale, Titan, eventual basic crystal), they stay flagged ascendable. The complexity isn't worth it.
6. **Cost-gating taxonomy expanded to four axes.** Rank catalysts (deterministic), sig stones (semi-deterministic, often bottlenecked), ascension materials (luck-gated), and state-persistence confidence (not engine-tracked but surfaced through labels).
7. **Recommendations engine gains deferral logic.** R4→R5 moves on A0-ascendable champions are surfaced but labelled "ascend first" to prevent suboptimal sequencing.
8. **v1 scope expanded with roster table view.** Third primary surface alongside recommendations. Borrows mcoc.gg's table shape but adds personalised current-state, ceiling, headroom-delta, prestige-impact, and cost-gate per row, plus filters for class/ascendable/in-top-30/cost-gate.
9. **IA reshaped to three primary views:** Roster (the table), Recommendations (atomic + ceiling, cost-labelled), About (the working, attribution, contributions).
10. **Pavitr corrected to Mystic class.** High Evolutionary, Baron Zemo, Spider-Punk corrected to `ascendable: true`.
11. **Engine is two-mode.** Atomic moves view (current state, what's my next move) and ceiling view (what's worth investing in long-term). Both run from the same data, present different cuts.
12. **MCOCHUB-as-single-point-of-failure flagged.** Phase 3+ contingency: build APK-extraction fallback. Not Phase 1 work.
13. **Sale-rotation tracking dropped.** Was going to track ascension pool changes by sale calendar; collapsed into the binary flag instead.

---

## 1. Product vision

A free, fast, beautifully restrained web tool that answers the question **"what should I do with my roster?"** better than anything else on the market. The user provides their roster (champions + rank + sig + ascension state); the tool returns (a) atomic move recommendations ranked by prestige delta, (b) a ceiling/headroom view for long-term planning, and (c) a sortable, filterable roster table that doubles as a comprehensive reference. No stash management. No planner. No sign-up. A 30-second lookup used 2-3 times a week, or a 10-minute browse for the player who wants to understand their picture.

Total prestige is the sum of two independent averages: champion prestige (avg top-30 BHR) and relic prestige (avg top-30 relic rating). v1 focuses entirely on the champion side; relic optimisation is its own loop and lives in v2+.

Aesthetic: editorial almanack with comic-book moments at impact. Disciplined typography and generous whitespace 90% of the time, a Marvel-coloured starburst when a prestige delta lands. Tip-jar funded, no paywall.

## 2. Why this product, not the alternatives

The data landscape, verified through exhaustive search in May 2026:

- **MCOCHUB** (InsaneSkull) — actively maintained, comprehensive, accepts community submissions. The right primary data source. No optimisation layer.
- **mcoc.gg** (BrutalDX) — launched April 2026 with a Prestige table view. Active, fresh. Has the table shape we want for v1, but slow to load and no filtering. Maintainer publicly soliciting missing data; approachable.
- **Khonshu's Ankh** — $3/month paywall. Has a sig-level + ascension prestige calculator. The closest competitor to what we're building, but paywalled, no API. We compete on free + open.
- **auntm.ai** — frozen mid-2024. Excellent reference for the data shape we want; effectively dead as a product.
- **Kabam's official Prestige Calculator** — exists at `playcontestofchampions.com/academy/prestige-calculator/`, chronically out of date, missing recent champions.
- **Fandom wiki** — active, CC-BY-SA licensed. Right source for champion metadata (class, immunities, release date, ascension status) but not prestige numbers.

None of them does **roster-aware optimisation** — "given your specific roster, here are the top moves ranked by prestige gain, plus a roster table that tells you the picture." That's the gap, and the Ascension+ launch in March 2026 reset the math so the existing tools haven't caught up. There's a 6-12 month window to become the default.

The differentiation isn't novel data; it's the **recommendation logic on top of shared community data**. We're contributing to MCOCHUB's ecosystem, not competing with it.

## 3. Scope

**v1 must-have:**

- Roster input (champion + rarity + rank + sig + ascension level), with persistent local storage
- **Recommendations view**: atomic moves (top 5-10, cost-labelled) and ceiling view (full roster ranked by max-development potential)
- **Roster table view**: sortable, filterable table of all owned champions with current state, ceiling, headroom Δ, prestige-impact-if-maxed, cost-gate, and in-top-30 indicator
- Champion list page, filterable by class and immunity
- Champion detail pages with synergies as clickable graph
- Shareable URLs (roster encoded in URL hash)
- Ascension+ (A0 / A1 / A2) BHR math from day one
- Mobile-responsive (mostly viewed on phone)

**v1 explicitly out:**

- Relic prestige (separate optimisation; v2)
- Resource inventory input — moves labelled with cost; user filters mentally
- User accounts, server-side state, cloud sync
- Battlegrounds, AW, alliance tools
- Champion ability text, rotation guides, tier-list opinions
- Native mobile app
- Sale-rotation tracking for ascension pool (binary flag is enough)

**v2 territory:**

- Screenshot OCR import (the prestige page is the target — see §13)
- Relic prestige optimiser
- Multi-step planner ("optimal sequence given everything I have")
- "What if I pulled X from Titan?" preview
- Engine extracted as published npm package

**v3+ territory:**

- APK-extraction fallback if MCOCHUB ever goes dark
- Community-correction flow at scale
- Multi-language support

## 4. The user flow

```
Visit /  →  Recommendations view (default)
            ↓
            "Top 5 moves" with prestige Δ + cost labels
            "Worth investing in" ceiling list
            "Read the working →" → /about
            
            Tab to /roster → Roster table
                             - sortable columns
                             - filter chips
                             - per-row: now / ceiling / Δ / impact / cost
            
            Tab to /champions → All champions
                                filterable
                                
            From any champion → /champions/[slug] detail
```

Roster persists in `localStorage`. Shareable URL encodes roster in hash fragment.

## 5. Tech stack (locked)

- **Next.js 15 App Router**, static export
- **TypeScript strict**, no `any`
- **Tailwind CSS v4**
- **Zod** for runtime schema validation
- **Vitest** for engine tests
- **Cloudflare Pages** hosting, **GitHub Actions** CI/CD
- **Cloudflare Web Analytics** (privacy-friendly, no cookies)
- **Tesseract.js** for client-side OCR (v2)
- **No backend** in v1; everything client-side

## 6. Repo structure

```
prestige-tools/
├── apps/
│   └── web/                    Next.js app
│       ├── app/                routes
│       ├── components/         UI components
│       └── lib/                app-specific glue
├── packages/
│   └── engine/                 pure TS optimisation engine
│       ├── src/
│       │   ├── types.ts
│       │   ├── bhr.ts          BHR computation per §7.5
│       │   ├── prestige.ts     top-30 averaging
│       │   ├── optimise.ts     atomic moves enumeration
│       │   ├── ceiling.ts      ceiling/headroom analysis
│       │   └── costs.ts        cost-gating classification
│       └── __tests__/
├── data/
│   ├── formulas/
│   │   └── multipliers.json    rank × ascension × sig-curve archetypes
│   ├── champions/
│   │   └── *.json              one per champion
│   ├── _generated/             build artefacts (synergy graph)
│   └── _verified/              ground-truth observations
├── scripts/
│   ├── seed-from-mcochub.ts    one-time data ingestion
│   ├── sync-drift-check.ts     nightly drift detector (Phase 2+)
│   └── build-graph.ts          synergy graph generator
└── .github/workflows/
```

Monorepo with pnpm workspaces. Engine published as `@prestige-tools/engine` from v2.

## 7. Data architecture

### 7.1 Per-champion JSON (`data/champions/<slug>.json`)

```json
{
  "id": "spider-man-pavitr-prabhakar",
  "name": "Spider-Man (Pavitr Prabhakar)",
  "class": "Mystic",
  "ascendable": true,
  "tags": ["spider-verse", "young-avengers"],
  "released": "2025-06-15",
  "prestige": {
    "rank5": { "0": 30060, "50": 33500, "100": 36400, "150": 38600, "200": 40290 },
    "rank4": { "0": 25340, "50": 28230, "100": 30680, "150": 32540, "200": 33970 },
    "rank3": { "0": 20760, "50": 23130, "100": 25140, "150": 26660, "200": 27830 }
  },
  "sigCurve": null,
  "synergies": [
    {
      "with": "spider-man-2099",
      "name": "Spider-Verse Allies",
      "effects": {
        "self":  "+10% perfect block chance",
        "other": "+10% perfect block chance"
      },
      "isUnique": false,
      "_introducedIn": "v52.0"
    }
  ],
  "immunities": [
    { "effect": "bleed", "potency": 100, "duration": 100 }
  ],
  "inflicts": ["web", "concussion"],
  "_meta": {
    "lastVerified": "2026-05-09",
    "verifiedBy": "github-username",
    "gameVersion": "v55.0",
    "bhrSource": "mcochub.insaneskull.com",
    "ascendableSource": "kabam-forum-2026-02-13"
  }
}
```

Key v5 changes:

- **Per-rank sig brackets** at 5 anchor points (0, 50, 100, 150, 200) per rank. Sig 0 and sig 200 are seeded from MCOCHUB / mcoc.gg / auntm.ai reference data. Intermediate sig levels (50, 100, 150) are `null` for most champions at seed time; the engine falls back to the rank-default sig curve when intermediates are missing.
- **`sigCurve` override** is `null` for standard champions, or a curve identifier for non-standard ones (Aegon, Hercules, Domino, etc.).
- **No more `signatureCurve: "standard"` string** — the override field captures this more honestly.

### 7.2 Universal multipliers (`data/formulas/multipliers.json`)

```json
{
  "ranks": {
    "5": 1.0000,
    "4": 0.8431,
    "3": 0.6906,
    "2": null,
    "1": null
  },
  "ascension": {
    "A0": 1.00,
    "A1": 1.08,
    "A2": 1.16
  },
  "sigCurves": {
    "rank5_default": [0.0000, 0.2400, 0.3100, 0.4700, 0.5600, 0.6500, 0.7300, 0.8000, 0.8700, 0.9400, 1.0000],
    "rank4_default": [0.0000, null, null, null, null, null, null, null, null, null, 1.0000],
    "rank3_default": [0.0000, 0.2400, 0.3600, 0.4600, 0.5600, 0.6400, 0.7200, 0.8000, 0.8700, 0.9400, 1.0000],
    "_anchors_sig": [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200]
  }
}
```

**v5 update:** R3 multiplier locked at 0.6906 from auntm.ai data (Onslaught: 28,024/40,580, Silver Surfer: 27,865/40,320, QuickSilver: 27,810/40,260 — all 0.6906-0.6911 to four decimals). R3 and R5 sig curves derived from same source. R4 sig curve is the gap; can be populated from another auntm.ai screenshot or geometrically interpolated as a fallback. R2 and R1 multipliers remain null — R2 and below champions cannot reach top-30 prestige and are out of scope for v1.

### 7.3 Sig curve handling

The sig curve is **rank-dependent and slightly champion-dependent**, but the rank-default curves are accurate to within 5-50 BHR for standard champions.

Engine logic:

```typescript
function sigFraction(rank: number, sigBracket: number): number {
  // sigBracket is 0..10, representing sig levels 0, 20, 40, ..., 200
  const curve = MULTIPLIERS.sigCurves[`rank${rank}_default`];
  return curve[sigBracket] ?? linearFallback(curve, sigBracket);
}

function bhr(champion, rank, sig, ascension): number {
  const sig0  = champion.prestige[`rank${rank}`]["0"];
  const sig200 = champion.prestige[`rank${rank}`]["200"];
  const frac = sigFraction(rank, sigBracketFor(sig));
  const base = sig0 + frac * (sig200 - sig0);
  return Math.round(base * MULTIPLIERS.ascension[ascension] / 10) * 10;
}
```

For champions with `sigCurve != null`, the engine looks up `sigCurves[champion.sigCurve]` instead of the rank default. This handles Aegon, Hercules, Domino, etc., without contaminating the rank-default values.

### 7.4 Outbound-only synergy authoring

Every synergy is authored exactly once, on whichever champion's patch notes introduced it. New champion arrives with a synergy → it lives in the new champion's file. Existing champion gets buffed → it lives in the *buffed* champion's file. The synergy entry is bilateral by structure (`effects.self` and `effects.other`).

The build script (`scripts/build-graph.ts`) reads every champion file, dedupes any double-authoring (warns in CI), and writes `data/_generated/synergy-graph.json`.

### 7.5 Build-time validation

Every PR runs:

1. JSON Schema (Zod) validation on every champion file
2. Custom checks: synergy targets exist, sig curves monotonic, computed BHR matches §16 ground-truth within ±30 per champion and ±5 aggregate, no orphaned tags
3. Engine unit tests (Vitest)
4. Static export build of the Next.js app

A failing check blocks merge.

## 8. The optimisation engine

The engine has two modes that share data and primitives but answer different questions.

### 8.1 Atomic moves view ("what's my next move?")

```typescript
type AtomicMove =
  | { kind: 'rank-up';   champion: ChampionId; fromRank: 4; toRank: 5 }
  | { kind: 'sig-up';    champion: ChampionId; fromSig: number; toSig: number; stones: number }
  | { kind: 'ascend';    champion: ChampionId; toLevel: 'A1' | 'A2' };

type ScoredMove = {
  move: AtomicMove;
  newChampionBHR: number;
  top30Delta: number;
  costGates: CostGate[];     // see §20
  deferRecommendation?: 'ascend-first' | null;
  rank: number;              // 1, 2, 3 in the output list
};

function enumerateAtomicMoves(roster: Roster): ScoredMove[];
```

Algorithm:

1. Enumerate every atomic move available to any champion in top-30 *and* champions within ~2,000 BHR of the cutoff
2. For each, compute `newChampionBHR` via §7.3
3. Re-sort the roster, recompute top-30 average, derive `top30Delta`
4. Apply deferral check: if move is R4→R5 on a champion with `ascendable: true` and current ascension == A0, flag `deferRecommendation: 'ascend-first'`
5. Attach cost gates per §20
6. Sort by `top30Delta` descending, return top 5-10

### 8.2 Ceiling view ("what's worth investing in?")

```typescript
type CeilingEntry = {
  champion: ChampionId;
  currentBHR: number;
  ceilingBHR: number;
  headroomBHR: number;
  prestigeDeltaIfMaxed: number;
  inTop30: boolean;
  pathToMax: AtomicMove[];   // the sequence to reach ceiling
  totalCostGates: CostGate[];
};

function computeCeilings(roster: Roster): CeilingEntry[];
```

For each owned champion (every R3+), compute:

```
ceilingBHR = champion.prestige.rank5["200"] × ascensionMultMax
           where ascensionMultMax = 1.16 if ascendable else 1.00

prestigeDeltaIfMaxed = inTop30
                        ? (ceilingBHR - currentBHR) / 30
                        : Math.max(0, (ceilingBHR - top30Cutoff) / 30)
```

Sort by `prestigeDeltaIfMaxed` descending. This is the answer to "where should my long-term progression go." It's harder to act on than atomic moves (the path can take months), but it's the right framing for resource planning.

### 8.3 Deferral logic

The "ascend before R5-rank" sequencing rule:

> If a champion is currently A0 and ascendable, prefer ascending to ranking up. The rank-up itself isn't wasted, but the optimal sequence (ascend, then rank-up at the higher ascension level) captures more prestige than the reverse order.

In practice, this rule **only deprioritises R4→R5 on A0-ascendable champions** — A1 champions can be ranked up without losing future ascension value. The recommendation list surfaces these moves but flags them with `deferRecommendation: 'ascend-first'`; the UI shows them lower in the list or in a separate "deferred" group.

This is a real rule, not heuristic — but it has edge cases (player has given up on ascension pulls, has stale rank-up catalysts to use, etc.) that the engine can't know. The flag is advisory; the user decides.

## 9. Information architecture

```
/                              Recommendations (default landing)
/roster                        Roster picker + roster table view
/champions                     Filterable champion list
/champions/[slug]              Detail page (statically prerendered)
/about                         What this is, the math, attribution, tip jar
```

The recommendations view defaults to atomic moves (the "next move" question), with a clearly-labelled toggle to ceiling view (the "long-term picture" question). The roster table is its own surface — sortable columns, filter chips at the top, exportable.

### 9.1 Roster table columns

| Column | Description | Sort | Filter |
|---|---|---|---|
| Champion | Name + class icon + ascension badge | Alpha | — |
| Class | Class | A-Z | Chip multi-select |
| Current BHR | What they show as today | Numeric desc default | — |
| Ascendable | Yes/no with provenance pip | — | Toggle |
| In top-30 | Indicator | — | Toggle |
| Ceiling | Max BHR at R5 sig 200 max ascension | Numeric | — |
| Headroom Δ | Ceiling − Current | Numeric | Range |
| Prestige impact | Δ if maxed (top-30 average effect) | Numeric desc | — |
| Cost gate | One of {rank, sig, ascend, compound} | — | Chip |

Borrows mcoc.gg's table shape, adds personalised columns (current BHR, in-top-30, prestige impact), and crucially adds **filters and fast sort** — both things mcoc.gg lacks.

## 10. Visual direction — Variant D (Hybrid)

Editorial almanack discipline 90% of the time, comic-book exuberance at the single moment of impact. Bungee strictly inside the burst. Marvel red `#ED1D24` for impact, `#C8202C` for editorial. Cream paper `#f1e8d6`. Fraunces + Libre Franklin + JetBrains Mono + Bungee.

Two specific moments where the burst appears:

1. **Top recommendation card** on the recommendations view — the +N prestige delta in Bungee inside a starburst
2. **Roster table "max obtainable" column** for the champion you're hovering — a tiny burst preview

Everything else: clean editorial typography, generous whitespace, restrained colour.

## 11. Build & deployment

```
git push → GitHub Actions
              ├─ validate Zod schemas
              ├─ engine unit tests (reproduce §16 within ±30 per champion, ±5 aggregate)
              ├─ build derived synergy graph
              ├─ Next.js static export
              └─ deploy to Cloudflare Pages
```

Total cycle target: under 90 seconds.

Note on tolerance: Phase 0 verification against the §16 ground-truth roster showed 17 of 30 champions matched exactly, mean abs error 6.7, max 30. The per-champion tolerance is set to ±30; aggregate prestige predicted 36,115 vs game's 36,120 (off by 5).

## 12. Phasing

### Phase 0 — Personal CLI ✅ COMPLETE

Delivered:

1. MCOCHUB ingestion script with full 254-champion data
2. Universal multipliers locked: R3=0.6906, R4=0.8431, R5=1.000, A0=1.00, A1=1.08, A2=1.16
3. Sig curves derived for R3 and R5 (R4 pending or geometrically interpolated)
4. `lib/engine/bhr.ts`, `lib/engine/prestige.ts`, `lib/engine/optimise.ts` working
5. CLI `pnpm cli` produces ranked recommendations with cost labels
6. Engine verified against Dave's roster — aggregate prestige matches in-game value to 5 BHR
7. Two-mode framing (atomic + ceiling) established as the product shape
8. Top recommendations beat naive intuition: surfaced High Evolutionary A2 ascension as a +217 move; surfaced Blue Marvel as a +449 long-term play despite being outside Dave's top-30

Phase 0 is the moment the optimiser stopped being a hypothesis. **Proceeding to Phase 1.**

### Phase 1 — Web v1 (weeks 1-3)

1. Architecture doc v5 locked → repo skeleton scaffolded
2. Engine code migrated from Phase 0 CLI to `packages/engine`
3. Full champion data seeded from MCOCHUB
4. Roster picker UI (typeahead, add at state)
5. Roster table view (the killer surface)
6. Recommendations view (atomic + ceiling, cost-labelled)
7. Champion list + detail pages (light — synergies + class + ascendable)
8. Variant D visual direction applied
9. Deploy to Cloudflare Pages preview at chosen domain (likely `mcoc.help`)
10. Soft launch to alliance, feedback loop

### Phase 2 — Polish + Layer 1/2 data hygiene (weeks 4-5)

1. Drift detector (nightly CI cron against MCOCHUB)
2. Patch-note triage habit established
3. Community correction flow (in-app form → GitHub PR)
4. Refine sig curves with intermediate data points from user submissions
5. Address any v1 launch issues
6. Public announcement (Reddit, forum)

### Phase 3 — Compound interest (weeks 6+)

1. OCR import for roster (prestige page screenshot → parsed roster)
2. Relic prestige optimiser (the other 6% of prestige)
3. Multi-step planner (deferred from v1 scope)
4. Engine published as `@prestige-tools/engine` npm package

### Phase 4 — Long-term contingency

1. APK extraction fallback if MCOCHUB ever goes dark
2. Multi-language support
3. Alliance-level features (only if there's real demand)

## 13. The OCR target — Prestige page

The in-game prestige page (Profile → Top 30 Prestige) is the canonical screenshot to OCR for roster import:

- Already filtered to top 30 by BHR
- BHR is the displayed number
- Per-card fields in fixed positions (champion portrait, name, BHR, class indicator, ascension badge)
- Layout is grid (5 wide × 6 rows on tablet, single/double column on phone)

A reasonable v2 OCR pipeline: paste screenshot → crop into card-sized tiles via fixed grid → OCR name + BHR → classify class via colour-sampling → detect ascension pip count → identify champion via perceptual hash against a portrait library → confirmation grid before commit.

**v5 note:** the Windows version of MCOC produces cleaner screenshots than mobile and is easier to OCR. May be worth recommending players use Windows for the initial roster capture.

## 14. Open questions

### 14.1 R4 sig curve

Have R3 and R5 derived. R4 not yet derived. Options:

- (a) Geometrically interpolate between R3 and R5 curves
- (b) Capture a second auntm.ai screenshot at R4 (preferred if available)
- (c) Empirically derive from user roster observations at intermediate sig

Lean toward (b) — Dave has the screenshot capability and one more screenshot closes this.

### 14.2 R2/R1 multipliers

Out of scope for v1 — champions at R2 or below cannot reach top-30 prestige. Revisit only if a use case emerges.

### 14.3 Per-champion sig curve overrides

Aegon, Hercules, Domino (and possibly Mister Sinister) have non-standard sig curves. Encode 3-5 named archetypes; assign per-champion in JSON; verify in CI. Identify by observation when populating Phase 1 data.

### 14.4 Domain name

Leaning **`mcoc.help`** — three syllables, descriptive, shareable in alliance chat. Verify availability before Phase 1 deploy.

### 14.5 Burst number rendering polish (deferred)

Bungee + 2px stroke at 78px sits heavy. Phase 3 polish.

### 14.6 Outreach timing

InsaneSkull (MCOCHUB) and BrutalDX (mcoc.gg) outreach — before launch or after soft-launch with something to show? Lean toward "after soft-launch" so the conversation starts with a working artifact, not a pitch.

## 15. Decision log

| Decision | Rationale |
|---|---|
| Lookup, not planner (v1) | Removes stash-input friction; matches actual usage cadence. |
| No resource inventory in v1 | Costs shown as labels; user mentally filters. |
| Champion prestige only in v1 | Champion is 94% of total prestige (36,120/38,410 in verified roster); relic is its own problem. |
| BHR is the metric, not PI | Prestige uses BHR; PI includes synergies/masteries/relics and is irrelevant to prestige calc. |
| Store BHR values directly, not computed from base stats | MCOCHUB has reference values for all 254 champions. Multiplicative model fits exactly. |
| Next.js over SvelteKit | Boring stack wins on supportability and LLM consistency. |
| Outbound-only synergy authoring | One file edit per change. |
| Variant D — Hybrid | Editorial restraint with a single comic moment. |
| Marvel red, two intensities | `#ED1D24` for impact, `#C8202C` for editorial. |
| "Read the working →" CTA | Honest about the tool's role. |
| Free with tip jar, no paywall | Khonshu's $3/month is the wedge. |
| Engine as pure module | Testable, extractable, reusable. |
| Prestige page as OCR target | Top-30 already filtered, BHR shown directly, ascension visible. |
| Seed BHR from MCOCHUB | Saves months of derivation. Cite + credit prominently. |
| **v5: Two-mode engine (atomic + ceiling)** | Atomic answers "what's my next move," ceiling answers "what's worth investing in." Different mental models, both needed. |
| **v5: Roster table as v1 surface** | mcoc.gg shape but personalised + filterable. Browse mode complements lookup mode. Reference + planner in one. |
| **v5: Ascension pool as binary flag** | Champions rotate *in* but not *out* of pools. Once ascendable, always ascendable on a 6-month horizon. No need for rotation tracking. |
| **v5: Deferral logic for R4→R5 on A0-ascendable** | "Ascend before rank" sequencing rule. Engine surfaces the move but labels it for the user's call. |
| **v5: Per-rank sig curves, optional per-champion override** | Curve shape is rank-dependent. Sig 0→100 worth more than sig 100→200 at every rank. Per-champion override handles edge cases (Aegon etc.). |
| **v5: Four-axis cost gating** | Rank cats, sig stones, ascension mats, compound. Sig stones surfaced as a separate cost type because they're often the binding constraint. |
| **v5: MCOCHUB cited prominently, not silently scraped** | Their data, their attribution. Outreach to InsaneSkull and BrutalDX after soft-launch. |
| **v5: Phase 0 complete, proceeding to Phase 1** | Engine math verified, framing right, recommendations beat intuition. Next deliverable is web v1. |

## 16. Verified data points (Phase 0 ground truth)

### Champion roster

Captured 2026-05-06 from in-game prestige page.

**Summoner:** mu3rto · LVL 66 · Necromaster · Platinum 3 · Alliance LONGSHOT
**Top 30 Prestige:** 38,410 (Champion 36,120 + Relic 2,290)
**Top 30 cutoff (rank 30):** Imperiosa at 33,470 BHR
**Roster size:** 232 7-star champions captured from Windows version screenshots

### Multipliers (all empirically locked)

| Constant | Value | Verified against |
|---|---|---|
| R5 mult | 1.0000 | Definition |
| R4 mult | 0.8431 | Maestro, Nova, Deadpool, IIM (cross-confirmed) |
| R3 mult | 0.6906 | Onslaught, Silver Surfer, QuickSilver (auntm.ai) |
| R2 mult | null | Out of scope (R2 cannot reach top-30) |
| R1 mult | null | Out of scope |
| A0 mult | 1.00 | Definition |
| A1 mult | 1.08 | IIM, Pavitr, all A1 champions |
| A2 mult | 1.16 | Lizard, Patriot, Maestro, Nova, Deadpool |

### Sig curve normalised fractions

| Sig | R5 fraction | R3 fraction |
|---|---|---|
| 0 | 0.00 | 0.00 |
| 20 | 0.24 | 0.24 |
| 40 | 0.31 | 0.36 |
| 60 | 0.47 | 0.46 |
| 80 | 0.56 | 0.56 |
| 100 | 0.65 | 0.64 |
| 120 | 0.73 | 0.72 |
| 140 | 0.80 | 0.80 |
| 160 | 0.87 | 0.87 |
| 180 | 0.94 | 0.94 |
| 200 | 1.00 | 1.00 |

R3 and R5 curves diverge most at sig 40 (0.31 vs 0.36). R4 curve TBD.

### Top-30 BHR observations (truncated; full in seed file)

| # | Champion | Class | State | BHR |
|---|---|---|---|---|
| 1 | Lizard | Science | R5 sig 200 A2 | 46,120 |
| 2 | Patriot | Skill | R5 sig 200 A2 | 45,770 |
| 3 | High Evolutionary | Science | R5 sig 200 A0 | 40,600 |
| 4 | Maestro | Mystic | R4 sig 200 A2 | 38,550 |
| 5 | Nova | Cosmic | R4 sig 200 A2 | 38,500 |
| ... | (25 more) | | | |
| 30 | Imperiosa | Cosmic | R4 sig 200 A0 | 33,470 |

**Aggregate verification:** sum 1,083,610 / 30 = 36,120.33 → game shows 36,120 ✓

## 17. Data sourcing & attribution

Primary upstream: **MCOCHUB** at `https://mcochub.insaneskull.com/prestige`, maintained by InsaneSkull. The data covers ~254 7-star champions with R5 sig 0 and R5 sig 200 BHR, plus per-state breakdown for ascendable champions.

Secondary cross-check: **mcoc.gg** at `https://mcoc.gg`, maintained by BrutalDX. Has a Prestige table view launched April 2026; useful for cross-validation and for catching new champions.

Metadata source: **Marvel Contest of Champions Fandom wiki** at `https://marvel-contestofchampions.fandom.com`, CC-BY-SA licensed. Champion identity, class, release date, ascension status. Most permissive license of any source available.

Historical reference: **auntm.ai** (frozen mid-2024) for intermediate sig-level breakdowns at older ranks. Used in Phase 0 to derive R3 and R5 sig curves.

### Approach

1. **Cite prominently.** The footer of every page, the about page, and the README all credit MCOCHUB, mcoc.gg, and the Fandom wiki with direct links.
2. **Reach out to maintainers after soft-launch.** Email InsaneSkull and BrutalDX with the working tool, explain attribution, offer to feed corrections back. The MCOC tool community is small; relationships matter.
3. **Verify, don't assume.** Spot-check data against in-game observations periodically. The `_meta.lastVerified` field per champion enables this hygiene.
4. **One-time ingestion + drift detection.** `scripts/seed-from-mcochub.ts` runs once to populate champion stubs. `scripts/sync-drift-check.ts` runs nightly in Phase 2+ to catch drift.
5. **Abstraction layer.** Data fetching goes through an interface so MCOCHUB can be swapped for mcoc.gg, auntm.ai, or our own APK extraction if needed.

### Single-point-of-failure risk

MCOCHUB is community-funded and maintained by one person. If it ever goes dark (as auntm.ai effectively did), our data pipeline breaks. Mitigations:

- **Aggressive local caching.** Once seeded, the data lives in git; we don't need MCOCHUB to be up to serve the site.
- **Cross-check redundancy.** mcoc.gg covers the same data with different maintenance. If one fails, the other survives.
- **APK extraction fallback (Phase 4).** If both aggregators fail, build our own extraction pipeline from the game APK. Higher legal risk; only as last resort.

The risk is real but not urgent. Document it; build with the abstraction; don't over-engineer for it yet.

### Champion portrait sourcing

Per-champion portrait images are owned by Kabam and Marvel. The Fandom wiki hosts them under fair use, but **images on Fandom are not CC-BY-SA** — Fandom is explicit that only text is licensed under CC-BY-SA, and non-text media is presumed copyrighted. The wiki's fair use claim does not transfer to us.

Pragmatic approach for v1: **hot-link from Fandom's CDN with attribution**, falling back to in-house class icons (inline SVGs, our own visual language) when a portrait URL is null or fails to load. The fair use defence for our use is reasonable — free informational tool, transformative purpose (helping players optimise their progression), doesn't substitute for the original product — but is not bulletproof and would weaken if we ever monetised.

Honest acknowledgement of the risks:

- **Legal:** low likelihood of takedown for a free attributing tool, but real.
- **Practical:** Fandom could change URL structure or block our referer; portraits then disappear and we fall back gracefully to class icons.
- **Ethical:** we're freeloading on Fandom's bandwidth. Long-term, ask InsaneSkull/BrutalDX whether they'd host portraits we can reliably link to, or pursue a Kabam partner-developer asset pack (low probability, worst answer is "no").

The class-icon fallback is the safety net. Inline SVG, six lightweight glyphs (Cosmic / Mystic / Mutant / Science / Skill / Tech), no IP risk because they're our own stylised geometric representations. Even if every Fandom portrait broke tomorrow, the site keeps working — it just looks less rich.

Phase 1 ships with `portraitUrl: null` on every champion (so all 254 render as class icons). Phase 2 includes a Fandom URL scraper that populates `portraitUrl` per champion as part of the seed ingestion.

## 18. Data update process

The data ages. New champions ship every 2-3 weeks; existing champions get tuned; the ascension pool expands. Without deliberate maintenance, the optimiser silently drifts toward inaccuracy. Three layers:

**Layer 1 — Patch-note triage (manual, weekly).** Kabam's official patch notes are authoritative for what's *announced*. A maintainer subscribes to the forum RSS and triages each release into GitHub issues. Catches announced changes. Cost: 15-30 min per patch cycle.

**Layer 2 — Drift detector (CI cron, nightly).** A GitHub Action fetches MCOCHUB's prestige page, diffs every champion's R5 sig 200 BHR against committed values, opens an issue if anything moves by >0.1%. Catches unannounced changes. No auto-merge. Cost: ~1 day to build, then maintenance-free.

**Layer 3 — Community correction flow.** "Suggest correction" button on every champion detail page → structured form → GitHub API opens a PR with the user as co-author. Trusted contributors get merge rights after N accepted PRs. Catches the edge cases. Cost: ~1 day.

Plus `_meta.lastVerified` per champion and a quarterly audit cron that opens issues for stale entries.

**Phasing.** Layer 1 starts at Phase 1 launch (just a habit). Layers 2 and 3 are Phase 2 work — once the engine is proven and there's data worth defending.

## 19. Ascension pool model

The MCOC ascension pool is **monotonically expanding**:

- **Base pool (March 2026):** 30 champions across 6 classes (5 per class). Listed in Kabam's official forum posts.
- **RER (Releases Eligible for Recombination):** featured champions released since Lizard are auto-ascendable.
- **Featured rotations:** champions in monthly featured Grace crystals are ascendable while featured.
- **Sale rotations:** champions in monthly sale crystals are ascendable while on sale.
- **Titan crystal pool:** ascendable.
- **Basic 7-star crystal:** champions cycle into this over 3-6 months after first release.

The key insight: **once a champion is in any pool, they're effectively always in some pool** within a 6-month horizon. Sale-rotation is real but irrelevant for our model — if a champion is currently sale-ascendable, they'll be Titan-ascendable shortly after; if they're Titan-ascendable, they'll be basic-crystal-ascendable eventually.

Conclusion: **single binary flag `ascendable: true/false`**, no rotation tracking, no monthly maintenance overhead. Iron Man classic is `ascendable: true` because even though he's only sale-ascendable this month, the rule "this changes" is wrong — within 6 months he'll be in Titan + basic pools.

The pool of "permanently non-ascendable" champions is small and stable: champions from before the 7-star era that never get featured/sale rotations. These are clearly `ascendable: false`.

Source of truth for ascendable status: cross-reference of MCOCHUB's per-state prestige columns (presence/absence of A1/A2 columns) and Kabam forum's ascension reveal posts. Maintained per-champion in JSON.

## 20. Cost-gating taxonomy

Every recommendation move has 1-4 cost gates. The UI labels each move with its gates so the user can filter mentally:

### 20.1 Rank catalysts (deterministic)

- T6 Basic + T3 Alpha catalysts for R4→R5
- Generic + class-specific
- Farmable through normal play; gate is time + grind, not luck

**Label:** `[T6B + T3A {class}]`

### 20.2 Sig stones (semi-deterministic, often bottlenecked)

- Generic sig stones from arena, events, AQ crystals
- Class-specific sig stones from certain events
- Accumulated through play but bottlenecked — generic stones are precious resource for Paragon players

**Label:** `[generic sig stones × N]` or `[{class} sig stones × N]`

### 20.3 Ascension materials (luck-gated)

- A1 cluster drops from featured Grace crystals
- A2 cluster drops from featured Grace crystals
- Pure RNG, no farming path

**Label:** `[A1 cluster — pulls req'd]` or `[A2 cluster — pulls req'd]`

### 20.4 Compound (multiple cost types)

Move requires combinations of the above. UI shows compound labels with all gates listed.

**Label:** `[T6B + T3A {class} + A2 cluster]`

### 20.5 State-persistence confidence (advisory, not engine-tracked)

Not a cost gate per se, but a soft factor: some moves commit the player to a state they may want to revisit. E.g. R4→R5 on Pavitr at A1 is a "real" move in the sense that no resources are lost, but if A2 materials drop unexpectedly, the player may wish they'd held the rank-up resource for a different champion.

The engine surfaces this as an annotation on moves where:

- Champion is ascendable and currently below max ascension, AND
- Move advances rank or sig (not ascension)

Annotation reads: "fully captures current ceiling; further ascension still possible."

The user decides whether to weight this in their decision.

## 21. Outreach plan

To be done after soft-launch with a working tool, not before.

**InsaneSkull (MCOCHUB):** email via the support page, name the project, demo the tool, attribute clearly, offer correction-feeding-back, ask about scrape cadence preferences.

**BrutalDX (mcoc.gg):** X/Twitter DM to `@mcocgg`, same shape. Mention the parallel work in the space, offer collaboration on shared schema or data corrections.

**CereBro:** introduce later, after both above. Different surface area (Discord bot for alliance management) but same underlying data problem; potential for sharing schema.

**MCOC Discord communities:** organic launch post in the Unofficial Discord, no spam.

**Reddit:** announcement post in r/ContestOfChampions when v1 is stable.

Soft-launch first to Dave's alliance (LONGSHOT) to shake out bugs before public outreach.

## 22. Roster share feature

Added during Phase 1 build (post-v5 architecture lock) because of the alliance-war/AQ planning use case — sharing a roster as a link is the kind of feature that gets people to switch tools. Plain-text "screenshot my prestige page and paste it in Discord" is the current alternative; doing better than that is the wedge.

### Shape

- User clicks "Share roster" on `/roster/` → modal opens with optional label field
- Clicks "Generate share link" → POST to `/api/share` → returns short ID (8 base62 chars)
- URL is `mcoc.help/r/?id=<id>` — recipient sees view-only render of the roster
- Storage: Cloudflare KV with 6-month TTL; share auto-deletes at expiry
- Read-only view shows portrait grid sorted by BHR descending, plus top-30 summary card
- "Import this roster" button on the read-only view (with explicit confirmation that it replaces current roster) — secondary action, not the primary path
- Optional delete: the create response includes a delete token; user can `DELETE /api/share/<id>?token=<token>` to nuke their own share early. Delete tokens are also saved client-side in localStorage under `prestige-tools:my-shares` for Phase 2 "my shares" management UI.

### Encoding choice

Full JSON, not stripped positional arrays. Considered the size savings but rejected — the difference (10KB vs 20KB per share at 232 champions) is irrelevant at Cloudflare KV's 25MB-per-value limit and 100MB request body limit. Stripped arrays force a versioning migration whenever ChampionState gains a field; full JSON adds the field and old shares keep working. Plus full JSON is human-readable in the KV inspector, which matters for debugging.

### Abuse mitigation

- **Payload size limit:** 50KB per request — well above any real roster
- **Champion count limit:** 1-500 champions per share
- **Rate limit per IP:** 10 shares/hour, 100 shares/day, enforced via KV counters with TTL
- **Honeypot field:** hidden `website` field rejected if non-empty (catches dumb scrapers)
- **Zod-equivalent validation:** strict schema check on every field before storage
- **TTL:** 6 months; storage stays bounded forever, no growing database of dead shares
- **Cloudflare's standard bot detection** at the network layer (came free with hosting there)

Not implementing: CAPTCHA on share creation (heavy-handed), payload fingerprinting (low value), checkbox confirmations (pointless friction). The combination above is sufficient for a free tool with no monetary value to attack.

### The no-backend exception

The original v5 architecture committed to "no backend in v1; everything client-side." This share feature breaks that rule. Worth being explicit about why and what's preserved:

- **Still preserved:** the main application (recommendations, roster editing, champion browsing) remains entirely client-side. Personal rosters live in localStorage. Nothing leaves the user's device unless they explicitly click "Share".
- **What's new:** Cloudflare Pages Functions handle two endpoints (`POST /api/share`, `GET /api/share/<id>`, plus `DELETE`). KV namespace stores the shared rosters. Single-purpose, small, self-cleaning.
- **Why bend the rule:** the feature requires a server-side lookup table to give short URLs. Hash-fragment URLs (the no-backend alternative) would be 1-2KB long, get truncated by chat clients, break the alliance-share use case entirely.
- **What we accept:** one more thing that can break, abuse risk (mitigated above), data living briefly on Cloudflare's servers (opt-in only).

The architecture doc's "no backend" rule should be re-read as "no backend for the main application loop" — share is an additive opt-in feature that uses minimal backend. Future opt-in features (e.g. a "claim a username" flow, see Phase 2 below) can use the same pattern.

### Phase 2 enhancements

- **Named shares:** `mcoc.help/r/<name>` (e.g. `mcoc.help/r/mu3rto`) via a "claim a custom name" toggle on the share modal. Name + 4-digit PIN; PIN required to update/replace the share at that name. No accounts, no email, just claim-with-PIN. Implementation: route `_redirects` rule rewrites `/r/<name>` to `/r/?id=<name>`, or upgrade `/r/<id>` to dynamic Next.js route via a build-time generator if more routes need this pattern.
- **My Shares page:** `/me/shares/` lists shares the current browser has created (from `prestige-tools:my-shares` localStorage), with delete buttons.
- **Compare-rosters mode:** open two share URLs side-by-side for alliance-war "their roster vs ours" view.

### Implementation files

- `functions/api/share/index.ts` — POST endpoint (create)
- `functions/api/share/[id].ts` — GET and DELETE endpoints
- `apps/web/app/r/page.tsx` — view-only page (reads `?id=` search param)
- `apps/web/components/share-modal.tsx` — share creation UI
- `apps/web/components/shared-roster-view.tsx` — the read-only display
- `apps/web/lib/share-client.ts` — client-side API wrappers

### Deploy implications

The first deploy needs an extra dashboard step beyond what was in §11: create the `ROSTERS_PROD` KV namespace, bind it to the Pages project as `ROSTERS`. See DEPLOY.md for the walkthrough.

---

*Next concrete step: Phase 1 kickoff. Generate the Next.js + Tailwind v4 project skeleton, migrate the Phase 0 engine into `packages/engine`, run the MCOCHUB seed ingestion, scaffold the three primary views. The §16 ground-truth roster is the regression target.*
