/**
 * Perceptual-hash helpers for portrait matching.
 *
 * dHash (difference hash) at 16×16 = 256 bits, computed on the CENTER
 * 60% of the source so the class-tinted background (radial gradient
 * around each portrait) doesn't dominate the signal. aHash + full-frame
 * gave hamming distances >30 between the same character's Fandom
 * portrait and the same character's crop from GuiaMTC — the framing
 * differs too much between the two.
 *
 * Comparison: hammingHex64 — takes two hex strings, returns the count
 * of differing bits.
 */

import sharp from 'sharp';

const HASH_W = 16; // width in bits per row (compare-adjacent gives 16 bits per row of 17 samples)
const HASH_H = 16; // rows

/** Center-crop fraction of each source dimension. The rest is
 *  class-tinted background gradient (Fandom) or cell shading (guide);
 *  neither is discriminative between characters. */
const CENTER_CROP_FRAC = 0.6;

export async function centerCropDHash(input: Buffer | string): Promise<string> {
  const meta = await sharp(input).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const cw = Math.max(1, Math.floor(W * CENTER_CROP_FRAC));
  const ch = Math.max(1, Math.floor(H * CENTER_CROP_FRAC));
  const cx = Math.floor((W - cw) / 2);
  const cy = Math.floor((H - ch) / 2);
  const raw = await sharp(input)
    .extract({ left: cx, top: cy, width: cw, height: ch })
    .resize(HASH_W + 1, HASH_H, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  // dHash: 1 bit per adjacent-horizontal pair.
  let bits = '';
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W; x++) {
      const left = raw[y * (HASH_W + 1) + x]!;
      const right = raw[y * (HASH_W + 1) + x + 1]!;
      bits += left < right ? '1' : '0';
    }
  }
  // 256 bits → 64 hex chars.
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`Hash length mismatch: ${a.length} vs ${b.length}`);
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>>= 1;
    }
  }
  return d;
}

export const HASH_BITS = HASH_W * HASH_H;
