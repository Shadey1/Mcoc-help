/**
 * Average-hash (aHash) perceptual hashing for champion portrait identification.
 *
 * The use case is matching a portrait extracted from a screenshot against
 * our library of 254 source-quality portraits. The transforms we need to
 * handle: rescaling (the screenshot version is smaller), JPEG compression
 * artifacts, slight aliasing on card borders. We don't need rotation /
 * mirroring tolerance.
 *
 * aHash is the simplest fingerprint that handles these and is fast enough
 * to compute on every card extracted in <1ms. Pseudocode:
 *
 *   1. Resize to 8x8 (64 pixels)
 *   2. Greyscale
 *   3. Compute mean intensity
 *   4. For each pixel: 1 if above mean, 0 below — produces 64-bit string
 *
 * Match by Hamming distance (count of differing bits). Distance 0 = identical;
 * distance ≤ 8 is a confident match; distance > 16 means probably different
 * images.
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
  // Downsample to 8x8 via canvas drawImage (browser-native bilinear).
  const small = new OffscreenCanvas(HASH_SIZE, HASH_SIZE);
  const ctx = small.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');

  ctx.drawImage(source, x, y, width, height, 0, 0, HASH_SIZE, HASH_SIZE);
  const data = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE).data;

  // Convert each pixel to greyscale luminance using ITU-R BT.601.
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

  // Build the 64-bit hash, MSB-first within each byte.
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
    // Popcount the XOR'd byte using Brian Kernighan's bit-counting trick
    while (xor) {
      xor &= xor - 1;
      dist++;
    }
  }
  return dist;
}

/**
 * Find the closest matching champion by portrait hash.
 *
 * @param needle Hash of the screenshot portrait
 * @param library Pre-computed table of championId → hash
 * @param maxDistance Reject matches above this distance (default 16)
 * @returns Best match + N alternatives, sorted by distance ascending
 */
export function findClosestPortrait(
  needle: string,
  library: Record<string, string>,
  maxDistance = 16,
  topN = 5,
): Array<{ championId: string; distance: number }> {
  const results: Array<{ championId: string; distance: number }> = [];
  for (const [championId, hash] of Object.entries(library)) {
    const distance = hammingDistance(needle, hash);
    if (distance <= maxDistance) {
      results.push({ championId, distance });
    }
  }
  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, topN);
}

/**
 * Confidence score from hamming distance. Distance 0 → 1.0, distance ≥ 16 → 0.
 * Linear in between.
 */
export function confidenceFromDistance(distance: number): number {
  if (distance >= 16) return 0;
  if (distance <= 0) return 1;
  return 1 - distance / 16;
}
