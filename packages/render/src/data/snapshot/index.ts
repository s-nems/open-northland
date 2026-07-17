/**
 * The snapshot folder: the defensive decode primitives every reader above it builds on — an entity's
 * position and numeric component fields ({@link import('./component-access.js')}), and the
 * `Stockpile.amounts` pair read ({@link import('./stockpile.js')}).
 *
 * Concern-neutral by design: neither `scene/` nor `hud/` owns these — both sit above them. Shared
 * contract: pure, total functions of a snapshot entity's plain-cloned `components` record; a missing or
 * malformed component reads as its "absent" value (`null`/`undefined`/empty), never a throw. Nothing here
 * re-enters the sim.
 */

export { type PositionValue, readNumField, readNumFieldOrNull, readPosition } from './component-access.js';
export { isStockpileAmount, readStockpileAmounts } from './stockpile.js';
