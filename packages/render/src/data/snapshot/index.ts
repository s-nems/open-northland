/** The snapshot decode primitives, owned by neither `scene/` nor `hud/` - both sit above them. */

export { type PositionValue, readNumField, readNumFieldOrNull, readPosition } from './component-access.js';
export { isStockpileAmount, readAmountPairs, readStockpileAmounts } from './stockpile.js';
