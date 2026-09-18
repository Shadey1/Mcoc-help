# AW season extractor — how to run it

Full pipeline is wired against GuiaMTC's page layout. Three scripts, run in order:

## 1. Save the guide page

In Chrome / Edge / Firefox, open `https://www.guiamtc.com/aw-season-<N>` and use `File → Save Page As… → Complete Webpage`. Drop the resulting `.html` and `_files` folder into `dump/` at the repo root. The `_files` folder should contain 45 `unnamed*.png` images.

The `dump/` folder is gitignored — nothing committed from the guide itself.

## 2. Build the champion portrait hash cache (once)

```
pnpm build-portrait-hashes
```

Fetches every champion's `portraitUrl` from Fandom, computes an 8×8 aHash, saves to `data/champions/portrait-hashes.json`. Idempotent (skips existing entries); rerun after adding new champions. Rate-limited to 500 ms between fetches — the full 330-champion build takes ~3 minutes on a warm connection.

**Fandom rate-limit note.** After heavy scraping activity Fandom's WAF can flag your IP for 403 responses. If you see all-403s, wait a few hours and retry. Pass `--force` to rebuild from scratch.

## 3. Run the extractor

```
pnpm extract-aw-season 69           # dry run — prints what it would extract
pnpm extract-aw-season 69 --apply   # write the season file
```

Produces:
- `data/aw/season-<N>.json` — 50 nodes × up to 8 defender ids
- `data/aw/_review-season-<N>.md` — cells the phash matcher wasn't sure about, with top-3 candidates and paths to the cropped cell image for eyeball verification
- `data/aw/_cells-s<N>/` — cropped low-confidence cells (both these last two are gitignored — regenerable)

## Section → image mapping

The extractor knows GuiaMTC's DOM order:

- Path 1..9 → `unnamed(3|6|9|11|15|18|21|24|28).png`
- SUBS Section 1/2/3 → `unnamed(33|36|40).png`
- Boss Island → `unnamed(44).png`

If GuiaMTC reshuffles the page for a future season, update `PATH_IMAGES` / `SUBS_IMAGES` / `BOSS_IMAGE` at the top of `scripts/extract-aw-season.ts`.

The SUBS-image → node-numbers mapping (`SUBS_NODES`) is the handover-flagged trap: the guide's "Section 1/2/3" labels don't match the map's node numbering. The current mapping (`s1 → 40-42, s2 → 43-45, s3 → 37-39`) was determined by hand after the first run — verify against the actual guide when a new season lands.

## Buff text

Not OCR'd. The guide's Portuguese-plus-English buff labels are noisy and the field is display-only in the season schema. Any `buffs` already in the season file are preserved on re-run; officers can hand-fix from the guide's per-node bar.

## Fallback: hand-populate

If Fandom is 403-blocking and you need picks now, `scripts/crop-aw-cells.ts` produces per-node "sheets" (8 defender portraits side-by-side, upscaled to ~200 px each) under `data/aw/_review-s<N>/node-<n>.png`. Officer eyeballs each sheet, hand-fills the JSON. Slower but requires no Fandom access.

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
