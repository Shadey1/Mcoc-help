'use client';

import { useState } from 'react';
import type { ChampionClass } from '@prestige-tools/engine';
import { ClassIcon, classColors } from './class-icon';
import {
  BOTTOM_FADE_MASK,
  BOTTOM_FADE_MIN_SIZE_PX,
  CLASS_GRADIENT,
  FRAME_H_FRAC,
  FRAME_TOP_FRAC,
  OPENING_BOT_IN_FRAME,
  OPENING_TOP_IN_FRAME,
  PORTRAIT_LEFT_FRAC,
  PORTRAIT_SIDE_FRAC,
} from '../lib/champion-card-geometry';

/**
 * In-game champion card layout. The frame asset is native 212×174 (aspect
 * 1.218) but is rendered ~5% wider — measured rendered aspect 1.275:1. The
 * frame image is therefore stretched horizontally (or equivalently
 * compressed vertically ~4.5%); all geometry below is expressed as
 * fractions of container WIDTH Fw, then converted to CSS percentages.
 *
 *   Frame:    width Fw, height Fw/1.275, anchored 0.0875·Fw down from
 *             container top (so its top bar sits below the pop-out band).
 *   Portrait: TRUE SQUARE in screen space. side 0.7446·Fw, left 0.1156·Fw,
 *             top 0 (i.e. 0.0875·Fw above frame top — the pop-out).
 *   Backdrop: derives from the frame's alpha mask (native y 24..165 → after
 *             vertical compression, top 0.1956·Fw, height 0.6356·Fw). x/width
 *             aligned to the portrait so any pixel mismatch between alpha
 *             scan and template-match is hidden behind it.
 *
 *   Container H = 0.0875·Fw + Fw/1.275 = 0.8718·Fw → aspect 1.1470:1.
 *
 *   Z-order (bottom→top): class backdrop, frame, portrait, star strip,
 *             nameplate. (Strip + nameplate not yet rendered.)
 *
 * Critical: the portrait is drawn OVER the frame, not inside the opening.
 * Its top 17px covers the frame's top bar; transparent regions of the PNG
 * let the frame and backdrop show through. This requires alpha in the
 * portrait source. If a portrait lacks alpha (opaque background), pass
 * `clipToFrame` so we render it UNDER the frame, clipped to the frame
 * opening — avoids a rectangular block floating above the frame.
 *
 * Bottom fade: the portrait's bottom 15px are masked to transparent so the
 * art dissolves into the backdrop instead of leaving a hard seam at y=141
 * (frame coords). Skipped on thumbnails below 40px rendered size — at that
 * scale the fade eats the chin.
 *
 * Hover pop-out: opt-in via `hoverPop`. Scales the portrait layer only to
 * 1.04 from its bottom edge on hover; frame and backdrop stay still.
 * Respects prefers-reduced-motion.
 */
/**
 *   '7-star'     → t7 (purple/violet) — released at 7★
 *   'unreleased' → t6 (cyan)         — stuck at 6★, not yet at 7★
 *   '5-star'     → leg (red)         — capped out at 5★ (e.g. Quake)
 *   null         → bare portrait, no frame
 */
export type Rarity = '7-star' | 'unreleased' | '5-star' | null;

type ChampionPortraitProps = {
  name: string;
  klass: ChampionClass;
  portraitUrl?: string | null;
  /** Canvas HEIGHT in px (212×191 aspect). Width is derived. */
  size?: number;
  /** Fills parent width; height set via aspect-ratio. */
  fill?: boolean;
  /** Small class icon overlay in the bottom-right corner. */
  showClassOverlay?: boolean;
  /** Rarity frame style — defaults to '7-star'. */
  rarity?: Rarity;
  /**
   * Opaque-source fallback: render portrait UNDER the frame, clipped to the
   * frame opening (no pop-out). Use when the source PNG has no alpha
   * channel — drawing it over the frame would show a rectangular background
   * block above the frame's top bar.
   */
  clipToFrame?: boolean;
  /**
   * Card-grid hover affordance: scales the portrait layer on hover from its
   * bottom edge. Off by default; turn on for grid/card views. Off in the
   * roster table (the table is for scanning, not browsing).
   */
  hoverPop?: boolean;
};

