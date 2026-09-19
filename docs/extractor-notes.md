# AW season extractor — how to run it

One command per season. Everything is read from the guide's images.

```
pnpm extract-aw-season 70 --fetch           # download the guide, dry run
pnpm extract-aw-season 70 --fetch --apply   # download and write the season file
pnpm extract-aw-season 70 --check           # has the guide changed since we captured it?
```

## 1. Getting the guide images

`--fetch` downloads every image on `https://www.guiamtc.com/aw-season-<N>` into `dump/aw-season-<N>/` (gitignored). Takes 1-3 minutes; Google's image host is slow. Without `--fetch` the last download is reused, so iterating on the script is fast.

The guide is a Google Sites page. Its image URLs are signed, expire about a minute after the page loads and need that page request's cookies, so the script pulls them in parallel and re-requests the page for anything refused. A failed download leaves the previous one untouched.

Fallback if that ever breaks: save the page from a browser (`File → Save Page As… → Complete Webpage`) into `dump/`. A `dump/MTC Guide - AW - Season <N>_files/` folder is picked up when there is no `dump/aw-season-<N>/`.

## 2. Refresh the reference portraits (only when new champions were added)

```
pnpm fetch-portraits
```

Downloads two reference images per 7-star champion into `data/champions/portraits-cache/` (gitignored): MCOCHUB's (`<id>.png`) and the Fandom one already in the seed (`<id>~fandom.*`). Both are plain HTTP, so this runs in CI; Fandom's image CDN only needs a `Referer` header, not a browser. Idempotent; pass `-- --force` to refetch.

Two sources because either site occasionally serves a non-standard crop. MCOCHUB's Punisher is one: with MCOCHUB alone, all 7 Punisher cells in Season 69 were left unmatched. The matcher scores both and keeps the better.

## 3. What it writes

Produces:
- `data/aw/season-<N>.json` — 50 nodes, each with OCR'd buffs and up to 8 defender ids
- `data/aw/_review-season-<N>.md` — only what it wasn't sure of. Season 69 came out empty.
- `data/aw/_cells-s<N>/` — crops of flagged cells only (gitignored)

The dry run writes nothing. `--strict` makes `--apply` refuse (exit 3) if any cell needed review; the unattended refresh uses it so a partial match never ships on its own. `--apply` refuses to write if any node is missing, duplicated or unreadable, so a bad run can't replace a good season file. Both modes print which nodes differ from the current file first: a re-run replaces hand edits to `buffs` and `guideDefenders`, so check that list before applying over a file you've corrected.

## How it works

- **Spotting guide edits.** Google serves byte-identical files until the guide is edited, so the season file stores a hash of the pick-table images (`source.fingerprint`). `--check` downloads the guide, compares, and exits 0 (same) or 2 (changed) without needing portraits or OCR. `capturedAt` only moves when the fingerprint does.
- **Finding tables.** Every image in the dump is checked for the blue / dark-red / dark-green "Node / Defenders / Attackers" header. No filenames or page order are assumed, so a reshuffled page doesn't matter.
- **Rows.** Detected from the dark separator bars, never counted. Season 69: 4 rows on paths, 3 on SUBS, 5 on Boss Island.
- **Node numbers.** OCR'd from the left cell of each row. The guide's "SUBS Section 1/2/3" labels are ignored. Cross-checks: every node 1–50 must appear exactly once, and numbers within one table must step evenly (9 on a path, 1 elsewhere). Failures are listed as structural problems.
- **Buffs.** OCR'd. A line is joined onto the previous buff when that buff ends in a colon, has an unclosed bracket, or the line starts with a bracket. Trailing junk from the guide's emoji icons is stripped. The guide's known misspellings ("Agression", "Dauting", "Controlos", "Desintegration", "Adaptative") are corrected via the `GUIDE_TYPOS` table in the script; add new ones there, not by hand in the season file, or the next run reverts them.
- **Defenders.** The guide pastes the stock portrait onto a flat coloured cell at near-native size, so each cell is template-matched against the reference PNGs, scoring only where the reference is opaque (`scripts/lib/portrait-match.ts`). Correct matches score 0.82–0.99 with the runner-up around 0.45–0.65. Perceptual hashes were tried first and can't survive the background and framing difference — distances came out near random.
- **Top picks.** The guide puts its best-tier picks on yellow cells (boxed as one leading run) and alternates on pink. `topPicks` is how many leading picks are yellow, read by counting yellow against pink in a band round each cell's edge. An unreadable cell inside the run counts as part of it; one straight after the run (a full-bleed portrait such as Arnim Zola) counts as an alternate. A yellow cell after a pink one is flagged. The solver adds `TOP_PICK_BONUS` to a top-tier pick on nodes the officer hasn't edited.
- **Flags.** A cell is flagged when its lead over the runner-up is under 0.15, and left out of the picks entirely when the best score is under 0.75 (almost always a champion with no reference portrait — run step 2).

