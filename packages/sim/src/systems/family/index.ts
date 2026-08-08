import type { System } from '../context.js';
import { driveChildOrders } from './children/index.js';
import { driveWeddings } from './weddings.js';

export { findPartnerFor, isAdultSettler, isOnMission, mayMarry } from './eligibility.js';
export {
  builtHomeType,
  familiesOf,
  familyOf,
  isMinor,
  moveFamilyInto,
  storedFoodUnits,
} from './households.js';
export { KISS_ATOMIC_ID, KISSED_ATOMIC_ID, startWedding } from './weddings.js';

/**
 * Marriage and children. Runs after the player-order pass and before the AI planner, so the walks it
 * issues route the same tick and its duty fences are fresh when the planner reads them.
 */
export const familySystem: System = (world, ctx) => {
  driveWeddings(world, ctx, ctx.terrain);
  driveChildOrders(world, ctx, ctx.terrain);
};
