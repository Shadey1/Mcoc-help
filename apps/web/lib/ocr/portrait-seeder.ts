/**
 * My Champions roster importer — BHR-FIRST identification.
 *
 * The My Champions page lists every owned champion sorted by BHR, each card
 * showing the champion's portrait, ALL-CAPS name, an optional A1/A2 ascension
 * badge, and the champion's BHR number. We import the whole roster from a
 * stack of (possibly overlapping) screenshots.
 *
 * Why BHR-first: an earlier version paired each OCR'd name with the nearest
 * BHR number below it spatially. That pairing is DEVICE-DEPENDENT — different
 * phone aspect ratios offset the BHR from the name by different amounts, so
 * the pairing breaks differently per device and a low-rank champion (e.g.
 * Sersi R3) could grab a top champion's BHR. The fix: identify champions from
 * the BHR value itself via engine math (`findChampionsByBHR`), then use the
 * spatially-nearest OCR'd name only as a tiebreaker/corroboration. The math
 * can never assign a champion a BHR they can't physically produce, so the
 * device-offset class of bug is structurally impossible.
 *
 * Flow:
 *   1. Per screenshot: OCR → BHR anchors (value+position) + name anchors
 *      (champion identity+position). Attach the nearest name above each BHR
 *      anchor as a soft hint, plus any ascension badge nearby.
 *   2. Dedupe BHR observations across overlapping screenshots.
 *   3. Global one-to-one assignment: each BHR anchor → candidate champions
 *      (engine math), scored by BHR error minus a corroboration bonus when
 *      the spatially-nearby name matches. Greedy assign, each champion once.
 *   4. Derive (rank, sig, ascension) state and crop the portrait.
 */

import type { Champion } from '@prestige-tools/engine';
import type {
  BHRAnchor,
  DerivedState,
  IdentifiedCard,
  MatchResult,
  Rect,
} from './types';
import { findBHRAnchorsAndWords } from './bhr-anchor';
import { findNameAnchors, type NameAnchor } from './name-anchor';
import { assignChampionsByBHR, IDENTIFY_TOLERANCE } from './bhr-assign';
import { findChampionsByBHR } from './bhr-identify';
import { hashImageRegion } from './phash';
import { deriveStateFromBHR, confidenceFromAbsError } from './bhr-reverse';
import { generateThumbnail } from './portrait-store';
import { ocrAscensionBadge, ocrBhrStrip, terminateOcrWorker } from './tesseract';

export type SeedProgress =
  | { kind: 'scanning'; screenshot: number; total: number }
  | { kind: 'names-found'; screenshot: number; count: number }
  | { kind: 'seeding'; champion: string; current: number; total: number }
  | { kind: 'done'; seeded: number; total: number };

export type SeedResult = {
  /** Every detected card, ready for the confirmation grid. Includes cards we
   *  couldn't confidently identify (agreement 'weak') so the user can recover
   *  them by sight rather than losing them. */
  cards: IdentifiedCard[];
};

/** Two BHR reads within this many points (same champion across overlapping
 *  screenshots) collapse to one observation. Tight, because the My Champions
 *  page is BHR-sorted — adjacent distinct champions can be close, so we only
 *  merge near-identical reads (and require compatible name hints). */
const DEDUP_BHR = 15;

/** Tolerance for the final (rank, sig) state derivation once the champion is
 *  identified. Generous: identity is already locked, we just want the closest
 *  reachable state (with a round-sig preference). */
const SEEDER_TOLERANCE = 500;

/** Fraction of image height treated as the profile/top bar and ignored. The
 *  champion grid starts well below it (~25-30%); the header holds units, the
 *  collection score, and a ~52k stat that otherwise read as phantom BHRs. */
const TOP_BAR_FRACTION = 0.1;

