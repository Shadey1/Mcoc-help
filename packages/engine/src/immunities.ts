/**
 * Immunity query engine — pure TS, no DOM/no React.
 *
 * The /immunities view (apps/web) is a UI wrapper around this module. All
 * the logic that decides which champions cover a given path of debuffs
 * lives here so it is deterministic, unit-testable, and reusable by any
 * future planner (war, AQ, later cross-alliance features).
 *
 * The four-signal data model (per the handover / community consensus of
 * GuiaMTC, Charles Wung, ChronicVeisalgia) captures a champion's relation
 * to a given effect richly enough to make useful offence decisions:
 *
 *   immune    — blocks the debuff entirely; never applies.
 *   resist %  — potency reduction. At ≥100% no damage lands, but the
 *               debuff still applies, so Willpower / Inequity / node
 *               "opponent has a debuff" triggers still fire. This is the
 *               distinction competitor boolean immune/not models miss.
 *   mechanic  — purifies after apply, or cuts duration significantly.
 *   synergy   — the effect is only blocked when a specific teammate is
 *               on the squad.
 */

// ─── Effect vocabulary ──────────────────────────────────────────────────

/**
 * The 13 offence-relevant debuffs the view tracks in v1. MCOCHUB lists
 * 43 total effect types, but these cover the damage-over-time and
 * control debuffs players actually plan around. Order matches the chip
 * row in the mockup — grouped loosely by damage class rather than
 * alphabetical.
 */
export const IMMUNITY_EFFECTS = [
  'Bleed',
  'Poison',
  'Incinerate',
  'Coldsnap',
  'Shock',
  'Neuroshock',
  'Stun',
  'Stagger',
  'Nullify',
  'Armor Break',
  'Degeneration',
  'Power Burn',
  'Heal Block',
] as const;

export type EffectName = (typeof IMMUNITY_EFFECTS)[number];

// ─── The four-signal band model ────────────────────────────────────────

export type ImmunityBand =
  | { band: 'immune' }
  | { band: 'resist'; qual: string }
  | { band: 'mechanic'; qual: 'Purify' | 'Duration' }
  | { band: 'synergy'; partner: string };

export type BandKind = ImmunityBand['band'];

/** A champion's sparse per-effect mapping. Absent keys mean "no data". */
export type ChampionImmunities = Partial<Record<EffectName, ImmunityBand>>;

/** Dataset keyed by seed champion id → their per-effect mapping. */
export type ImmunityDataset = Record<string, ChampionImmunities>;

/**
 * Toggle any band off to remove champions whose only relevant coverage
 * uses that band — the "on a lethal path I only trust true immunity"
 * escape hatch.
 */
export type BandFilter = Record<BandKind, boolean>;
export const ALL_BANDS_ON: BandFilter = {
  immune: true,
  resist: true,
  mechanic: true,
  synergy: true,
};

export type QueryMode = 'all' | 'any';

// ─── Effective-immunity + scoring helpers ──────────────────────────────

/**
 * Does a mark represent "effective immunity" — i.e. ≥100% resist? True
 * only for the resist band. Note: full-immune returns FALSE here because
 * that's already stronger than "effective"; call sites treat immune as a
 * distinct top tier. Keeping the two concepts separate lets the UI ban
 * "effective immunity" specifically (mastery interaction concern) while
 * keeping true immunity.
 */
export function isEffectivelyImmune(
  m: ImmunityBand | null | undefined,
): boolean {
  if (!m || m.band !== 'resist') return false;
  // Parse the leading integer of the qual — accepts "150%", "150", "150 %".
  const parsed = parseInt(m.qual, 10);
  return Number.isFinite(parsed) && parsed >= 100;
}

/**
 * Per-effect band weight for ranking. Higher = better protection.
 *   immune        → 4
 *   ≥100% resist  → 3   (takes no damage, but debuff still applies)
 *    <100% resist → 2
 *   mechanic      → 2
 *   synergy       → 1
 */
export function bandScore(band: ImmunityBand): number {
  if (band.band === 'immune') return 4;
  if (isEffectivelyImmune(band)) return 3;
  if (band.band === 'resist') return 2;
  if (band.band === 'mechanic') return 2;
  return 1;
}

