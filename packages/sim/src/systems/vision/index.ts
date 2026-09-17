/**
 * The vision and fog-of-war layer: visibility masks over the cell grid, one per vision group (a
 * player, or the players a lobby team shares one with), driven by the `FOG_MODE` the `setFogMode`
 * command selects. Approximation: the original's exploration is observed behaviour, with no readable
 * fog source.
 *
 * Masks are per player or team, never per tribe, and only owned entities see, so wildlife and neutral
 * fixtures reveal nothing. The masks sit outside the ECS because a dense byte grid inside a component
 * would be deep-cloned per snapshot and walked per `hashState` object-hash.
 */

export * from './gates.js';
export * from './state.js';
export * from './system.js';
