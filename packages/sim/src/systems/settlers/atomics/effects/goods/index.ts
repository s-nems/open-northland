// The GOODS effects of the atomic executor - harvest/fell/deplete a resource node, drop and reap
// ground piles, pick up / consume / deposit a carried load. Every mutation conserves goods (nothing
// is conjured or silently destroyed); see each function's contract. Split by concern into this folder;
// import the barrel, not the leaves.

export { addCarry, dropCarriedLoad, dropCarryAtOwnTile } from './carry.js';
export { consumeFood, forageBerry } from './consume.js';
export { drinkDraught } from './drink.js';
export { equipFromStore, unequipWornGood } from './equip.js';
export { harvestFromNode } from './harvest.js';
export {
  beginRestTail,
  continuesHarvest,
  endRestTail,
  swingWorkUnits,
} from './harvest-burst.js';
export { dropOrStackGood, placeUnitOnTile, spillOverRings } from './piles.js';
export { drawUtilityGood, pickupFromStore, pileupIntoStore } from './transfer.js';
export { isUsed } from './wear.js';
