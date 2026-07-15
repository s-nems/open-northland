/**
 * Snapshot projections — the pure reads that turn a frozen `WorldSnapshot` into the per-frame data
 * the renderer and HUD consume (worker door badges, building anchor points, the fog gate, geometry
 * debug items, localized HUD labels). No DOM, no Pixi; the interactive glue lives one level up.
 */
export * from './building-points.js';
export * from './door-badges.js';
export * from './fog-gates.js';
export * from './geometry-debug-items.js';
export * from './hud-labels.js';
export * from './snapshot-projections.js';
