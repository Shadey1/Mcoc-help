import type { ChampionClass } from '@prestige-tools/engine';

/**
 * Champion card rendering — magic numbers, with provenance.
 *
 * All constants below were derived by template-matching the in-game prestige
 * screenshot against the frame asset PNGs (sourced from auntm.ai's UI atlas
 * bundle: t7_portrait_frame.png, t6_portrait_frame.png, leg_portrait_frame.png).
 * The frame asset is native 212×174 but the game renders it ~5% wider, so the
 * runtime aspect doesn't match the texture's intrinsic ratio.
 *
 * If Kabam redesigns the frame in a future update, re-derive these by:
 *
 *   1. Capture a clean prestige-screen screenshot at known device resolution
 *      (Pixel 6 / iPhone 15 reference set lives in the test screenshots dir
 *      — see the OCR test-screenshots memory).
 *   2. Open the frame PNG in an image editor next to the screenshot; scale
 *      the frame to match the rendered card pixel-for-pixel. Record the
 *      rendered width / rendered height as RENDERED_FRAME_ASPECT.
 *   3. Measure portrait left edge, top edge (above frame top), and side
 *      length in screenshot pixels; divide each by the rendered card width
 *      to get PORTRAIT_LEFT_FRAC / FRAME_TOP_FRAC / PORTRAIT_SIDE_FRAC.
 *   4. Run the alpha-channel scan in scripts/ to confirm the opening Y range
 *      against the new frame; update OPENING_TOP_IN_FRAME / OPENING_BOT_IN_FRAME
 *      if the frame interior changed.
 *
 * Geometry is expressed as fractions of container WIDTH (Fw). The card's
 * total height in container units is FRAME_TOP_FRAC + FRAME_H_FRAC, which
 * gives the canvas aspect. See `champion-portrait.tsx` for how these convert
 * to CSS percentages.
 */

// Rendered frame aspect (W/H). Texture is 212/174 ≈ 1.218; game stretches it
// to ~1.275. The frame <img> uses objectFit:fill at this aspect.
export const RENDERED_FRAME_ASPECT = 1.275;

// Frame Y position in the card (top of frame, below the pop-out band).
export const FRAME_TOP_FRAC = 0.0875;

// Frame height as fraction of Fw, derived from the rendered aspect.
export const FRAME_H_FRAC = 1 / RENDERED_FRAME_ASPECT; // 0.78431

// Portrait — true square in screen space, drawn over the frame. Top = 0
// puts FRAME_TOP_FRAC·Fw of the portrait above the frame top (the pop-out).
export const PORTRAIT_LEFT_FRAC = 0.1156;
export const PORTRAIT_SIDE_FRAC = 0.7446;

// Inner opening Y bounds in NATIVE frame coordinates (alpha-channel scan
// of t6_portrait_frame.png / leg_portrait_frame.png, identical to a pixel).
// These propagate through FRAME_H_FRAC so the backdrop opening inherits
// the runtime vertical compression automatically.
export const OPENING_TOP_IN_FRAME = 24 / 174;  // 0.13793
export const OPENING_BOT_IN_FRAME = 165 / 174; // 0.94828

// Star strip anchor (centre y) — for when we render the rank strip.
// Frame-coord y=136 (canvas y after frame compression: see champion-portrait).
export const STAR_STRIP_CENTRE_Y_IN_FRAME = 136 / 174; // 0.78161

/**
 * Per-class backdrop gradient. Light centre at ellipse 50%/35%, dark edge.
 *
 * Provenance: centre hues hand-picked to approximate the in-game class
 * tinting, then dialed back ~10–15% in saturation/lightness so they sit
 * well on the cream page background (game palette is tuned for a dark UI).
 *
 * Cosmic and Tech were originally both rendered as similar blues, which made
 * them hard to tell apart at thumbnail size — Cosmic moved to teal-cyan and
 * Tech to indigo to give them visible separation in the grid.
 *
 * If you tweak these: keep the 6 hues mutually distinguishable at ~40px
 * thumbnail size (the smallest place these gradients render), and keep
 * edge tones near-black so the radial vignette reads.
 */
export const CLASS_GRADIENT: Record<
  ChampionClass,
  { center: string; edge: string }
> = {
  Cosmic:  { center: '#1FB6C9', edge: '#06282E' }, // teal-cyan
  Mystic:  { center: '#B85FE6', edge: '#1F0828' }, // purple
  Mutant:  { center: '#F5C842', edge: '#2A1E08' }, // yellow
  Science: { center: '#5CC95E', edge: '#0A220C' }, // green
  Skill:   { center: '#E64848', edge: '#280808' }, // red
  Tech:    { center: '#3D5BDB', edge: '#0B1233' }, // indigo
};

/**
 * Bottom-fade mask: portrait's bottom ~9.5% (15px of a 158px portrait)
 * fades to alpha 0 so the art dissolves into the backdrop. Skipped on
 * thumbnails below 40px rendered size — at that scale the fade eats the
 * chin instead of hiding a seam.
 */
export const BOTTOM_FADE_MASK =
  'linear-gradient(to bottom, black 0%, black 90.5%, transparent 100%)';
export const BOTTOM_FADE_MIN_SIZE_PX = 40;
