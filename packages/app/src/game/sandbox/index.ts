/**
 * The global sandbox package barrel: semantic ids + the gatherer table (`ids.ts`), the one
 * {@link import('./content.js').sandboxContent} `ContentSet` (`content.ts`) and the per-concern tables
 * it assembles from — combat weapons/timings (`combat.ts`), non-combat work-animation timings
 * (`work-animations.ts`), the terrain/resource landscape derivation (`landscape.ts`), the building
 * store/recipe set (`building-set.ts`) — plus the world-population helpers (`place.ts`). Scene-check
 * queries live beside the scenes (`scenes/sandbox-queries.ts`).
 */

export * from './building-set.js';
export * from './combat.js';
export * from './content.js';
export * from './ids.js';
export * from './landscape.js';
export * from './place.js';
export * from './work-animations.js';
export * from './worker-roles.js';
