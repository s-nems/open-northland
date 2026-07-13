import type { Fixed } from '../../core/fixed.js';
import { defineComponent } from '../../ecs/world.js';

/** A building instance placed in the world. */
export const Building = defineComponent<{
  buildingType: number;
  tribe: number;
  built: Fixed; // 0..ONE construction progress
  level: number; // houses level up (home level 00..04 -> population capacity)
}>('Building');

/**
 * A goods store attached to a building: goodType -> amount, with per-good capacity from the
 * building type. DETERMINISM: never iterate this Map directly for game decisions — use
 * stockpileEntries() which returns ascending-goodType order. Raw Map iteration is insertion-order
 * (history-dependent) and is a determinism footgun (see AGENTS.md anti-patterns).
 */
export const Stockpile = defineComponent<{ amounts: Map<number, number> }>('Stockpile');

/** Canonical (ascending goodType) view of a stockpile. Always use this for game logic. */
export function stockpileEntries(s: { amounts: Map<number, number> }): Array<[number, number]> {
  return [...s.amounts.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Marks a {@link Building} that is a **construction site** — a placed foundation a builder still has to
 * raise, faithful to the original's "place the grey outline, then settlers build it up" flow (you don't
 * drop a finished house; you drop its footprint, which already collides, and builders carry material +
 * hammer it up). It rides ON TOP of the plain `Building + Stockpile` shape (the site's stockpile is the
 * delivered-material hold), and it is the **separate optional component** the codebase uses for opt-in
 * behaviour ({@link Vehicle}, `Health`, {@link import('./settler.js').JobAssignment}): a building placed
 * already-built (the golden / vertical-slice path) never carries it, so its hash is untouched and the
 * ConstructionSystem's build branch stays inert on those.
 *
 * `labor` is the builder-WORK progress, 0..ONE — the fraction of hammering done, advanced by the
 * `construct` atomic (a swing is one hammer STRIKE: `+ONE/(totalUnits·strikesPerUnit)`, a small step, so a
 * site rises over many strikes whose count scales with its size — see `advanceConstructionLabor`). It is
 * DISTINCT from delivered material: the visible `Building.built` the render/HP read is
 * `min(labor, deliveredFraction)` — the two independent gates the ConstructionSystem ANDs, so a site
 * only rises as fast as BOTH the builder hammers AND material arrives (deliver 3 of 10 units → build
 * caps at 30% until more lands; hammer 0 swings → build stays at the grey foundation however much
 * material sits on it). The component is REMOVED the instant construction finishes (`built = ONE`), so a
 * finished building is a plain `Building` again — exactly the {@link import('./settler.js').Age} grow-up
 * pattern. Determinism: a single fixed-point counter, advanced by a fixed per-swing quantum in the
 * AtomicSystem's deterministic order.
 *
 * source-basis: the site-then-build flow and the material cost (`construction`, extracted
 * `LogicConstructionGoods`) are faithful; the builder-driven *pace* (several strikes per unit) is our named
 * approximation — the original has no sim oracle for construction speed (see AGENTS.md).
 */
export const UnderConstruction = defineComponent<{ labor: Fixed }>('UnderConstruction');

/**
 * A **placed vehicle hull** — the "boats as mobile stores" entity the historical plan phase-4 Sea/Northland
 * item names: a ship put on the map as a movable stockpile rather than a static building. `vehicleType`
 * cross-references the `VehicleType.typeId` (its `stockSlots` hold capacity, `cargoGoods`
 * load-filter, `passengerSlots`), and `tribe` is its owner — the same `(type, tribe)` shape a
 * {@link Building} carries, so a hull hashes and is queried exactly like a building. A hull is the
 * boat analogue of `Building`: it owns a {@link Stockpile} (the mobile store) the same way a
 * headquarters does, but it can later move and ferry passengers (embark/disembark atomics — a deferred
 * slice). Only an **unlocked** ship type is ever stamped (the CommandSystem `placeBoat` handler gates
 * on `tribeShipsUnlocked`), so a `Vehicle` always references a ship the owning tribe may field.
 *
 * Determinism: plain integer `vehicleType`/`tribe` (no fixed-point — they are cross-reference ids, not
 * positions), so it hashes like every other component. The golden/vertical-slice carries no hull, so
 * adding this component leaves the golden hash untouched (the separate-component pattern).
 */
export const Vehicle = defineComponent<{ vehicleType: number; tribe: number }>('Vehicle');