const FRAME_SRC: Record<Exclude<Rarity, null>, string> = {
  '7-star': '/frames/t7.png',
  'unreleased': '/frames/t6.png',
  '5-star': '/frames/leg.png',
};

// Derived CSS percentages — translate the fraction-of-Fw constants from
// champion-card-geometry into fraction-of-container-H values where needed.
const H_FRAC = FRAME_TOP_FRAC + FRAME_H_FRAC; // container H / Fw = 0.87181
const CANVAS_ASPECT = 1 / H_FRAC;             // ≈ 1.1470

const FRAME_TOP_PCT = `${(FRAME_TOP_FRAC / H_FRAC) * 100}%`;    // 10.04%
const FRAME_HEIGHT_PCT = `${(FRAME_H_FRAC / H_FRAC) * 100}%`;   // 89.96%
const PORTRAIT_LEFT_PCT = `${PORTRAIT_LEFT_FRAC * 100}%`;       // 11.56%
const PORTRAIT_WIDTH_PCT = `${PORTRAIT_SIDE_FRAC * 100}%`;      // 74.46%
const PORTRAIT_HEIGHT_PCT = `${(PORTRAIT_SIDE_FRAC / H_FRAC) * 100}%`; // 85.41%
// Backdrop opening: top/bottom inherit the frame's vertical compression;
// x/width align to the portrait so any sub-pixel mismatch is hidden.
const BACKDROP_TOP_FRAC = FRAME_TOP_FRAC + OPENING_TOP_IN_FRAME * FRAME_H_FRAC;
const BACKDROP_H_FRAC =
  (OPENING_BOT_IN_FRAME - OPENING_TOP_IN_FRAME) * FRAME_H_FRAC;
const BACKDROP_TOP_PCT = `${(BACKDROP_TOP_FRAC / H_FRAC) * 100}%`;       // 22.44%
const BACKDROP_HEIGHT_PCT = `${(BACKDROP_H_FRAC / H_FRAC) * 100}%`;      // 72.91%

function backdropStyle(klass: ChampionClass): React.CSSProperties {
  const { center, edge } = CLASS_GRADIENT[klass];
  return {
    backgroundImage: `radial-gradient(ellipse at 50% 35%, ${center} 0%, ${edge} 100%)`,
  };
}

