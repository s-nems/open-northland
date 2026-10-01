/**
 * The vision and fog-of-war layer: visibility masks over the cell grid, one per vision group (a
 * player, or the players a lobby team shares one with), driven by the `FOG_MODE` the `setFogMode`
 * command selects. Original behavior: exploration is sticky and each eye has a fixed radius; the fog of
 * war modes, which lower unwatched ground back to explored, are authored.
 *
 * Masks are per player or team, never per tribe, and only owned entities see, so wildlife and neutral
 * fixtures reveal nothing. The masks sit outside the ECS because a dense byte grid inside a component
 * would be deep-cloned per snapshot and walked per `hashState` object-hash.
 */

export * from './gates.js';
export * from './state.js';
export * from './system.js';
