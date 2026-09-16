import { z } from 'zod';

/** One populated `lafm` fish-swarm slot, at half-cell resolution like the sim grid. */
export const MapFishSwarm = z.strictObject({
  hx: z.number().int().nonnegative(),
  hy: z.number().int().nonnegative(),
  count: z.number().int().min(1).max(30),
  continent: z.number().int().nonnegative(),
});
export type MapFishSwarm = z.infer<typeof MapFishSwarm>;
