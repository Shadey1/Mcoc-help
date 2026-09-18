# AW season extractor — completion notes

`scripts/extract-aw-season.ts` is a scaffold. The fetch, output, review-queue and attribution stages are wired. The per-source parser is not — it needs a live guide page to inspect against.

This doc is the checklist for finishing it against a chosen guide (GuiaMTC or similar). Run through it in order.

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
