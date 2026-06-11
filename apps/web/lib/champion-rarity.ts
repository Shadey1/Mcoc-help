import type { Champion } from '@prestige-tools/engine';
import type { Rarity } from '../components/champion-portrait';

/**
 * Display rarity for the portrait frame, derived from the seed entry:
 *
 *   - released at 7★   → '7-star'         (purple frame)
 *   - 6★, awaiting 7★  → 'unreleased'     (cyan frame) — default for stubs
 *   - 5★ only          → '5-star'         (red frame)  — e.g. Quake
 *
 * Callers pass a partial Champion-like object — synergy partner tiles only
 * have a subset of the fields (no prestige), so we accept anything with
 * sevenStarReleased + maxRarity.
 */
export function displayRarity(
  c: Pick<Champion, 'sevenStarReleased' | 'maxRarity'> | null | undefined,
): Rarity {
  if (!c) return '7-star';
  if (c.sevenStarReleased !== false) return '7-star';
  if (c.maxRarity === '5-star') return '5-star';
  return 'unreleased';
}

/**
 * Short label for the "not at 7★" footer on partner tiles / detail banners.
 * Matches displayRarity exactly so the visual frame and the label can't
 * disagree.
 */
export function rarityLabel(rarity: Rarity): string | null {
  switch (rarity) {
    case 'unreleased':
      return 'Not yet 7★';
    case '5-star':
      return 'Only at 5★';
    default:
      return null;
  }
}
