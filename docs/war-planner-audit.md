# Season 69 war planner — pre-build audit

Read `war-planner-handover.md` first. This audit answers the five questions the handover asks under **Step 0** before any feature code is written. It ends with open questions I need Dave to decide before I start building.

Mockup: [Season 69 war planner (alpha mockup)](https://claude.ai/artifact/2vkwDoxruvF6c858wsxijs). The solver and export code inside it are the reference — port, don't reinvent.

---

## 1. Design system fit

The mockup was authored in isolation and shipped with its own tokens. Where it diverges from the live site, the live site wins.

**Where they already agree**

- Warm-black dark palette. Mockup `--bg: #14110d` matches `--brand-warm-black`. `--surface: #1c1813` maps 1:1 to `--brand-panel`. `--line: #3a3127` is a shade off `--brand-line: #362f24` — close enough to swap.
- Fonts. Mockup loads Fraunces + Libre Franklin via Google Fonts. Site already uses both via next/font: `--font-display` (Fraunces) and `--font-body` (Libre Franklin). Nothing new to load.
- Gold accent. Mockup `--gold: #d9a93f` is not in the semantic layer today; needs promoting to a token so pinned rings, focus outlines and export badges share one value across the site.
- Marvel red. Mockup `--red2: #C8202C` matches `--brand-marvel-editorial`. Site's dark-mode override softens it (`--brand-marvel-soft`) so any large blocks of red need re-checking; small chips are fine.

**Where the mockup needs to adopt the site**

- **Light theme.** The mockup is dark-only. The site is light-first (cream/#f1e8d6) with a `[data-mode]` toggle that swaps every semantic token. Every colour used in the planner must resolve via `var(--color-*)` so it flips cleanly. The war-map SVG background gradient (`radial-gradient(ellipse at 50% 55%, #1f1a13, var(--bg))`) needs a light-mode pairing. Suggest `var(--color-paper-soft)` centre → `var(--color-paper)` edge, with lane cell colours slightly desaturated for contrast against cream.
- **Nav.** The mockup shows a 4-item nav ("Recommendations / Roster / Immunities / War defence"). The real site's nav has eight items (Recommendations · Roster · Relics · War · Immunities · Prestige · Champions · About). The planner mounts inside the existing shell — don't ship the mockup's simplified nav.
- **Header brand block.** Mockup renders `mcoc.help` in Fraunces 800/20px inline. Site uses `.editorial-heading` on the wordmark with a "beta" chip beside it. The Alpha chip stays on the H1, not the wordmark.
- **Typography scale.** Mockup uses direct `font-family: var(--serif)` and inline pixel sizes. Site convention is Tailwind classes plus semantic font tokens. Rewrite to Tailwind + `font-[var(--font-display)]` (or the existing `.editorial-heading` where appropriate) so type stays coherent site-wide.
- **Buttons.** Mockup `.btn`, `.btn.go`, `.btn.sm` are ad-hoc. The site's button treatment is Tailwind utilities on a `<button>` with `border-[var(--color-rule)] bg-[var(--color-paper)] hover:border-[var(--color-marvel-impact)] hover:text-[var(--color-marvel-impact)]`. Port to the same pattern.
- **Segmented control (BG1/2/3, tabs).** Mockup uses `.seg button[aria-pressed]` and `.tabs button[aria-selected]`. The roster page already has a `FilterChipGroup` component that does the segmented look — reuse it, don't build a second one.
- **Focus outline.** Mockup uses gold. Site does not set a global focus token; keep the mockup's `outline: 2px solid var(--color-gold, ...)` but scoped to the planner, and open a follow-up ticket to promote it site-wide rather than doing it in this PR.
- **Modal / long-press export dialog.** Mockup rolls its own `.modal`. Nothing else on the site uses a modal today. This is the first one — keep it minimal, but write it as a small `<Modal>` component so future dialogs can share it, and give it a focus-trap.
- **Reduced motion.** Mockup respects `prefers-reduced-motion` for the reveal/pulse animations. Match that. The site does no other motion; nothing to align against.

**Bottom line.** No new fonts or colours; the raw hexes align. The porting work is (a) rewrite CSS as Tailwind + semantic tokens, (b) add a light-mode pass to every visual element, (c) reuse the site's chip/button/toggle components instead of the mockup's inline styles.

---

## 2. Reuse map

Modules that already exist and should be pulled in rather than duplicated.

**Roster sharing (KV)** — `apps/web/lib/share-client.ts`, `share-pool-client.ts`, `share-bg-client.ts`, backed by `functions/api/share/**`, `share-pool/**`, `share-bg/**`.

- Individual player rosters use `/api/share` with a `mode: 'snapshot' | 'live'` flag. Live shares support `PUT /api/share/<id>` — the writer proves auth by holding the `deleteToken`. This is exactly the "editable plan" mechanism the handover asks for; the planner's shared plan should mirror it.
- `/api/share-bg` (per-BG roster paste-lists) and `/api/share-pool` (tiered defender pool) are **snapshot-only** today — no PUT endpoint exists. If we want an officer to update a plan in place (see §4 Missed angles), we need to add PUT symmetry to one of these or a new `/api/share-plan/[id]`. My recommendation: a fresh `/api/share-plan` namespace so we don't overload existing snapshot semantics.
- 8-char alphanumeric IDs, 16-char delete tokens, 6-month TTL, 20/hour + 200/day per-IP rate limit. Copy this shape verbatim for `/api/share-plan`.

**Roster loading** — the current `/war` planner already knows how to fetch and merge:

1. A shared defender pool + floor (`fetchSharedPool`),
2. Bundled BG paste-lists (`fetchSharedBg`),
3. Individual player rosters cited by those pastes (`fetchShare`).

Extract this into a small `lib/war/load-bg-rosters.ts` so both the diversity tool and the new planner call the same code. This is the biggest single reuse win — the roster ingest is the fiddly part and it already works.

**Portrait matcher** — `apps/web/lib/ocr/*` (portrait-store, portrait-seeder, phash, champion-match, name-match, ascension-detect).

- Behind `FEATURE_SCREENSHOT_IMPORT = false` but the code is live and correct. The season extractor (`scripts/extract-aw-season.ts`) can call `matchChampion(portraitCandidates, bhrCandidates, nameCandidates)` on cropped defender cells and get a `{ championId, confidence, alternates }` result plus the same low-confidence review-queue behaviour we use elsewhere.
- Champion IDs the matcher returns are the same slugs used in `data/champions/seed.json`. No mapping table needed.

**Champion metadata + ID handling** — `apps/web/lib/data-loader.ts` (`loadAllChampions`, `loadActiveChampions`, `loadChampionLookup`). Same source the diversity tool uses. Variant IDs (`spider-man-classic`, `iron-man-infamous`, `star-lord-stellar-forged`, etc.) are already in the ID space; the handover's warning about variant traps is real, but it's handled by the matcher returning explicit variant slugs.

**Engine helpers** — `packages/engine/src/war/`:

- `effectiveRank(rank, ascension)` — the ladder used by both the current diversity tool and the new planner's copy-strength calc.
- `WarPlayer`, `WarPlayerId`, `WarStateFloor`, `WarTier` types — reuse where semantics match; if the new planner uses fundamentally different concepts, keep types in a new file rather than distorting the existing ones.

**Analytics** — `apps/web/lib/analytics.ts` — thin wrapper around `window.umami?.track(event, data)`. Add `war_placed`, `war_pinned`, `war_exported` there with the same pattern as existing events.

**Route + nav patterns** — `apps/web/app/layout.tsx`. The planner slots into the existing shell; the audit's proposed nav change is in §5.

**Two-layer design tokens** — `apps/web/app/globals.css`. `--brand-*` are raw hexes, `--color-*` are semantic. Never bind a component to `--brand-*` directly. This is what makes light/dark work; the mockup's raw-hex approach will not port cleanly, hence §1's rewrite.

**FilterChipGroup component** — `apps/web/components/roster-manager.tsx` (last block of the file). Generic `<FilterChipGroup<T>>` already exists; use it for BG selector and node/placement/battlegroup tabs rather than adding a second segmented-control primitive.

**ChampionPortrait component** — `apps/web/components/champion-portrait.tsx`. Handles rarity frames, class overlay, hover-pop, alpha-aware clipping. Reuse for the panel's pick list (small `size={32}` thumbnails) and in the shared-plan Battlegroup tab; the map itself uses raw drawn shapes for its ~50 tiny slots because the frame chrome would fight the map density.

---

## 3. Diversity tool comparison

The existing `/war` route is what the handover calls the "diversity tool". It stays. Both tools must agree on who owns what.

**How the diversity tool loads a BG**

1. Officer pastes 10 roster-share URLs (one per player) into a text area, one per line.
2. Each line is a `/r/?share=<8char>` link or the naked 8-char ID.
3. `war-planner.tsx` calls `fetchShare(id)` per row, unions the results into `WarPlayer[]`.
4. A separate share (pool + floor) sets the defender universe and the minimum eligible state.
5. `assignWar({ defenderPool, floor, players })` returns `{ assignments, underfilled, unavailableChamps }`.
6. `WarPlacementTable` renders it. `WarPlacementExport` exports.

**How the new planner differs**

| Axis | Diversity tool | New planner |
|---|---|---|
| Scope | 10 players × 5 slots, alliance-wide (all 3 BGs together in current UI) | One BG at a time, 10 players × 5 slots = 50 nodes |
| Selection | Tier-based (Strong / Mid / Base pool) | Node-based (each node has an ordered list of ≤8 guide picks) |
| Constraint | Global uniqueness across all placements | Per-BG uniqueness only |
| Scoring | Rank tier + ascension + sig (owner-preference lex order) | Per-node fit score (pick-index × key-weight) + copy strength as tiebreak |
| Placement value | Champion power (rank/asc/sig) | Node fit dominates; strength is a rounding tiebreak |
| Pins | Not supported | With-player and any-owner pins |
| Guide dependency | None (officer curates pool themselves) | Guide-first: every node ships with 8 picks from GuiaMTC; officer edits from there |

**Where they must agree**

- **Champion IDs.** Both use seed-slug IDs. The season file's `guideDefenders` field must contain seed IDs. If GuiaMTC uses different naming, the extractor must resolve to seed IDs (portrait matcher handles this).
- **Player identity.** The diversity tool identifies a player by the share-blob's inline name. The new planner needs the same key so the two tools show consistent "who has what" — same import path, same normalisation.
- **Roster loader.** Extract the ingest to `lib/war/load-bg-rosters.ts` (see §2). If both tools read through it, a fix in one benefits the other.

**Where they intentionally disagree**

- **Eligibility floor.** The diversity tool has a floor selector (t3..t9). The new planner has no floor concept — a guide pick that a player owns at any state is considered ownable; a filter for "worthy defenders" is out of scope because the guide is doing that job. Open question in §6.
- **BG membership.** The diversity tool accepts up to 30 players (a whole alliance). The new planner is per-BG (10). If a share bundle carries 30 rows, the planner needs the officer to say which 10.

**Linking.** Add cross-links in the intro copy of both pages: "For alliance-wide diversity, see …" on the planner; "For node-by-node placement, see …" on the diversity tool. Small footprint, high user value.

---

## 4. Missed angles

Walking the handover's "Angles to check" list, plus a handful the mockup doesn't cover.

**Eligibility.** Handover flags this as an open question; the mockup assumes any owned 7-star. Confirm with Dave (§6.1). The diversity tool has a floor selector but restricts by effective rank, which is a different concept from "war-worthy". Reusable? Maybe. Kept as open.

**Battlegroups.** Mockup covers BG1 only (BG2/3 disabled). The plan for full scope: three independent solves, one BG at a time, no cross-BG optimisation (handover explicit). BG membership comes from the share bundle — the officer maps each of the 3 BG groups to a set of 10 shared roster IDs. `fetchSharedBg` already supports this via the `bgs?: WarPlayerInput[][]` array on `SharedBgPayload`.

**Absent players.** Not in mockup. Add a per-player toggle in the Battlegroup tab: `[×] Not placing this war`. Excluded players contribute zero slots; the BG solves 40 nodes (or fewer) instead of 50, and the unfilled list gets the extra 10. Store the exclusion in the plan payload (`excludedPlayers`, already on the handover's schema). Re-solve on toggle.

**Short rosters.** Mockup silently produces a partial placement; the handover says report the shortfall. The engine's `WarResult` already returns `underfilled` and `unavailableChamps` — reuse the same shape and surface both on the Placement tab as counts with a "why" drill-down. The solver never crashes; the flow simply can't saturate.

**Stale rosters.** Not in mockup. The `SharedRosterPayload` carries `lastSyncedAt` (ISO). Show a "last updated N days ago" chip on the Battlegroup tab per player, red if >14 days. This is the highest-leverage bug-avoidance signal — worth doing even if nothing else changes.

**Variant IDs.** Handled by reusing the portrait matcher (§2). The mockup uses `['id','name','dv']` triples; season extractor writes seed slugs directly. Low-confidence portrait matches go to `data/aw/_review-season-69.md` with crop image paths, matching the immunities pattern already established in the repo.

**Officer collaboration / shared plan editability.** Handover asks how sharing works today.

- Individual roster shares (`/api/share`) support edit via PUT with the `deleteToken` as write-auth. Two `mode`s: `snapshot` (frozen) and `live` (updatable).
- `/api/share-pool` and `/api/share-bg` are **snapshot-only** (no PUT).
- The plan is a new kind of shared thing — different shape, different lifecycle. Two options:
  - **A.** Add PUT to `/api/share-bg` and store the plan inside its existing envelope. Compact, but conflates "roster references" with "plan state".
  - **B.** New `/api/share-plan/[id]` namespace, PUT-enabled, `deleteToken` = edit token. Recommend this. Own namespace, own KV prefix (`plan:`), same TTL and rate limits, `version` field for optimistic concurrency (handover asks for this — "every write sends the version it was based on").

**Two officers editing at once.** The handover mandates version-based conflict detection. Implement as: `PUT /api/share-plan/<id>` accepts `{ deleteToken, payload, baseVersion }`; server compares `baseVersion` to the stored `version` and returns `409 Conflict` with the current payload if they differ. Client refuses to overwrite, offers to reload. Same idiom as the artifact `force` flag.

**Local copy.** Handover asks for localStorage caching. Straightforward: `war-plan:<share-id>` key with the plan blob, hydrated on load, flushed on remote update. Survives flaky connections, works before first share.

**Mobile map.** Not in mockup — desktop-first grid. Node tap targets are 46×58 px in mockup coordinates; at 400px viewport width they collapse to ~20 px. Recommendations for the audit:

- Below `1000px` the mockup already stacks map above panel — that's fine on tablet.
- Below `560px` the mockup shrinks player initials and hides them. Test on a real phone; if node cells are unreadable, add pinch-zoom via CSS `touch-action: pinch-zoom` on the SVG wrapper.
- Provide a list-view fallback: tap a player in the Placement tab to see their five defenders and node numbers as a plain list. That's already in the mockup; it's the primary export shape for a reason.

**Export on mobile / Line in-app browser.** Mockup uses `img.src = cv.toDataURL('image/png')` and a modal with "long-press to save". Handover says to try Web Share API first. Plan:

1. Try `navigator.share({ files: [new File([blob], 'defence.png', { type: 'image/png' })] })`. Works on iOS Safari 15+ and Android Chrome; falls through to a share sheet Line can consume.
2. Fall back to a hidden `<a download="…" href="blob:…">` click. Works on desktop; iOS Safari ignores `download` but opens the image in a new tab where long-press works.
3. Fall back to the mockup's modal + long-press instructions.

Test explicitly in the Line in-app browser (WebKit on iOS, Chrome/WebView on Android); those two share nothing but a name.

**Extra angles not in the handover**

- **`dv` seeding.** Open question in the handover. Existing tier data (`WarPool.strong/mid/base`) maps naturally: strong → 90, mid → 70, base → 50, with per-champion knobs where the alliance disagrees. Keep the raw number in `data/aw/defender-values.json` so it's easy to iterate. Alternative: use `calculateCeilingBHR(champ) / 500` as a proxy (higher-prestige champs are usually higher-value defenders too). Not accurate for kit-driven picks but a decent bootstrap.
- **Guide picks with unowned champions.** A guide pick like "Onslaught" where nobody in the BG owns Onslaught should either (a) be silently skipped by the solver and the next pick takes its place, or (b) be shown as "nobody owns" in the pick list. Mockup does both — the list marks it red, the solver skips it, and the explanation says "nobody in the battlegroup has them". Correct behaviour; keep it.
- **Guide + non-guide fills.** The solver falls through to `dv × 0.55` for nodes with no picks. Reasonable, but this is where the wrong pick lands most often. Consider a UI hint: "This node has no guide picks — the planner will fill it from what's left."
- **Season file staleness.** GuiaMTC updates their guide mid-season. If the alliance edits some nodes and a week later GuiaMTC re-does node 27, the planner should respect the officer edit AND pick up the guide change for un-edited nodes. `pickOverrides` (only-changed) already handles this per the plan schema.
- **`aria-label` and node-tab keyboard flow.** Mockup handles Enter/Space on `.node`. Should also handle arrow keys to move between nodes (up/down/left/right along the visible grid), since that's how people scan the map with a keyboard. Nice-to-have.
- **Reset scope.** Mockup's "Reset to guide picks" resets **all** nodes. The per-node reset button ("Reset to guide picks" inside the node panel) resets one. Both are useful; naming is confusing. Rename the header button to "Reset all to guide picks".
- **Session length before share expiry.** 6-month TTL. War seasons are ~2 weeks. Comfortable. But shares silently expire — surface the expiry date on the shared plan link so the officer knows when it dies.

---

## 5. Proposed file plan

Where each piece lands.

**Route + page**

- `apps/web/app/war-planner/page.tsx` — new Season 69 war planner route. **Do not** put it on `/war`; that URL is the diversity tool's live share link space, and moving it would break existing links posted in alliance chats. See §6.
- `apps/web/app/war-planner/[id]/page.tsx` — resolves a plan share ID. Loads the plan and its referenced roster shares client-side.

**Client components** — `apps/web/components/war-planner/*`

- `season-planner.tsx` — top-level state, orchestrator.
- `season-map.tsx` — SVG map. Ports the mockup's `pos`, `PT`, `EDGES`, `lane`, ring/badge/portrait render. Colour tokens via `--color-*`.
- `season-node-panel.tsx` — the "Node" tab. Picks list, pin form, reset, result explainer.
- `season-placement-tab.tsx` — the "Placement" tab. Stats, per-player lists, moved-nodes diff, export buttons.
- `season-battlegroup-tab.tsx` — the "Battlegroup" tab. Roster health, absent-player toggle, last-updated per player, share/reload plan.
- `season-export.ts` — canvas rendering for map + player exports. Not a React component; called from the placement tab.
- `season-export-modal.tsx` — the export-image modal. Focus-trapped, reduced-motion aware.
- `season-share-controls.tsx` — plan share/copy link, delete-token retention, version conflict handling.

**Engine** — `packages/engine/src/war/season/`

- `types.ts` — `SeasonNode`, `SeasonPlan`, `NodePlacement`, `PlaceInput`, `PlaceResult`, `Pin`. Kept separate from `war/types.ts` so the diversity tool's types don't get distorted.
- `solve.ts` — MCMF (SPFA), stability bonus, fit scoring. Pure, no DOM. Port from the mockup's `solve()` function line-by-line; the mockup version is tested to fill 50/50 on real rosters.
- `explain.ts` — for a node's chosen placement, produce the "why higher picks didn't land here" trace. Pure.
- `fit.ts` — `fit(champ, node, plan)`, `strength(playerCopy)`. Extracted so tests can pin arithmetic.
- `map.ts` — `pos(nodeNumber)`, `EDGES`, `lane(node)`, `PT`, `where(node)`, `pathOf(node)`. Also pure, referenced from `season-map.tsx` and `season-export.ts`.
- `__tests__/solve.test.ts` — all handover invariants (see §Vitest invariants in handover).
- `__tests__/fit.test.ts` — key vs non-key weighting, pick-index falloff, strength tiebreak.

**Data** — `data/aw/`

- `season-69.json` — the extractor output. Matches the Zod schema in the handover.
- `season-69.schema.ts` — the Zod schema itself, imported both by the extractor and the runtime.
- `defender-values.json` — `championId → dv` (0–100). Seeded from tier data or ceiling proxy; iterated manually.
- `_review-season-69.md` — extractor review queue, same idiom as `data/immunities/_review-*.md`.

**Extractor** — `scripts/extract-aw-season.ts`

- Fetches the GuiaMTC season page and its table images.
- Detects rows, crops the 4×2 defender block, runs each cell through `matchChampion` (from `apps/web/lib/ocr/champion-match.ts`).
- OCRs buff text with Tesseract (already a project dep for OCR pipeline).
- Handles wrapped buff lines per the handover rules (join on colon or non-bold continuation).
- Writes confident results to `season-69.json`, low-confidence to `_review-season-69.md` with crop paths. Same locks + review-queue pattern as the immunities pipeline.
- Attribution: writes GuiaMTC + source URL into the season file's `source` block. The runtime credits it on the page.

**Share API** — `functions/api/share-plan/`

- `index.ts` — POST creates a plan share. Same 8-char ID + 16-char delete token + 6-month TTL + rate-limit shape as `/api/share-bg`.
- `[id].ts` — GET reads. **PUT** updates with `{ deleteToken, payload, baseVersion }` and returns 409 with current payload on version mismatch. DELETE removes.
- KV key prefix `plan:`.

**Client helpers** — `apps/web/lib/war-plan-client.ts`

- Wrappers around the share-plan API mirroring `share-client.ts` shape (`createSharedPlan`, `fetchSharedPlan`, `updateSharedPlan` with conflict handling, `deleteSharedPlan`).
- `apps/web/lib/war-plan-storage.ts` — localStorage cache (`war-plan:<id>` → serialised plan) with the same idiom as `war-storage.ts` for the diversity tool.

**Extracted roster loader** — `apps/web/lib/war/load-bg-rosters.ts`

- Pulls the existing per-player + per-BG fetch orchestration out of `war-planner.tsx` into a shared module.
- Both the diversity tool and the new planner import it. Reduces the surface area where a fix could benefit only one tool.

**Nav** — `apps/web/app/layout.tsx`

- Insert `War planner` between the existing `War` and `Immunities` links, with an "Alpha" chip (same treatment as the wordmark `beta` chip). Rename current `War` to `War diversity` to make the split obvious. See §6 for the naming decision.

**Analytics** — `apps/web/lib/analytics.ts`

- Add `war_placed`, `war_pinned`, `war_exported` next to the existing events. No new plumbing.

**Copy / cross-links**

- Diversity tool intro: "For per-node planning with the season guide, see War planner."
- Planner intro: "For alliance-wide diversity across all three BGs, see War diversity."

---

## 6. Open questions for Dave

Ranked in blocking order — the top three need answering before I start.

1. **Route + naming.** `/war` is the diversity tool today, and its shared plan links point there. The mockup nav shows one item "War defence". I need a clean split:
   - **Recommended:** move diversity tool's page nav label from "War" to "War diversity" (keep the route `/war/` — existing links unaffected). New planner mounts at `/war-planner/` with nav label "War planner" + Alpha chip.
   - **Alternate:** move diversity tool to `/war-diversity/` and give the new planner `/war/`. Cleaner URL, breaks every existing share link.
2. **Eligibility rules.** Handover flags. For war tier X, which rarities/ranks can be placed? Mockup assumes any owned 7-star. Confirm: is that right, or does the tier we play at cap the pool?
3. **`dv` seeding.** Handover flags. Two options above (tier map or ceiling proxy). Prefer tier map because it's cheap to iterate and you already have opinions on it; the ceiling proxy is a fallback.
4. **Shared plan concurrency UX.** On a 409 the client reloads the newer version and asks the officer to redo their edit. Would you rather it auto-merged (only-changed-nodes wins locally, rest reload)? Auto-merge is more forgiving but risks silently losing intent.
5. **BG membership.** For an alliance with 30 shares in one bundle, does the officer pick which 10 belong to BG1/2/3, or is there already a convention (e.g. share order)? Diversity tool doesn't enforce grouping.
6. **`FEATURE_SCREENSHOT_IMPORT`.** The extractor uses OCR machinery that's currently gated off. The extractor is a build-time script so it can bypass the flag safely, but confirm you're comfortable running it with real OCR before I write the pipeline.

---

**Ready to build once these are answered.** No feature code has been written; nothing is staged; nothing is shipped. This audit itself is in `docs/war-planner-audit.md`.