// ─── Query result ──────────────────────────────────────────────────────

/**
 * One champion's match against the current query.
 *
 * `marks` is keyed by every selected effect (not just the covered ones)
 * so the UI can render a null badge for a missing effect in ANY mode
 * — showing what the champion doesn't cover is as important as showing
 * what they do. Effects whose band was filtered out come back as null
 * too, so the same "missing" badge renders and the score reflects only
 * remaining coverage.
 */
export type ImmunityHit = {
  championId: string;
  covered: number;
  marks: Partial<Record<EffectName, ImmunityBand | null>>;
};

/**
 * Total scoring weight of a hit across the selected effects. Used to
 * break ties when two champions cover the same count of effects — the
 * one with stronger bands ranks higher.
 */
export function hitScore(hit: ImmunityHit, selected: readonly EffectName[]): number {
  let s = 0;
  for (const eff of selected) {
    const m = hit.marks[eff];
    if (m) s += bandScore(m);
  }
  return s;
}

// ─── Main query ────────────────────────────────────────────────────────

/**
 * Run selected effects against a dataset, restricted to the given pool
 * of champion ids.
 *
 * Sorting: covered desc → hitScore desc → championId asc.
 * A full-coverer with weaker bands can rank below a partial-coverer with
 * stronger bands only if their covered counts tie, which is the intended
 * behaviour — the primary axis is "how much of the path does this
 * champion answer?"
 */
export function queryImmunities(
  dataset: ImmunityDataset,
  championIds: readonly string[],
  selected: readonly EffectName[],
  mode: QueryMode,
  bandFilter: BandFilter = ALL_BANDS_ON,
): ImmunityHit[] {
  if (selected.length === 0) return [];
  const hits: ImmunityHit[] = [];
  for (const id of championIds) {
    const champImm = dataset[id];
    const marks: ImmunityHit['marks'] = {};
    let covered = 0;
    for (const eff of selected) {
      const m = champImm?.[eff];
      if (m && bandFilter[m.band]) {
        marks[eff] = m;
        covered++;
      } else {
        marks[eff] = null;
      }
    }
    const pass = mode === 'all' ? covered === selected.length : covered >= 1;
    if (pass) hits.push({ championId: id, covered, marks });
  }
  hits.sort((a, b) => {
    if (b.covered !== a.covered) return b.covered - a.covered;
    const sb = hitScore(b, selected);
    const sa = hitScore(a, selected);
    if (sb !== sa) return sb - sa;
    return a.championId.localeCompare(b.championId);
  });
  return hits;
}

/**
 * "Cover all but one" — champions who answer every selected effect but
 * one. Meant to help the player realise they can still do the path by
 * bringing two bodies instead of one. Only makes sense when the user
 * has selected at least two effects.
 */
export function coverAllButOne(
  dataset: ImmunityDataset,
  championIds: readonly string[],
  selected: readonly EffectName[],
  bandFilter: BandFilter = ALL_BANDS_ON,
): ImmunityHit[] {
  if (selected.length < 2) return [];
  const anyHits = queryImmunities(dataset, championIds, selected, 'any', bandFilter);
  return anyHits.filter((h) => h.covered === selected.length - 1);
}

/**
 * Per-effect roster counts — feeds the "12 · Bleed" chip labels.
 * Counts a champion once per effect they cover, respecting the band
 * filter. When only some bands are on, the counts drop accordingly.
 */
export function effectRosterCounts(
  dataset: ImmunityDataset,
  championIds: readonly string[],
  bandFilter: BandFilter = ALL_BANDS_ON,
): Record<EffectName, number> {
  const out = {} as Record<EffectName, number>;
  for (const eff of IMMUNITY_EFFECTS) out[eff] = 0;
  for (const id of championIds) {
    const champImm = dataset[id];
    if (!champImm) continue;
    for (const eff of IMMUNITY_EFFECTS) {
      const m = champImm[eff];
      if (m && bandFilter[m.band]) out[eff]++;
    }
  }
  return out;
}
