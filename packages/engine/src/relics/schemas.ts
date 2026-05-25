// Zod schemas for relic types.
//
// Kept in a sibling file (rather than co-located in types.ts) because the
// existing types.ts is pure TypeScript types; mixing Zod runtime values
// in would require restructuring. Sibling schemas.ts keeps both modules
// clean and lets the package barrel export both forms.

import { z } from 'zod';

export const RankSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const LevelSchema = z.union([
  z.literal(0),
  z.literal(20),
  z.literal(40),
  z.literal(60),
  z.literal(80),
  z.literal(100),
  z.literal(120),
  z.literal(140),
  z.literal(160),
  z.literal(180),
  z.literal(200),
]);

export const SpecialRelicIdSchema = z.enum(['cosmic-egg']);

export const RelicStateSchema = z.object({
  rank: RankSchema,
  level: LevelSchema,
});

export const RelicCountEntrySchema = z.object({
  rank: RankSchema,
  level: LevelSchema,
  count: z.number().int().min(0),
});

export const SpecialRelicEntrySchema = z.object({
  id: SpecialRelicIdSchema,
  rank: RankSchema,
  level: LevelSchema,
});

export const RelicInventorySchema = z.object({
  standardCounts: z.array(RelicCountEntrySchema),
  specials: z.array(SpecialRelicEntrySchema),
});
