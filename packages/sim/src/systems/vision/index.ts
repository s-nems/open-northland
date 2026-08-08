/**
 * The vision and fog-of-war layer: per-player visibility masks over the cell grid, driven by the `FOG_MODE`
 * the `setFogMode` command selects. Approximation: the original's exploration is observed behaviour, with no
 * readable fog source.
 *
 * Masks are per player, never per tribe, and only owned entities see, so wildlife and neutral fixtures
 * reveal nothing. The masks sit outside the ECS because a dense per-player byte grid inside a component
 * would be deep-cloned per snapshot and walked per `hashState` object-hash.
 */

export * from './gates.js';
export * from './state.js';
export * from './system.js';
