'use client';

import {
  SEASON_EDGES,
  SEASON_LANE,
  SEASON_NODES,
  SEASON_PT,
  seasonLane,
  seasonPos,
  type NodeNumber,
  type NodePlacement,
  type PlayerId,
} from '@prestige-tools/engine';

/**
 * Canvas exports — map and per-player PNGs.
 *
 * Ports the mockup's `exportMap` and `exportPlayers` functions to TS.
 * All drawing is `drawImage`-free: portraits are rendered as
 * class-hued gradient panels with the champion's initials. This side-
 * steps the CORS-taint that would break `toDataURL` if we hot-linked
 * Fandom portraits; upgrading to real portraits is a follow-up once we
 * host them ourselves or find a CORS-enabled CDN.
 */

const NAVY_BG = '#0b1020';
const NAVY_GLOW_1 = '#1a2442';
const CREAM = '#f4efe4';
const CREAM_DIM = '#9aa6c4';
const CREAM_FAINT = '#6f7ba0';
const GOLD = '#f2b93b';
const RED_MISS = '#ff8a7a';
const PIN_GOLD = '#d9a93f';

const MAP_TITLE_FONT = '700 46px Fraunces, Georgia, serif';
const MAP_DATE_FONT = '400 20px "Libre Franklin", system-ui, sans-serif';
const MAP_BRAND_FONT = '700 28px Fraunces, Georgia, serif';
const MAP_CREDIT_FONT = '400 16px "Libre Franklin", system-ui, sans-serif';
const PLAYER_TITLE_FONT = '700 44px Fraunces, Georgia, serif';
const PLAYER_SUBTITLE_FONT = '400 18px "Libre Franklin", system-ui, sans-serif';
const PLAYER_NAME_FONT = '700 26px Fraunces, Georgia, serif';
const PLAYER_COUNT_FONT = '400 14px "Libre Franklin", system-ui, sans-serif';
const PLAYER_CHAMP_FONT = '600 16px "Libre Franklin", system-ui, sans-serif';
const NODE_LABEL_FONT_NORMAL = '700 18px "Libre Franklin", system-ui, sans-serif';
const NODE_LABEL_FONT_TIGHT = '700 16px "Libre Franklin", system-ui, sans-serif';

type ExportDeps = {
  bg: 1 | 2 | 3;
  placements: Record<NodeNumber, NodePlacement>;
  unfilled: readonly NodeNumber[];
  championNameFor: (id: string) => string;
  championShortFor: (id: string) => string;
  championPortraitFor: (id: string) => string | null;
  playerNameFor: (id: PlayerId) => string;
  playerOrder: readonly { id: PlayerId; name: string }[];
};

function isPT(x: number | string): x is keyof typeof SEASON_PT {
  return typeof x === 'string' && x in SEASON_PT;
}
function coord(x: number | string): readonly [number, number] {
  if (typeof x === 'number') return seasonPos(x as NodeNumber);
  if (isPT(x)) return SEASON_PT[x]!;
  throw new Error(`unknown endpoint: ${String(x)}`);
}

function hueOf(id: string): number {
  let a = 7;
  for (const c of id) a = ((a * 31 + c.charCodeAt(0)) | 0) >>> 0;
  return a % 360;
}