/** No champion's BHR can exceed this. The observed roster max is ~46,120
 *  (Lizard, R5 A2 sig200); the margin covers any single champion above that.
 *  Anything higher is OCR junk — the profile header's ~52k stat, or a leading
 *  digit misread (Korg 35,470 → 55,470). Revisit if champion power creeps up. */
const BHR_CEILING = 48000;

type BhrObservation = {
  value: number;
  rect: Rect;
  canvas: OffscreenCanvas;
  /** championId of the OCR'd name spatially above this BHR, if any. */
  nameHintId: string | null;
  /** rect of that name (source coords) — used to locate the portrait above it. */
  nameRect: Rect | null;
  ascHint: 'A0' | 'A1' | 'A2' | null;
  /** Source screenshots this observation represents. Two cards in the SAME
   *  screenshot are always distinct champions, so dedupe must never merge
   *  observations whose screenshot sets overlap. */
  screenshots: Set<number>;
};

export async function seedPortraitStore(
  files: File[] | Blob[],
  champions: Champion[],
  onProgress?: (update: SeedProgress) => void,
): Promise<SeedResult> {
  const champLookup = new Map(champions.map((c) => [c.id, c]));

  // ── Phase 1: collect BHR observations with name + ascension hints ────────
  const observations: BhrObservation[] = [];

  for (let i = 0; i < files.length; i++) {
    onProgress?.({ kind: 'scanning', screenshot: i, total: files.length });

    const bitmap = await createImageBitmap(files[i]!);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      continue;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const { words, scale, rawText, anchors: bhrAnchors } =
      await findBHRAnchorsAndWords(canvas);
    console.log(
      `[seeder] screenshot ${i}: ${words.length} words, ${bhrAnchors.length} BHR anchors`,
    );

    const nameAnchors = findNameAnchors(words, scale, champions, rawText);
    onProgress?.({ kind: 'names-found', screenshot: i, count: nameAnchors.length });

    // Only positioned names can anchor a BHR crop (raw-text matches have no rect).
    const positionedNames = nameAnchors.filter((n) => n.rect.width > 0);

    // Ignore the profile/top bar — champion cards start well below it, but the
    // header's units / collection score / ~52k stat otherwise read as phantom
    // BHRs and surface as junk cards in the grid.
    const headerCutoff = canvas.height * TOP_BAR_FRACTION;
    const gridAnchors = bhrAnchors.filter(
      (a) => a.rect.y >= headerCutoff && a.value <= BHR_CEILING,
    );
    const gridNames = positionedNames.filter((n) => n.rect.y >= headerCutoff);

    // (A) Whole-image anchors → one observation per detected number, paired to
    // the nearest name above it. This handles dense BHR clusters well and is
    // the baseline.
    const coveredNames = new Set<string>();
    for (const bhr of gridAnchors) {
      const name = findNameAboveBhr(bhr, gridNames);
      if (name) coveredNames.add(name.championId);
      // Read the gold ascension badge at the right end of the BHR row, but only
      // for cards we'll import (those with a name) to save OCR calls. Absent
      // badge ⇒ null ⇒ derivation falls back to fitting the best ascension.
      const ascHint = name ? await ocrAscensionBadge(canvas, bhr.rect) : null;
      observations.push({
        value: bhr.value,
        rect: bhr.rect,
        canvas,
        nameHintId: name?.championId ?? null,
        nameRect: name?.rect ?? null,
        ascHint,
        screenshots: new Set([i]),
      });
    }

    // (B) Recover named cards that NO anchor covered (name read but the
    // whole-image pass missed its number — e.g. dense duplicate-BHR rows like
    // White Tiger/Kindred). Read the number from a focused crop below the name.
    // Purely ADDITIVE: never suppresses a whole-image anchor, so it can't
    // regress dense clusters.
    let recovered = 0;
    for (const name of gridNames) {
      if (coveredNames.has(name.championId)) continue;
      const region = bhrRegionBelowName(name.rect, canvas.width, canvas.height);
      if (!region) continue;
      const value = await ocrBhrStrip(canvas, region);
      if (value === null || value > BHR_CEILING) continue;
      observations.push({
        value,
        rect: region,
        canvas,
        nameHintId: name.championId,
        nameRect: name.rect,
        ascHint: name.ascensionHint,
        screenshots: new Set([i]),
      });
      recovered++;
    }

    console.log(
      `[seeder] screenshot ${i}: ${gridNames.length} names, ${gridAnchors.length} anchors, ${recovered} per-name recoveries`,
    );
  }

  // The per-name strip OCR uses a shared worker; release it now that the
  // screenshot loop is done (Phase 4 only needs canvas ops, not OCR).
  await terminateOcrWorker();

  // ── Phase 2: dedupe across overlapping screenshots ───────────────────────
  // A representative absorbs an observation only if it could be the SAME card:
  // BHR within DEDUP_BHR, compatible name hints, and — critically — from a
  // different screenshot. Two anchors in one screenshot are always distinct
  // champions (the BHR-sorted page can pack several within a few points), so
  // merging them would silently drop real champions.
  const reps: BhrObservation[] = [];
  for (const obs of observations) {
    const obsScreenshot = [...obs.screenshots][0]!;
    // Merge into the CLOSEST eligible representative by BHR value. In dense
    // clusters several reps may be within DEDUP_BHR; first-match would merge
    // the overlapping read into the wrong neighbour.
    let rep: BhrObservation | null = null;
    let repDist = Infinity;
    for (const r of reps) {
      if (r.screenshots.has(obsScreenshot)) continue;
      if (!namesCompatible(r, obs)) continue;
      const dist = Math.abs(r.value - obs.value);
      if (dist <= DEDUP_BHR && dist < repDist) {
        rep = r;
        repDist = dist;
      }
    }
    if (rep) {
      // Adopt the richer signal: a name read in one screenshot but not another.
      if (!rep.nameHintId && obs.nameHintId) {
        rep.nameHintId = obs.nameHintId;
        rep.nameRect = obs.nameRect;
        rep.canvas = obs.canvas;
      }
      if (!rep.ascHint && obs.ascHint) rep.ascHint = obs.ascHint;
      rep.screenshots.add(obsScreenshot);
      continue;
    }
    reps.push({ ...obs, screenshots: new Set(obs.screenshots) });
  }
  console.log(
    `[seeder] ${observations.length} BHR observations → ${reps.length} unique after dedupe`,
  );

  // ── Phase 3: global one-to-one assignment (BHR-first) ────────────────────
  const assignments = assignChampionsByBHR(
    reps.map((r) => ({
      value: r.value,
      nameHintId: r.nameHintId,
      ascHint: r.ascHint,
    })),
    champions,
  );

  const claimedChamp = new Set(assignments.map((a) => a.championId));
  const corroborated = assignments.filter((a) => a.corroborated).length;
  console.log(
    `[seeder] assigned ${assignments.length}/${reps.length} BHR observations ` +
      `(${corroborated} name-corroborated)`,
  );

  // ── Phase 4: build a review card for every detected BHR (assigned or not) ─
  // Name-less / ambiguous cards are kept (agreement 'weak') so the user can
  // recover them in the grid — losing a top-30 champion hurts more than asking
  // for one click. State is NOT written here; the confirmation grid produces
  // confirmed states (and saves portraits) once the user reviews.
  const assignmentByObs = new Map<number, (typeof assignments)[number]>();
  for (const a of assignments) assignmentByObs.set(a.obsIndex, a);

  const cards: IdentifiedCard[] = [];
  for (let n = 0; n < reps.length; n++) {
    const rep = reps[n]!;

    const candidates = findChampionsByBHR(
      rep.value,
      rep.ascHint,
      champions,
      IDENTIFY_TOLERANCE,
    );
    const assignment = assignmentByObs.get(n) ?? null;

    const chosenId = assignment?.championId ?? candidates[0]?.championId ?? '';
    const chosenChamp = chosenId ? champLookup.get(chosenId) : undefined;

    onProgress?.({
      kind: 'seeding',
      champion: chosenChamp?.name ?? `BHR ${rep.value}`,
      current: n,
      total: reps.length,
    });

    const asc =
      rep.ascHint ?? assignment?.ascension ?? candidates[0]?.ascension ?? 'A0';

    // Derive (rank, sig) from the known BHR for the chosen champion.
    let derivedState: DerivedState | null = chosenChamp
      ? deriveStateFromBHR(
          chosenChamp,
          rep.value,
          chosenChamp.ascendable ? asc : 'A0',
          SEEDER_TOLERANCE,
        )
      : null;
    // Fall back to the BHR candidate's own (rank, sig) if derivation missed,
    // so the card still shows a state and carries the BHR for re-derivation.
    if (!derivedState && candidates[0]) {
      const c0 = candidates[0]!;
      derivedState = {
        rank: c0.rank,
        sig: c0.sig,
        ascension: c0.ascension,
        ocredBHR: rep.value,
        predictedBHR: c0.predicted,
        absError: c0.absError,
        alternatives: [],
      };
    }

    const crop = portraitCropRect(rep);
    let portraitHash = '';
    let thumbnailDataUrl = '';
    if (crop) {
      portraitHash = hashImageRegion(
        rep.canvas,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
      );
      thumbnailDataUrl = await generateThumbnail(
        rep.canvas,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        64,
      );
    }

    const agreement: MatchResult['agreement'] = assignment
      ? assignment.corroborated
        ? 'strong'
        : 'partial'
      : 'weak';
    const confidence = assignment?.corroborated
      ? 0.95
      : derivedState
        ? confidenceFromAbsError(derivedState.absError)
        : 0.3;

    cards.push({
      tile: {
        detected: {
          rect: rep.rect,
          cardIndex: n,
          sourceIndex: [...rep.screenshots][0] ?? 0,
          anchor: { value: rep.value, text: String(rep.value), rect: rep.rect },
        },
        portraitHash,
        thumbnailDataUrl,
        derivedState,
        nameText: rep.nameHintId
          ? (champLookup.get(rep.nameHintId)?.name ?? null)
          : null,
      },
      match: {
        championId: chosenId,
        championName: chosenChamp?.name ?? '',
        confidence,
        agreement,
        alternatives: candidates.map((c) => ({
          championId: c.championId,
          championName: c.championName,
          score: c.absError,
        })),
      },
      userOverrideId: null,
    });
  }

  // Surface the cards that need attention: weak (name-less) first, then
  // partial, then the confident corroborated matches; by BHR within each band.
  const bandOrder: Record<MatchResult['agreement'], number> = {
    weak: 0,
    partial: 1,
    strong: 2,
  };
  cards.sort(
    (a, b) =>
      bandOrder[a.match.agreement] - bandOrder[b.match.agreement] ||
      (b.tile.derivedState?.ocredBHR ?? 0) -
        (a.tile.derivedState?.ocredBHR ?? 0),
  );

  const missing = champions
    .filter((c) => !claimedChamp.has(c.id))
    .map((c) => c.name);
  console.log(
    `[seeder] ${cards.length} review cards (${assignments.length} auto-identified); ${missing.length} champions not detected`,
  );

  onProgress?.({ kind: 'done', seeded: assignments.length, total: reps.length });

  return { cards };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Strip below a champion name expected to contain that card's BHR number (a
 * stars / ascension row usually sits between the name and the number). Defined
 * PROPORTIONALLY to the name's own height so it self-scales across devices/
 * resolutions — the in-card layout is one fixed UI design, just scaled, so the
 * name→BHR gap tracks the name size. (Only validated on Android; see memory.)
 */
