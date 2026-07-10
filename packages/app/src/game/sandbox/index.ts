/**
 * The global sandbox package barrel: semantic ids + the gatherer table (`ids.ts`), the one
 * {@link import('./content.js').sandboxContent} `ContentSet` (`content.ts`), and the world-population
 * helpers (`place.ts`). Scene-check queries live beside the scenes (`scenes/sandbox-queries.ts`).
 */
export * from './ids.js';
export * from './content.js';
export * from './place.js';
export * from './worker-roles.js';