---

## Historical notes

An earlier version of this doc walked through the completion checklist for the scaffold — that scaffold is now filled in. Keeping the section headers here so a search for "row detection" or "buff OCR" lands somewhere useful.

## 1. Confirm the source URL

The extractor takes `<guide-url>` as an argv. The current stub season file cites `mcoc.help/war-planner` as a placeholder — that gets replaced with whatever URL you pass to the extractor.

Ask the alliance where they read season picks from. Most alliances I've seen use one of:

- GuiaMTC's Portuguese-language wiki
- reddit.com/r/ContestOfChampions season threads
- an alliance-internal Google Sheet

The last one bypasses the extractor entirely — you'd hand-populate `data/aw/season-<N>.json` from a URL you can copy-paste.

## 2. Inspect one table image

Load the guide page in Chrome DevTools. Find how each table is served:

- `<img src="…">` — the common case; likely a static image host (Cloudinary, wp-content, imgur).
- Inline `<svg>` — some guides embed everything vector; if so, no OCR needed, parse the SVG directly.
- Canvas — least likely; treat as raster.

Copy one full-size image URL. Save it locally. This is your fixture for building the parser against.

## 3. Row detection

Every table shares the same layout: title bar, header row (Node / Defenders / Attackers), then N rows.

- Path images (nodes 1–9, 10–18, etc.): **4 rows**
- SUBS images (nodes 37–45): **3 rows**
- Boss Island image (nodes 46–50): **5 rows**

Detect the rows by pixel-scanning for the alternating background bands. Never hardcode a row count — the season could break that assumption, and a wrong count silently corrupts the season file.

## 4. Column layout

Each row is three columns: Node | Defenders | Attackers.

- Left cell: node number as centered white text on the coloured lane strip. OCR the digits.
- Middle cell: 4×2 grid of defender portraits (8 champions per node).
- Right cell: attacker suggestions — ignore.

Cell coordinates within a row are consistent across all tables of a given guide. Extract them once from the fixture image (right-click, "Copy coordinates" or measure from a screenshot ruler).

## 5. Defender cell matching

For each of the 8 defender cells:

1. Crop the cell to a square (Sharp or Jimp in Node).
2. Compute a phash the same way `apps/web/lib/ocr/phash.ts` does.
3. Compare against every 7-star champion portrait we have hashed. The MCOCHUB portrait URLs in `data/champions/seed.json` are the reference set.
4. Return `{ championId, distance, alternates: 3 next-best }`. Confidence goes to 1 if distance ≤ 8, else falls off.

The browser-side matcher in `apps/web/lib/ocr/champion-match.ts` uses a portrait-store cached in localStorage. For Node you need to build the equivalent cache once (fetch all Fandom portraits with a browser UA, hash each, save to `data/aw/portrait-hashes.json`). Do that from this script the first time it's run against a new champion list.

**Variant traps:** Spider-Man has 7 variants; Iron Man has 3; Storm has multiple. Cell backgrounds (yellow / pink) don't disambiguate. Low-confidence matches (distance > 10 or the second-best is within 3 of the top) go to `reviewFlags: ['Defender cell N: low confidence, top=X (d=Y), next=Z (d=Y+2)']`.

## 6. Buff OCR

Middle-of-title-bar text in a bold font (usually Roboto or system sans). Contrast is high enough for Tesseract.

Wrapped-line handling:

- **Colon rule**: a line ending in `:` continues on the next line. Join them.
- **Non-bold continuation**: a non-bold line right after a bold line is a parenthetical continuation. Join.
- If neither rule applies but line spacing is tighter than usual, flag it in `reviewFlags`.

Node buff examples the guide handles as one entry:

- `Stunning Reflection:` + `Bleed & Shock` → `Stunning Reflection: Bleed & Shock`
- `Healthy Disposition` + `(non-bold parenthetical over two lines)` → single joined string

## 7. Section 3 numbering

The SUBS images list nodes 37–45. The image section numbers don't match the map's — the guide often labels them `SUBS A / B / C`. Read the node number from the image directly, don't infer from image order. This is one of the traps the handover called out.

## 8. Attribution

The scaffold already writes `source: { name, url, capturedAt }` from the args. The runtime UI reads that and credits the guide on the war-planner page.

## 9. Running it

Once the parser is done:

```
tsx scripts/extract-aw-season.ts 70 https://guiamtc.example/season-70
```

That's a dry run — prints what would be written. Add `--apply` to write `data/aw/season-70.json` and `data/aw/_review-season-70.md`.

Review the review queue by hand, edit the season file to resolve any low-confidence picks, and commit.
