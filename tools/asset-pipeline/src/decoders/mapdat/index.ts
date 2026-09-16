/**
 * `map.dat` decoder: the `hoix`-chunk sibling of `map.cif` carrying the binary landscape grids and
 * placed objects, where `map.cif` holds only the logic-header `CStringArray`.
 *
 * Pure functions only, no I/O: the CLI wires file reads around them.
 */

export * from './container.js';
export * from './dictionary.js';
export * from './fish.js';
export * from './layers.js';
export * from './terrain.js';
