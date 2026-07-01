import fixtureJson from '../../../../data/champions/immunities-fixture.json' with { type: 'json' };
import type { ImmunityDataset } from '../../src/immunities.js';

/**
 * Test shim over the production fixture at data/champions/immunities-fixture.json.
 * Kept as a thin re-export so tests read like the plain object literal and
 * so the fixture data has a single source of truth (loaded by the web app
 * too). See the JSON file's _meta for provenance.
 */
export const IMMUNITY_FIXTURE = fixtureJson.champions as unknown as ImmunityDataset;
export const FIXTURE_IDS = Object.keys(IMMUNITY_FIXTURE);
