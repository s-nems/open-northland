/**
 * Graphics bindings extracted from the `.ini`/`.cif` graphics rules — the `.bmd`→palette pairings and
 * animation frame layouts the atlas/render stages join onto the logic IR. Split by binding domain:
 * {@link palette} aliases, {@link job} human/creature bindings, {@link landscape} object bindings, and
 * {@link animation} frame lists. Import from this barrel (`decoders/ini/bindings/index.js`).
 */

export * from './animation.js';
export * from './bmd-palette.js';
export * from './job.js';
export * from './landscape.js';
export * from './palette.js';