function bhrRegionBelowName(
  name: Rect,
  canvasW: number,
  canvasH: number,
): Rect | null {
  const h = name.height;
  // Guard degenerate name rects (a 2px-wide crop crashes Tesseract's scaler).
  if (h <= 0 || name.width < 20) return null;
  const padX = name.width * 0.15;
  const x = Math.max(0, name.x - padX);
  const y = Math.min(canvasH, name.y + h * 0.8);
  const width = Math.min(canvasW - x, name.width + padX * 2);
  const height = Math.min(canvasH - y, h * 3.6);
  if (width <= 1 || height <= 1) return null;
  return { x, y, width, height };
}

/**
 * Region to hash/crop as the champion portrait. Prefer the name rect (the name
 * spans the card width directly under the portrait); fall back to a best-effort
 * box above the BHR anchor for name-less cards so even those show a recognisable
 * thumbnail in the review grid. Clamped to the canvas.
 */
function portraitCropRect(rep: BhrObservation): Rect | null {
  const cw = rep.canvas.width;
  const ch = rep.canvas.height;
  const clamp = (r: Rect): Rect | null => {
    const x = Math.max(0, Math.min(r.x, cw));
    const y = Math.max(0, Math.min(r.y, ch));
    const width = Math.max(0, Math.min(r.width, cw - x));
    const height = Math.max(0, Math.min(r.height, ch - y));
    return width > 1 && height > 1 ? { x, y, width, height } : null;
  };

  if (rep.nameRect && rep.nameRect.width > 0) {
    const portraitHeight = rep.nameRect.height * 4;
    const y = Math.max(0, rep.nameRect.y - portraitHeight);
    return clamp({
      x: rep.nameRect.x,
      y,
      width: rep.nameRect.width,
      height: rep.nameRect.y - y,
    });
  }

  // No name read: the portrait sits roughly a name-row above the BHR number.
  const b = rep.rect;
  if (b.width <= 0 || b.height <= 0) return null;
  const cardW = b.width * 1.4;
  const cx = b.x + b.width / 2;
  const bottom = Math.max(0, b.y - b.height * 2);
  const top = Math.max(0, bottom - cardW);
  return clamp({ x: cx - cardW / 2, y: top, width: cardW, height: bottom - top });
}

