/**
 * Average-hash (aHash) perceptual hashing for champion portrait identification.
 *
 * Hash function + Hamming distance are kept here as pure utilities. The
 * library-lookup function that used to live here (findClosestPortrait) has
 * moved to portrait-store.ts, which manages the user-confirmed portrait
 * library in localStorage. There is no longer a bundled portrait library —
 * the store starts empty and builds up via user confirmations.
 *
 * The aHash algorithm itself:
 *   1. Resize to 8x8 (64 pixels)
 *   2. Greyscale via ITU-R BT.601
 *   3. Compute mean intensity
 *   4. For each pixel: 1 if above mean, 0 below → 64-bit string
 *
 * Match by Hamming distance: 0 = identical; ≤ 8 is strong match; ≤ 16 weak
 * match; > 16 likely different images. Threshold gates live in
 * champion-match.ts so they can co-evolve with the matching logic.
 */

const HASH_SIZE = 8; // 8x8 = 64 bits

/**
 * Hash a region of a source canvas. The region is treated as the portrait
 * subregion of a detected card.
 *
 * @returns 16-character hex string representing 64 bits.
 */
export function hashImageRegion(
  source: HTMLCanvasElement | OffscreenCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const small = new OffscreenCanvas(HASH_SIZE, HASH_SIZE);
  const ctx = small.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');

  ctx.drawImage(source, x, y, width, height, 0, 0, HASH_SIZE, HASH_SIZE);
  const data = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE).data;

  const greys: number[] = new Array(HASH_SIZE * HASH_SIZE);
  let total = 0;
  for (let i = 0; i < HASH_SIZE * HASH_SIZE; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    greys[i] = lum;
    total += lum;
  }

  const mean = total / (HASH_SIZE * HASH_SIZE);

  let hex = '';
  for (let byteIndex = 0; byteIndex < 8; byteIndex++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const pixelIndex = byteIndex * 8 + bit;
      if (greys[pixelIndex]! > mean) {
        byte |= 1 << (7 - bit);
      }
    }
    hex += byte.toString(16).padStart(2, '0');
  }

  return hex;
}

/** Hamming distance between two 16-char hex hashes. Returns 0..64. */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== 16 || hashB.length !== 16) {
    throw new Error(`Invalid hash lengths: ${hashA.length}, ${hashB.length}`);
  }
  let dist = 0;
  for (let i = 0; i < 16; i += 2) {
    const a = parseInt(hashA.substr(i, 2), 16);
    const b = parseInt(hashB.substr(i, 2), 16);
    let xor = a ^ b;
    while (xor) {
      xor &= xor - 1;
      dist++;
    }
  }
  return dist;
}

/**
 * Confidence score from Hamming distance. Distance 0 → 1.0, distance ≥ 16 → 0.
 * Linear in between. Used by champion-match.ts to weight portrait signal.
 */
export function confidenceFromDistance(distance: number): number {
  if (distance >= 16) return 0;
  if (distance <= 0) return 1;
  return 1 - distance / 16;
}
