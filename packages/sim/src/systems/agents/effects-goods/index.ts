// The GOODS effects of the atomic executor — harvest/fell/deplete a resource node, drop and reap
// ground piles, pick up / consume / deposit a carried load. Every mutation conserves goods (nothing
// is conjured or silently destroyed); see each function's contract. Split by concern into this folder;
// import the barrel, not the leaves.

export { addCarry, dropCarriedLoad, dropCarryAtOwnTile } from './carry.js';
export { consumeFood, forageBerry } from './consume.js';
export { beginRestTail, continuesHarvest, endRestTail, harvestFromNode } from './harvest.js';
export { dropOrStackGood } from './piles.js';
export { pickupFromStore, pileupIntoStore } from './transfer.js';
