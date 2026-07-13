/**
 * Intermediate-representation (IR) schemas — the single source of truth for the content model.
 * These produce both runtime validation and inferred TypeScript types. Every object schema is strict:
 * unknown keys fail at the loader boundary instead of being silently stripped.
 *
 * See docs/DATA-FORMAT.md for how these map onto the original .ini/.cif fields.
 */
export * from './actors/index.js';
export * from './audio/index.js';
export * from './content/index.js';
export * from './economy/index.js';
export * from './graphics/index.js';
export * from './landscape/index.js';
export * from './maps/index.js';
// `ClassId` stays internal to the schema (only `equipment.ts` uses it) — it is not a resolvable
// cross-reference, so the public surface exposes only the id primitives callers actually index by.
export { AtomicId, Provenance, TypeId } from './record.js';
