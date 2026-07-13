/**
 * `.bmd` "bob" container decoder — CBobManager (storable id 0x3F4). Split by concern:
 *   - {@link ./container} — the container parse/serialize (`decodeBmd`/`encodeBmd`, records, header).
 *   - {@link ./frame} — the packed-line RLE codec (`decodeBobFrame`, `BobFrame`).
 * Importers keep the `decoders/bmd/index.js` specifier; the two files import each other directly.
 */

export * from './container.js';
export * from './frame.js';
