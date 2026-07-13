/**
 * The real decoded {@link import('@vinland/render').SpriteSheet} assembly — the byte-loading half of the
 * settler/building/resource render bindings (the pure reducers live in `settler-gfx/`, `building-gfx/`,
 * `resource-gfx/`). Split by concern: the per-job character-set load ({@link import('./characters.js')}),
 * the whole-sheet assembler ({@link import('./human-sheet.js')}), and the `?atlas`-flag resolution +
 * synthetic fallback ({@link import('./resolve.js')}).
 */
export { loadHumanSpriteSheet } from './human-sheet.js';
export { resolveSpriteSheet, syntheticSpriteSheet } from './resolve.js';
