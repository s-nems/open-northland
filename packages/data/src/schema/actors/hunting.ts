import { z } from 'zod';
import { TypeId } from '../record.js';

/**
 * One hunting-prey row: an animal tribe a hunter may hunt, and what its carcass yields. AUTHORED
 * balance data, not an extracted table - `animaltypes.ini` carries no per-species yield (only the
 * near-uniform `maximumcadaversize`), and its `catchable` flag marks the two livestock species
 * (cattle, sheep) rather than game. A species with no row is not huntable at all (wolves, bears,
 * decorative fauna). Source basis "Hunter prey and carcass yields": the species set and amounts are
 * a named approximation (user-specified).
 */
export const HuntPrey = z.strictObject({
  /** Prey tribe - the cross-ref into {@link TribeType}, keyed like {@link AnimalType.tribeType}. */
  tribeType: TypeId,
  /** Hunted only when no normal prey is in the hunting area - livestock kept for husbandry. */
  lastResort: z.boolean().default(false),
  /** Carcass contents: each entry becomes one harvestable carcass node of `amount` units. */
  yields: z.array(z.strictObject({ goodType: TypeId, amount: z.number().int().positive() })).min(1),
});
export type HuntPrey = z.infer<typeof HuntPrey>;
