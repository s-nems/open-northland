/**
 * `.bmd` graphics stage — the settler/animal/vehicle/house/landscape bob atlases. Split by concern:
 *   - {@link ./bindings} — resolving the `.bmd`→palette pairing from the graphics-binding sources
 *     (`resolveGraphicsBindings`, `jobBaseGraphicsToBindings`).
 *   - {@link ./convert} — turning each `(bmd, palette)` binding into a packed atlas PNG + manifest
 *     (`convertBmdTree`, `bmdToAtlas`, `indexOutTree`).
 * Importers keep the `stages/bmd/index.js` specifier; convert only type-imports bindings'
 * `GraphicsBindingSet` (erased at build — no runtime cross-import).
 */

export * from './bindings.js';
export * from './convert.js';
