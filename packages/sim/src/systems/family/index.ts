import type { System } from '../context.js';
import { driveChildOrders } from './children.js';
import { driveWeddings } from './weddings.js';

export { findPartnerFor, isAdultSettler, isOnMission, mayMarry } from './eligibility.js';
export { builtHomeType, familiesOf, familyOf, isMinor, storedFoodUnits } from './households.js';
export { KISS_ATOMIC_ID, KISSED_ATOMIC_ID, startWedding } from './weddings.js';

/**
 * FamilySystem — marriage and children (the mechanics behind the settler's marry / assign-house /
 * make-child orders). Runs after the player-order pass and before the AI planner, so the walks it
 * issues route the same tick and the {@link FamilyDuty}/{@link Wedding} fences are fresh when the
 * planner reads them. Two passes: drive every wedding pair (walk together, kiss, marry — weddings.ts),
 * then every standing child order (stock the home, wait inside, hearts, birth — children.ts).
 */
export const familySystem: System = (world, ctx) => {
  driveWeddings(world, ctx, ctx.terrain);
  driveChildOrders(world, ctx, ctx.terrain);
};
