/**
 * Shared types for the screenshot-OCR pipeline.
 *
 * v0.14.0 rewrite: state text is no longer OCR'd. The in-game prestige page
 * and My Champions page only display BHR under each portrait — there is no
 * "R5 sig 200 A2" text to read. Instead we:
 *
 *   1. OCR the whole image to find BHR anchors (NN,NNN patterns)
 *   2. Use anchor positions + variance row detection to synthesise a grid
 *   3. Per card: hash portrait, focused-OCR the BHR cell, detect ascension
 *      pips visually
 *   4. Reverse-derive (rank, sig) from (BHR, champion, ascension) via engine
 *      math — the unique combo whose predicted BHR matches the OCR'd BHR
 *      within tolerance
 *
 * The pipeline runs entirely in the browser via canvas + Tesseract.js,
 * with no server round-trips.
 */

/** Pixel-coordinate rectangle within a screenshot. */
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Detected card region within a screenshot, before any content extraction. */
export type DetectedCard = {
  rect: Rect;
  /** Index within the source screenshot, row-major top-left to bottom-right. */
  cardIndex: number;
  /** Source screenshot 0-indexed (for multi-screenshot imports). */
  sourceIndex: number;
};

/**
 * A BHR number located via whole-image OCR. Used to anchor the column grid:
 * a single row with 2+ anchors lets us derive the column pitch and extrapolate
 * across the whole row band.
 */
export type BHRAnchor = {
  /** Parsed integer value (commas stripped). E.g. "46,120" → 46120. */
  value: number;
  /** Original OCR text including comma. */
  text: string;
  /** Bounding box in source-image coordinates. */
  rect: Rect;
};

/**
 * State derived by reverse-engineering the engine BHR formula given a
 * champion identity, an OCR'd BHR reading, and a visually-detected ascension
 * level. We enumerate (rank, sig) pairs and pick the closest match.
 */
export type DerivedState = {
  rank: 3 | 4 | 5;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
  /** BHR read from the card (focused per-card OCR). */
  ocredBHR: number;
  /** Engine-predicted BHR for the derived state. */
  predictedBHR: number;
  /** abs(ocredBHR - predictedBHR). Lower = more confident derivation. */
  absError: number;
  /** Other plausible (rank, sig) candidates within tolerance, for user override. */
  alternatives: Array<{
    rank: 3 | 4 | 5;
    sig: number;
    predictedBHR: number;
    absError: number;
  }>;
};

/** A card after all extraction stages, ready for matching. */
export type ProcessedTile = {
  detected: DetectedCard;
  /** Top portion of the card — the portrait. Used for perceptual hashing. */
  portraitHash: string;
  /** BHR + reverse-derived state. Null if OCR or derivation failed. */
  derivedState: DerivedState | null;
  /** OCR'd champion name from below the portrait. May be noisy. */
  nameText: string | null;
};

/** Identification result — best champion match with supporting evidence. */
export type MatchResult = {
  championId: string;
  championName: string;
  /** 0-1 — combined confidence across portrait hash + name OCR. */
  confidence: number;
  /** Whether portrait hash and name OCR agreed on the same champion. */
  agreement: 'strong' | 'partial' | 'weak';
  /** Other plausible matches, for user override in the confirmation grid. */
  alternatives: Array<{ championId: string; championName: string; score: number }>;
};

/** A fully-processed card ready for the confirmation grid. */
export type IdentifiedCard = {
  tile: ProcessedTile;
  match: MatchResult;
  /** User can override the auto-pick in the confirmation grid. */
  userOverrideId: string | null;
};

/**
 * Pre-computed portrait hashes shipped with the bundle.
 * Generated at build time by `scripts/hash-portraits.ts`.
 */
export type PortraitHashTable = {
  /** ISO timestamp of when this was generated. */
  generatedAt: string;
  /** Hash algorithm identifier — used to validate compatibility. */
  algorithm: 'ahash-64' | 'phash-64';
  /** championId → 64-bit hash as 16-char hex string. */
  hashes: Record<string, string>;
};
