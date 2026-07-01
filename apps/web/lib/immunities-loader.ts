import fixtureJson from '../../../data/champions/immunities-fixture.json' with { type: 'json' };
import type { ImmunityDataset } from '@prestige-tools/engine';

/**
 * Production loader for the four-signal immunity dataset.
 *
 * v1 ships against the hand-authored 15-champion fixture from the design
 * handover. A separate transcription pass (task #80) will expand this to
 * cover the whole 257-champion imported set from GuiaMTC's June-2026
 * chart. The loader signature stays the same when that lands — only the
 * backing file changes — so callers don't need to adapt.
 */
export function loadImmunityDataset(): ImmunityDataset {
  return fixtureJson.champions as unknown as ImmunityDataset;
}

export function immunitiesMeta(): {
  source: string;
  capturedAt: string;
  championCount: number;
} {
  return {
    source: fixtureJson._meta.source,
    capturedAt: fixtureJson._meta.capturedAt,
    championCount: Object.keys(fixtureJson.champions).length,
  };
}