/** Two observations may be the same card if at least one lacks a name hint,
 *  or both name hints agree. Distinct names ⇒ distinct cards (never merge). */
function namesCompatible(a: BhrObservation, b: BhrObservation): boolean {
  if (a.nameHintId === null || b.nameHintId === null) return true;
  return a.nameHintId === b.nameHintId;
}

/**
 * Find the OCR'd name positioned directly above a BHR anchor (same card).
 * Used only as a soft hint — being the nearest name above is device-stable
 * (every name shifts by the same offset across aspect ratios), and the engine
 * math validates the pairing regardless.
 */
function findNameAboveBhr(
  bhr: BHRAnchor,
  names: NameAnchor[],
): NameAnchor | null {
  const bhrCx = bhr.rect.x + bhr.rect.width / 2;
  const bhrTop = bhr.rect.y;
  const bhrBottom = bhr.rect.y + bhr.rect.height;

  let best: NameAnchor | null = null;
  let bestDist = Infinity;

  for (const name of names) {
    const nameCx = name.rect.x + name.rect.width / 2;
    const nameBottom = name.rect.y + name.rect.height;
    // Name must sit above the BHR (its bottom edge no lower than the BHR's).
    if (nameBottom > bhrBottom) continue;
    const yGap = bhrTop - nameBottom;
    // Allow the stars/ascension row that sits between name and BHR.
    const yLimit = Math.max(name.rect.height, bhr.rect.height) * 6;
    if (yGap > yLimit) continue;
    // Name and BHR are both centered on the card, so x-centers align closely.
    const xDist = Math.abs(nameCx - bhrCx);
    if (xDist > Math.max(name.rect.width, bhr.rect.width)) continue;

    const dist = Math.max(0, yGap) + xDist * 0.5;
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }

  return best;
}
