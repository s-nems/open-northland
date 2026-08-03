/**
 * The real decoded {@link import('@open-northland/render').SpriteSheet} assembly - the byte-loading half of
 * the settler/building/resource render bindings, whose pure reducers live in `settler-gfx/`,
 * `building-gfx/` and `resource-gfx/`.
 */
export { loadHumanSpriteSheet } from './human-sheet.js';
export { resolveSpriteSheet, syntheticSpriteSheet } from './resolve.js';
