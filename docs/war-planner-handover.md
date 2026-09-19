# Claude Code handover: Season 69 war planner (alpha)

Reference mockup: `war-defence-planner.html` (published artifact). It is the design and behaviour spec. The solver in it is real and tested; port it, don't reinvent it.

## Step 0. Audit before building

Before writing any feature code, read the current codebase and produce `docs/war-planner-audit.md` covering:

1. **Design system fit.** Where the mockup diverges from current tokens, components, dark mode toggle, light theme, typography and spacing. The live site wins; list what the mockup needs to adopt.
2. **Reuse map.** Existing modules this should use rather than duplicate: roster sharing (KV), portrait library and matcher, champion IDs and variant handling, the existing diversity tool's roster loading, Umami event helpers, route and nav patterns.
3. **Diversity tool comparison.** How it builds its unique list, and whether its roster loading or eligibility rules differ from what this planner assumes. The two must agree on who owns what.
4. **Missed angles.** Anything in the codebase or in the list below that the mockup doesn't handle. Flag, don't fix silently.
5. **Proposed file plan.** Where each piece below lands.

Stop after the audit and wait for Dave to review it.

### Angles to check in the audit

- **Eligibility.** Which rarities and ranks can be placed, and whether the war tier restricts it. The mockup assumes any owned 7-star.
- **Battlegroups.** BG membership comes from where? Each BG solves independently; duplicates are only banned within a BG.
- **Absent players.** A toggle to exclude a player who isn't placing this war. Their slots vanish and the solve re-runs.
- **Short rosters.** A player with fewer than 5 eligible defenders, or fewer than 5 not claimed elsewhere. The solver must report the shortfall, not crash.
- **Stale rosters.** Show each player's roster last-updated date. A wrong roster is the most likely source of a bad placement.
- **Variant IDs.** Guide portraits must resolve to the site's champion IDs. The known variant traps apply (see learnings); low-confidence matches go to review, never auto-lock.
- **Officer collaboration.** Handled by the shared plan below. The audit must confirm how roster sharing works today: whether shares are immutable snapshots or updatable, and how the key is generated.
- **Mobile map.** Node tap targets are small on a phone. Check whether pinch-zoom or a list fallback is needed.
- **Export on mobile.** Saving an image from the browser differs on iOS and Android. Check the Line in-app browser specifically.

## Scope

- New route, suggested `/war`, labelled **Season 69 war planner** with an Alpha tag. The season name comes from the season data file, not the code.
- The existing diversity tool stays exactly as it is. Link between the two.
- Out of scope: attacker recommendations, cross-BG optimisation, node buff mechanics in scoring, defender tier values beyond a flat per-champion number.

## Season data

One file per season, e.g. `data/aw/season-69.json`, validated with Zod:

```ts
Season = {
  season: number,                  // 69
  source: { name: "GuiaMTC", url: string, capturedAt: string },
  nodes: Array<{
    node: number,                  // 1..50
    buffs: string[],               // display only, one entry per buff
    guideDefenders: ChampionId[],  // up to 8, in the order the guide lists them
    reviewFlags?: string[]         // anything the extractor wasn't sure of
  }>,
  defaultKeyNodes: number[]        // e.g. [48, 49, 50]
}
```

Map geometry, node positions and edges are fixed across seasons and live in code, not the season file. Take them from the mockup (`pos`, `PT`, `EDGES`, `lane`). Path N holds nodes N, N+9, N+18 and N+27.

### Extraction script

`scripts/extract-aw-season.ts`, run by hand once per season.

1. **Fetch.** Pull the season page and collect its table images. Every table shares one layout: a black title bar, then the header row "Node / Defenders / Attackers", then one row per node.
   - Row count varies: path images have 4 rows, the SUBS images have 3, Boss Island has 5.
   - Detect the rows. Never hardcode a count.
2. **Map the columns.** In each row, the node number is in the left cell and the buff text is in the next cell. Defenders are a 4×2 block in the middle column. Ignore the Attackers column entirely.
3. **Read the node number** from the image, not from the page order.
   - The SUBS sections are nodes 37 to 45, but the images' section numbering doesn't match the map's.
