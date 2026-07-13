/**
 * The sandbox content's semantic id space, grouped by the domain each id names. Consumers import this
 * barrel so one sandbox `typeId` still has one canonical name without accumulating every catalog in a
 * single module.
 */

export * from './buildings.js';
export * from './economy/gatherers.js';
export * from './economy/goods.js';
export * from './economy/jobs.js';
export * from './weapons.js';
