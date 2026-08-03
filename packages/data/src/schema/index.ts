/**
 * Intermediate-representation schemas: the content model's runtime validation and inferred types.
 * Every object schema is strict, so unknown keys fail at the loader boundary instead of being
 * stripped. docs/DATA-FORMAT.md maps them onto the original `.ini`/`.cif` fields.
 */
export * from './actors/index.js';
export * from './audio/index.js';
export * from './content/index.js';
export * from './economy/index.js';
export * from './graphics/index.js';
export * from './landscape/index.js';
export * from './maps/index.js';
// The id primitives (`TypeId`/`AtomicId`/`ClassId`) stay internal: they all infer to bare `number`.
// `Provenance` is exported because it has a shape.
export { Provenance } from './record.js';
