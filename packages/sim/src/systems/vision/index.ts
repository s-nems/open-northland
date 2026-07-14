/**
 * The VISION / fog-of-war layer — per-PLAYER visibility masks over the map's CELL grid, driven by the
 * {@link import('../../components/rules.js').FOG_MODE} the `setFogMode` command selects (default OFF:
 * an untouched world computes nothing and behaves exactly as before the feature — every golden holds).
 *
 * Design (OUR design — the original's exploration is observed behaviour, no readable fog source):
 *  - **Per player** ({@link import('../../components/ownership.js').Owner.player}), never per tribe:
 *    two players fielding vikings must not share eyes. Only OWNED entities see; wildlife/neutral
 *    fixtures reveal nothing (user decision 2026-07-11).
 *  - **Cell resolution** (`W×H` visual cells, the half-cell lattice's `2W×2H` quartered): visibility
 *    is a coarse area effect, the render consumes per-cell lanes, and a cell mask is 4× smaller than a
 *    node mask on a 1024² map. Node queries quarter their coords ({@link cellOfNode}).
 *  - **Tri-state byte per cell** ({@link FOG_STATE}): UNEXPLORED (black), EXPLORED (terrain-only grey),
 *    VISIBLE (everything shows). REVEAL never downgrades (the original's sticky exploration); RECON
 *    drops VISIBLE back to EXPLORED each rebuild and additionally *renders* UNEXPLORED as EXPLORED
 *    (the raw mask stays tri-state so switching modes mid-game keeps the explored history).
 *  - **Cadence rebuild** ({@link VISION_CADENCE_TICKS}): the masks are recomputed every few ticks (and
 *    on a mode change), not per tick — a fog a few ticks stale is imperceptible, and the rebuild cost
 *    (owned entities × vision area) amortizes to well under the movement system's budget (golden rule
 *    6: cost scales with active work — a world with no owned entities, or fog OFF, pays ~0).
 *
 * The masks live OUTSIDE the ECS ({@link FogState}, a `Simulation`-owned resource like the terrain
 * graph): a dense per-player byte grid inside a component would be deep-cloned per snapshot and walked
 * per `hashState` object-hash — pathological at map scale. They are still simulated STATE (combat
 * decisions read them), so `Simulation.hashState` mixes the raw bytes in after the components, and the
 * whole layer replays from the command log (mode changes are commands; the rebuild is a pure function
 * of tick + positions). Determinism: fixed integer ellipse math, canonical (ascending-player) mask
 * iteration, no RNG/wall-clock.
 */

export * from './gates.js';
export * from './state.js';
export * from './system.js';