function initialsOf(name: string): string {
  return name
    .replace(/^(The|Mister|Doctor) /, '')
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

function fitText(x: CanvasRenderingContext2D, text: string, max: number): string {
  if (x.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/**
 * Load a portrait as an HTMLImageElement with CORS enabled so `drawImage`
 * doesn't taint the canvas. Fandom's CDN (static.wikia.nocookie.net)
 * sends `access-control-allow-origin: *` on image responses, so this
 * works for the seed's default portrait URLs.
 *
 * Resolves to null on any error (missing URL, network flake, a hypothetical
 * portrait host that doesn't return CORS). The renderer falls through to
 * the initials-gradient placeholder for nulls, so the export still
 * completes end-to-end.
 */
function loadPortrait(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Preload every champion portrait we'll need to draw, in parallel.
 *  Returns a map of championId → loaded Image (or null on failure). */
async function preloadPortraits(
  championIds: readonly string[],
  championPortraitFor: (id: string) => string | null,
): Promise<Map<string, HTMLImageElement | null>> {
  const uniq = Array.from(new Set(championIds));
  const entries = await Promise.all(
    uniq.map(async (id) => [id, await loadPortrait(championPortraitFor(id))] as const),
  );
  return new Map(entries);
}

function drawPortrait(
  x: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  champId: string,
  championName: string,
  laneColor: string,
  img: HTMLImageElement | null,
): void {
  const px = cx - size / 2;
  const py = cy - size / 2;
  const r = size * 0.14;
  // Clip to the rounded rect so a rectangular portrait respects the frame.
  x.save();
  x.beginPath();
  x.roundRect(px, py, size, size, r);
  x.clip();
  if (img) {
    // Fill background with the class hue in case the portrait has
    // transparent margins.
    const h = hueOf(champId);
    x.fillStyle = `hsl(${h} 38% 22%)`;
    x.fillRect(px, py, size, size);
    // Draw the portrait cover-style — Fandom portraits are ~square
    // already, so this rarely crops meaningfully.
    x.drawImage(img, px, py, size, size);
  } else {
    // Placeholder: class-hued gradient + initials.
    const h = hueOf(champId);
    const grad = x.createLinearGradient(0, py, 0, py + size);
    grad.addColorStop(0, `hsl(${h} 38% 36%)`);
    grad.addColorStop(1, `hsl(${h} 42% 17%)`);
    x.fillStyle = grad;
    x.fillRect(px, py, size, size);
    x.fillStyle = 'rgba(239, 230, 212, 0.85)';
    x.font = `700 ${Math.round(size * 0.36)}px Fraunces, Georgia, serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(initialsOf(championName), cx, cy + size * 0.03);
    x.textBaseline = 'alphabetic';
    x.textAlign = 'left';
  }
  x.restore();
  // Lane-coloured frame on top, outside the clip.
  x.beginPath();
  x.roundRect(px, py, size, size, r);
  x.lineWidth = size * 0.05;
  x.strokeStyle = laneColor;
  x.stroke();
}

function drawEmptySlot(
  x: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  x.beginPath();
  x.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.14);
  x.setLineDash([6, 5]);
  x.strokeStyle = '#ED1D24';
  x.lineWidth = 2;
  x.stroke();
  x.setLineDash([]);
}

function drawNodeBadge(
  x: CanvasRenderingContext2D,
  bx: number,
  by: number,
  n: NodeNumber,
  size: number,
): void {
  const w = size * 2.2;
  const h = size * 1.6;
  x.beginPath();
  x.roundRect(bx, by, w, h, h * 0.28);
  x.fillStyle = SEASON_LANE[seasonLane(n)]!;
  x.fill();
  x.lineWidth = 2.5;
  x.strokeStyle = NAVY_BG;
  x.stroke();
  x.fillStyle = '#fff';
  x.font = `700 ${size}px "Libre Franklin", system-ui, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(String(n), bx + w / 2, by + h / 2 + 1);
  x.textBaseline = 'alphabetic';
  x.textAlign = 'left';
}

function dateStr(): string {
  return new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

async function ensureFonts(): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    await Promise.all(
      [
        '700 46px Fraunces',
        '600 16px "Libre Franklin"',
        '400 14px "Libre Franklin"',
        '700 16px "Libre Franklin"',
      ].map((f) => document.fonts.load(f)),
    );
  } catch {
    // font-loading unsupported / offline — the browser falls back to
    // system fonts and the export still renders.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Map export
// ─────────────────────────────────────────────────────────────────────────

export async function renderMapExport(deps: ExportDeps, seasonNumber: number): Promise<HTMLCanvasElement> {
  const placedChampIds = Object.values(deps.placements).map((pl) => pl.championId);
  const [_, portraits] = await Promise.all([
    ensureFonts(),
    preloadPortraits(placedChampIds, deps.championPortraitFor),
  ]);
  void _;
  const K = 1.5;
  const X0 = 60;
  const Y0 = -14;
  const W = Math.round(960 * K);
  const H = Math.round(1262 * K);
  const T = ([a, b]: readonly [number, number]): [number, number] => [
    (a - X0) * K,
    (b - Y0) * K,
  ];
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d')!;

  // Navy background + centre glow
  x.fillStyle = NAVY_BG;
  x.fillRect(0, 0, W, H);
  const gl = x.createRadialGradient(W / 2, H * 0.55, 40, W / 2, H * 0.55, W * 0.75);
  gl.addColorStop(0, NAVY_GLOW_1);
  gl.addColorStop(1, 'rgba(11, 16, 32, 0)');
  x.fillStyle = gl;
  x.fillRect(0, 0, W, H);

  // Edges
  for (const e of SEASON_EDGES) {
    const [x1, y1] = T(coord(e[0]));
    const [x2, y2] = T(coord(e[1]));
    const st = e[2];
    x.beginPath();
    x.moveTo(x1, y1);
    x.lineTo(x2, y2);
    if (st === 'hub') {
      x.strokeStyle = '#b0482c';
      x.lineWidth = 4;
      x.setLineDash([16, 10]);
    } else if (st === 'dot') {
      x.strokeStyle = e[3] ?? '#888';
      x.lineWidth = 3;
      x.setLineDash([4, 8]);
    } else {
      x.strokeStyle = '#4a5a86';
      x.lineWidth = 4;
      x.setLineDash([]);
    }
    x.stroke();
    x.setLineDash([]);
  }
  // Junction dots
  for (const k of Object.keys(SEASON_PT)) {
    const [px, py] = T(SEASON_PT[k]!);
    x.beginPath();
    x.arc(px, py, k === 'h1' || k === 'h2' ? 12 : 8, 0, Math.PI * 2);
    x.fillStyle = '#f2b93b';
    x.fill();
    if (k.length === 1) {
      x.fillStyle = '#e0523a';
      x.font = '700 22px "Libre Franklin", system-ui, sans-serif';
      x.textAlign = 'right';
      x.fillText(k, px - 18, py + 8);
      x.textAlign = 'left';
    }
  }
  // Nodes
  const S = 84;
  for (const n of SEASON_NODES) {
    const [cx, cy] = T(seasonPos(n));
    const v = deps.placements[n];
    const tight = n >= 37 && n <= 45;
    if (v) {
      drawPortrait(
        x,
        cx,
        cy,
        S,
        v.championId,
        deps.championNameFor(v.championId),
        SEASON_LANE[seasonLane(n)]!,
        portraits.get(v.championId) ?? null,
      );
    } else {
      drawEmptySlot(x, cx, cy, S);
    }
    drawNodeBadge(x, cx - S / 2 - 8, cy - S / 2 - 10, n, 17);
    if (v?.pinned) {
      x.beginPath();
      x.arc(cx + S / 2 - 6, cy - S / 2 + 6, 8, 0, Math.PI * 2);
      x.fillStyle = PIN_GOLD;
      x.fill();
      x.lineWidth = 2;
      x.strokeStyle = NAVY_BG;
      x.stroke();
    }
    const side = n === 46 || n === 48 ? 'L' : n === 47 || n === 49 || n === 50 ? 'R' : 'B';
    x.font = tight ? NODE_LABEL_FONT_TIGHT : NODE_LABEL_FONT_NORMAL;
    x.fillStyle = v ? CREAM : RED_MISS;
    const label = v
      ? fitText(x, deps.playerNameFor(v.playerId), side === 'B' ? (tight ? 100 : 128) : 170)
      : 'Unfilled';
    if (side === 'B') {
      x.textAlign = 'center';
      x.fillText(label, cx, cy + S / 2 + 24);
    } else {
      x.textAlign = side === 'L' ? 'right' : 'left';
      x.fillText(label, side === 'L' ? cx - S / 2 - 14 : cx + S / 2 + 14, cy + 7);
    }
    x.textAlign = 'left';
  }
  // Title / brand / credit
  x.fillStyle = CREAM;
  x.font = MAP_TITLE_FONT;
  x.textAlign = 'left';
  x.fillText(`BG${deps.bg} defence`, 36, 72);
  x.fillStyle = CREAM_DIM;
  x.font = MAP_DATE_FONT;
  x.fillText(`Season ${seasonNumber}, ${dateStr()}`, 36, 104);
  x.textAlign = 'right';
  x.fillStyle = CREAM;
  x.font = MAP_BRAND_FONT;
  x.fillText('mcoc.help', W - 36, 72);
  x.fillStyle = CREAM_FAINT;
  x.font = MAP_CREDIT_FONT;
  x.fillText('Season war planner (alpha)', W - 36, H - 24);
  x.textAlign = 'left';
  return cv;
}

// ─────────────────────────────────────────────────────────────────────────
// Player export
// ─────────────────────────────────────────────────────────────────────────

export async function renderPlayerExport(deps: ExportDeps, seasonNumber: number): Promise<HTMLCanvasElement> {
  const placedChampIds = Object.values(deps.placements).map((pl) => pl.championId);
  const [_, portraits] = await Promise.all([
    ensureFonts(),
    preloadPortraits(placedChampIds, deps.championPortraitFor),
  ]);
  void _;
  const W = 1080;
  const M = 32;
  const NAMEW = 200;
  const TW = (W - M * 2 - NAMEW) / 5;
  const S = 74;
  const RH = 146;
  const HEAD = 132;
  const activePlayers = deps.playerOrder;
  const H = HEAD + RH * activePlayers.length + 60;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d')!;
  // Warm background matching the site dark mode
  x.fillStyle = '#14110d';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#efe6d4';
  x.font = PLAYER_TITLE_FONT;
  x.textAlign = 'left';
  x.fillText(`BG${deps.bg} defence by player`, M, 72);
  x.fillStyle = '#a89a82';
  x.font = PLAYER_SUBTITLE_FONT;
  x.fillText(`Season ${seasonNumber}, ${dateStr()}. Node number on each portrait.`, M, 104);
  x.textAlign = 'right';
  x.fillStyle = '#efe6d4';
  x.font = MAP_BRAND_FONT;
  x.fillText('mcoc.help', W - M, 72);
  x.textAlign = 'left';
  activePlayers.forEach((p, i) => {
    const y = HEAD + i * RH;
    if (i % 2 === 0) {
      x.fillStyle = '#1c1813';
      x.fillRect(0, y, W, RH);
    }
    x.fillStyle = '#efe6d4';
    x.font = PLAYER_NAME_FONT;
    x.fillText(fitText(x, p.name, NAMEW - 20), M, y + RH / 2 + 2);
    const mine = Object.entries(deps.placements)
      .filter(([, v]) => v.playerId === p.id)
      .sort(([a], [b]) => Number(a) - Number(b));
    x.fillStyle = '#a89a82';
    x.font = PLAYER_COUNT_FONT;
    x.fillText(`${mine.length} of 5`, M, y + RH / 2 + 24);
    mine.forEach(([nStr, v], j) => {
      const n = Number(nStr) as NodeNumber;
      const cx = M + NAMEW + TW * j + TW / 2;
      const cy = y + 18 + S / 2;
      drawPortrait(
        x,
        cx,
        cy,
        S,
        v.championId,
        deps.championNameFor(v.championId),
        SEASON_LANE[seasonLane(n)]!,
        portraits.get(v.championId) ?? null,
      );
      drawNodeBadge(x, cx - S / 2 - 8, cy - S / 2 - 8, n, 16);
      if (v.pinned) {
        x.beginPath();
        x.arc(cx + S / 2 - 6, cy - S / 2 + 6, 7, 0, Math.PI * 2);
        x.fillStyle = PIN_GOLD;
        x.fill();
      }
      x.fillStyle = '#efe6d4';
      x.font = PLAYER_CHAMP_FONT;
      x.textAlign = 'center';
      const label = deps.championNameFor(v.championId);
      const short = deps.championShortFor(v.championId);
      x.fillText(
        x.measureText(label).width <= TW - 8 ? label : fitText(x, short, TW - 8),
        cx,
        cy + S / 2 + 24,
      );
      x.textAlign = 'left';
    });
  });
  x.fillStyle = '#74684f';
  x.font = PLAYER_COUNT_FONT;
  x.fillText('Gold dot marks a pinned placement.', M, H - 26);
  return cv;
}

// ─────────────────────────────────────────────────────────────────────────
// Delivery — Web Share API → download link → modal fallback
// ─────────────────────────────────────────────────────────────────────────

export type DeliveryResult =
  | { kind: 'shared' }
  | { kind: 'downloaded' }
  | { kind: 'modal'; dataUrl: string };

/** Save a canvas as a PNG using the best available delivery method for
 *  the current browser. iOS/Line falls through to the modal, which the
 *  UI shows with "long-press to save" instructions. */
export async function deliverPng(
  canvas: HTMLCanvasElement,
  filename: string,
  title: string,
): Promise<DeliveryResult> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to encode PNG.');

  // 1. navigator.share with a File. Best on iOS Safari 15+ and Android.
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return { kind: 'shared' };
    }
  } catch {
    // User cancelled or share failed — fall through.
  }

  // 2. Download link — works everywhere except iOS Safari (which ignores
  // `download` on cross-origin blobs).
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { kind: 'downloaded' };
  } catch {
    // fall through to modal
  }

  // 3. Modal — the mockup's last resort. The image sits in a modal and
  // the user long-presses to save. Reliable on every browser we've seen.
  return { kind: 'modal', dataUrl: canvas.toDataURL('image/png') };
}
