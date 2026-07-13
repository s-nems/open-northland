/**
 * `map.dat` decoder — the Cultures engine's `hoix`-chunk file (the sibling of `map.cif` that carries
 * the binary per-cell landscape grid + entity/object map; `map.cif` is only the logic-header
 * `CStringArray`).
 *
 * Split by concern: the chunk {@link container} walk + `lsiz` dims, the packed grid {@link layers}
 * (`X8el` bytes / `X6el` u16 RLE), the half-cell {@link terrain} reduction, and the name
 * {@link dictionary} chunks. Import from this barrel (`decoders/mapdat/index.js`); the files inside
 * import each other directly.
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI wires file reads around them.
 */

export * from './container.js';
export * from './dictionary.js';
export * from './layers.js';
export * from './terrain.js';
