/**
 * The vision / fog-of-war layer — per-player visibility masks over the cell grid, driven by the
 * {@link import('../../components/rules.js').FOG_MODE} the `setFogMode` command selects. Our design: the
 * original's exploration is observed behaviour, with no readable fog source.
 *
 * The decisions that have no other home. Masks are per PLAYER, never per tribe — two players fielding
 * vikings must not share eyes — and only owned entities see, so wildlife and neutral fixtures reveal
 * nothing (user decision). Resolution is the visual cell, not the half-cell node: visibility is a coarse
 * area effect the render consumes per cell, and a cell mask is 4x smaller on a 1024² map. The masks sit
 * outside the ECS because a dense per-player byte grid inside a component would be deep-cloned per
 * snapshot and walked per `hashState` object-hash — pathological at map scale.
 *
 * The rules live with the code that owns them: {@link FOG_STATE} and {@link FogState} (state.ts), the
 * rebuild cadence and the REVEAL/RECON update rules (system.ts), the node→cell lane convention and
 * RECON's view mapping (gates.ts).
 */

export * from './gates.js';
export * from './state.js';
export * from './system.js';