export function ChampionPortrait({
  name,
  klass,
  portraitUrl,
  size = 80,
  fill = false,
  showClassOverlay = false,
  rarity = '7-star',
  clipToFrame = false,
  hoverPop = false,
}: ChampionPortraitProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = portraitUrl && !imageFailed;
  const hasFrame = rarity !== null;

  // Bottom fade applies at card sizes only. Heuristic: skip when an explicit
  // small size is given. In fill mode we assume parent is card-sized.
  const applyBottomFade = fill || size >= BOTTOM_FADE_MIN_SIZE_PX;

  // Hover pop on the portrait layer. Tailwind group/group-hover + Tailwind's
  // motion-reduce: variant for prefers-reduced-motion.
  const popClasses = hoverPop
    ? 'transition-transform duration-150 ease-out origin-bottom group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100'
    : '';

  // No-frame mode: keep a simple square-fill behaviour for the legacy
  // callers that explicitly opt out of the rarity frame.
  if (!hasFrame) {
    const containerStyle: React.CSSProperties = fill
      ? { aspectRatio: '1' }
      : { width: size, height: size };
    const { bg } = classColors(klass);
    return (
      <div
        className={fill ? 'relative w-full' : 'relative inline-block'}
        style={containerStyle}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={portraitUrl}
            alt={`${name} portrait`}
            onError={() => setImageFailed(true)}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: `${bg}1F` }}
          >
            <ClassIcon klass={klass} size={fill ? 40 : Math.round(size * 0.5)} />
          </div>
        )}
        {showClassOverlay && (
          <div className="absolute bottom-1 right-1 bg-[var(--color-paper)] rounded-full p-0.5 shadow-sm z-10">
            <ClassIcon
              klass={klass}
              size={fill ? 16 : Math.max(12, Math.round(size * 0.14))}
            />
          </div>
        )}
      </div>
    );
  }

  // Framed mode: 212×191 canvas, 17px pop-out, portrait over frame.
  const containerStyle: React.CSSProperties = fill
    ? { aspectRatio: `${CANVAS_ASPECT}` }
    : { width: size * CANVAS_ASPECT, height: size };

  // Backdrop layer — always present, fills frame opening.
  const backdrop = (
    <div
      className="absolute"
      style={{
        top: BACKDROP_TOP_PCT,
        left: PORTRAIT_LEFT_PCT,
        width: PORTRAIT_WIDTH_PCT,
        height: BACKDROP_HEIGHT_PCT,
        ...backdropStyle(klass),
      }}
    />
  );

  // Frame layer (always positioned identically — 17px down from the top).
  const frameLayer = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={FRAME_SRC[rarity]}
      alt=""
      aria-hidden="true"
      className="absolute pointer-events-none"
      style={{
        top: FRAME_TOP_PCT,
        left: 0,
        width: '100%',
        height: FRAME_HEIGHT_PCT,
        objectFit: 'fill',
      }}
    />
  );

  // Portrait layer when an image is available.
  // Default: drawn OVER frame (relies on alpha for the pop-out).
  // clipToFrame: drawn UNDER frame, clipped to frame opening, no pop-out.
  let portraitLayer: React.ReactNode = null;
  if (showImage) {
    const imgStyle: React.CSSProperties = {
      objectFit: 'cover',
      objectPosition: 'center',
      ...(applyBottomFade
        ? { maskImage: BOTTOM_FADE_MASK, WebkitMaskImage: BOTTOM_FADE_MASK }
        : {}),
    };
    if (clipToFrame) {
      portraitLayer = (
        <div
          className="absolute overflow-hidden"
          style={{
            top: FRAME_TOP_PCT,
            left: PORTRAIT_LEFT_PCT,
            width: PORTRAIT_WIDTH_PCT,
            height: BACKDROP_HEIGHT_PCT,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={portraitUrl}
            alt={`${name} portrait`}
            onError={() => setImageFailed(true)}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`absolute inset-0 w-full h-full ${popClasses}`}
            style={imgStyle}
          />
        </div>
      );
    } else {
      portraitLayer = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={portraitUrl}
          alt={`${name} portrait`}
          onError={() => setImageFailed(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`absolute ${popClasses}`}
          style={{
            ...imgStyle,
            top: 0,
            left: PORTRAIT_LEFT_PCT,
            width: PORTRAIT_WIDTH_PCT,
            height: PORTRAIT_HEIGHT_PCT,
          }}
        />
      );
    }
  }

  // No-image fallback: class icon centered on the backdrop, under the frame.
  const iconLayer = !showImage && (
    <div
      className="absolute flex items-center justify-center"
      style={{
        top: BACKDROP_TOP_PCT,
        left: PORTRAIT_LEFT_PCT,
        width: PORTRAIT_WIDTH_PCT,
        height: BACKDROP_HEIGHT_PCT,
      }}
    >
      <ClassIcon klass={klass} size={fill ? 40 : Math.round(size * 0.45)} />
    </div>
  );

  // Z-order: backdrop → icon-if-no-image → frame → portrait-if-image.
  const containerClasses = [
    'relative',
    fill ? 'w-full' : 'inline-block',
    hoverPop ? 'group' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses} style={containerStyle}>
      {backdrop}
      {iconLayer}
      {frameLayer}
      {portraitLayer}
      {showClassOverlay && (
        <div className="absolute bottom-1 right-1 bg-[var(--color-paper)] rounded-full p-0.5 shadow-sm z-10">
          <ClassIcon
            klass={klass}
            size={fill ? 16 : Math.max(12, Math.round(size * 0.14))}
          />
        </div>
      )}
    </div>
  );
}