4. **Match defenders.** Crop the 8 defender cells by geometry, then run them through the existing portrait matcher.
   - Cell background colour (yellow or pink) carries no meaning for us. Ignore it.
   - Keep the reading order: top row left to right, then bottom row.
5. **OCR the buff text.** The font is clean enough for Tesseract. Watch for:
   - **Wrapped lines.** One buff can wrap across two or three lines. Examples: "Stunning Reflection:" then "Bleed & Shock"; and "Healthy Disposition" followed by a non-bold parenthetical over two lines.
   - **Joining rule.** Join a continuation line onto the previous buff when that buff ends in a colon or the line is not bold. If unsure, flag it.
6. **Write the output.** Confident results go to `season-69.json`. Anything below the confidence threshold goes to `data/aw/_review-season-69.md` with the crop image path. Use the same locks-plus-review-queue pattern as the immunities pipeline.
7. **Attribution.** Credit GuiaMTC on the page, linking the season page.

## Engine

Put the engine in `packages/engine/src/war/`. It must be a pure module with no DOM access.

### Solver

Min-cost max-flow using successive shortest paths with SPFA. It's 15ms in the browser for a full BG.

- **Graph:** source → player (capacity 5 minus that player's fixed pins) → champion-in → champion-out (capacity 1, which is the duplicate ban) → node (capacity 1) → sink.
- **Costs:** the edge player → champion costs `-strength(player copy)`. The edge champion → node costs `-fit(champion, node)`. These are separable, so the result is exact.

**Fit scoring.** Weight w is 3 for a key node and 1.5 for any other node.

| Case | Score |
|---|---|
| Champion is on the node's picks at index i | w × (100 − 9i) |
| Node has picks, champion isn't on them, strict mode on | edge not allowed |
| Node has picks, champion isn't on them, strict mode off | w × dv × 0.3 |
| Node has no picks | dv × 0.55 |

`dv` is a flat per-champion defender value. Seed it from the existing tier data if there is any; otherwise it's an open question.

**Strength.** A small tiebreak from the copy's rating, 0 to 10, so the best copy wins between owners. If the site has proper rank, sig and ascension data, use it here.

**Pins.**

- **Pin with a player:** removed from the flow and pre-assigned; that player's capacity drops by one.
- **Pin to any owner:** that champion may only go to that node, and that node only accepts that champion.
- Pinning a champion again moves the existing pin. A champion is never pinned twice.
- **Blocks:** refuse the pin, with a plain message, when nobody owns the champion or when the player already has 5 pins.

**Stability.** On a re-run, keeping a previous placement earns +12 on the node edge and +4 on the player edge, in fit units. This halves churn from a single change and is intentional.

**Output.** Per node: champion, player, pick rank (0 to 7; −1 means off the list; −2 means a node with no picks) and whether it's pinned. Also return a list of unfilled nodes, each with a reason.

**Explanations.** For a node that didn't get its first pick, say what happened to each higher pick: placed on node X by Y; nobody owns it; or its owners' slots were worth more elsewhere.

### Vitest invariants

Write these as tests, with a fixture BG built from real rosters:

- No champion appears twice.
- Nobody places more than 5.
- Every placement is owned by the player placing it.
- Every pin is honoured.
- Strict mode never places an unlisted champion.
- The output is deterministic for the same input.
- An impossible pin is reported, not thrown.
- A re-run with no changes produces zero moved nodes.

## UI

Match the mockup's behaviour, but use the live design system (see the audit).

### Map

- Nodes use their lane colours.
- **Before placing:** each node shows its pick count, plus a key marker where set.
- **After placing:** each node shows the champion and player name, and a ring for the outcome: solid for first choice, faint for a lower pick, dashed for the planner's choice, red dashed for unfilled.
- Pinned nodes show a padlock.
- After any change, highlight the nodes that moved. Respect reduced motion.
- **Label overflow:** section 3 nodes are only 70 units apart. Use short names there, at a smaller size.

### Node panel

- Node buffs shown as chips.
- A key node toggle.
- Pin a defender: a champion typeahead plus "Any owner" or a specific owner.
- The ranked picks list with a per-row pin, reorder and remove. Add-defender typeahead, capped at 8.
- "Reset to guide picks" appears once a node has been edited.
- After placing: the result, the explanation, and "Pin this placement".
- Any edit made after placing re-runs the solve immediately.

### Placement tab

- Counts for first choice, lower pick, planner and unfilled.
- A list per player.
- A "Moved by your last change" diff.
- The "Copy for chat" and "Export image" buttons.

### Exports

This was requested specifically. There are two PNG exports, both on the Placement tab. The mockup's `exportMap` and `exportPlayers` functions are the reference.

**1. Map export.** It must look like the war map players already know: same geometry, lines, gold join dots, dashed hub lines, dotted section 3 crossings, the A/B/C labels, and lane colours. Use the source map's navy background rather than the site palette, because recognition matters more than brand here.

- **Content:** each node shows the champion portrait, the node number, and the name of the player placing it. No champion name, because the portrait identifies the champion.
- **Portrait framing:** the portrait border is in the lane colour, and the node number badge sits top-left.
- **Label placement:** labels go below the portrait. The exceptions are 46 and 48, whose labels go to the left, and 47, 49 and 50, whose labels go to the right, because the boss nodes are stacked too tightly for labels below.
- **Section 3:** nodes are 70 units apart, so use a smaller font there and truncate long player names.
- **Canvas:** 1.5× map scale, about 1440×1890. The title goes in the empty top-left corner, the wordmark top-right, and the GuiaMTC credit bottom-right.

**2. Player export.** One strip per player, with alternating row shading.

- **Left:** the player's name and their "n of 5".
- **Right:** their five defenders in node order. Each shows the portrait with its node badge, then the champion name.
- **Canvas:** 1080 wide.
- This is the one people will use to actually place.

**Both exports:**

- **Portraits:** draw them with `drawImage`. They must be same-origin or served with CORS headers, or the canvas taints and `toDataURL` fails. Preload them and wait for `document.fonts` before drawing.
- **Pins:** a gold dot marks pinned placements.
- **Delivery:** try the Web Share API with a File first, since that's best on mobile and in Line. Fall back to a download link, then to the long-press save modal.

### Shared plan (KV)

The plan is stored in Cloudflare KV the same way roster sharing works now. Reuse that code path; don't build a second mechanism.

```ts
WarPlan = {
  season: number,
  bg: 1 | 2 | 3,
  pickOverrides: Record<number, ChampionId[]>,   // only nodes edited away from the guide
  keyNodes: number[],
  pins: Record<number, { champion: ChampionId, player: string | null }>,
  excludedPlayers: string[],
  strict: boolean,
  lastPlacement?: Record<number, { champion: ChampionId, player: string }>,
  updatedAt: string,
  version: number
}
```

- **Overrides only.** Store changes from the guide, not all 50 lists, so a guide correction mid-season flows through to untouched nodes.
- **Snapshot the placement.** Store the last placement. Rosters change between runs, so everyone should see the same placement and exports until an officer re-places.
- **Share link.** It opens the plan in the planner. The page loads the plan, the season file and the BG's shared rosters.
- **Editing.** If today's roster shares are immutable snapshots, a plan needs to be updatable. Mirror whatever edit mechanism exists. If none exists, propose one in the audit (for example, an edit token held by the creator and passed to officers in the link), and don't build it until Dave agrees.
- **Two officers editing at once.** Every write sends the version it was based on. On a mismatch, refuse the write and offer to reload, rather than letting the last save silently win.
- **Local copy.** Keep the plan in localStorage too, so the page works before the first share and survives a flaky connection.

### Analytics

Add Umami events `war_placed`, `war_pinned` and `war_exported`.

## Open questions for Dave (not blockers for the audit)

1. **Eligibility rules** for the current war tier.
2. **Defender value (`dv`).** Is there existing tier data to seed it, or is it hand-set?

## Acceptance

- The Season 69 file is extracted, with the review queue cleared by Dave.
- XMN-Namor's BG places 50 of 50 with zero duplicates on real rosters.
- Pins behave as specified.
- The plan saves to KV, reopens from its link on another device, and a stale write is refused.
- Both exports save on iOS, Android and the Line in-app browser, with real portraits.
- The diversity tool is untouched and links to the planner.
- All Vitest invariants pass.
