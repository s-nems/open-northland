import type { Fixed } from '../core/fixed.js';
import { defineComponent } from '../ecs/world.js';

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
 * (history-dependent) and is a determinism footgun (see CLAUDE.md anti-patterns).
 */
export const Stockpile = defineComponent<{ amounts: Map<number, number> }>('Stockpile');

/** Canonical (ascending goodType) view of a stockpile. Always use this for game logic. */
export function stockpileEntries(s: { amounts: Map<number, number> }): Array<[number, number]> {
  return [...s.amounts.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * A **placed vehicle hull** — the "boats as mobile stores" entity the ROADMAP Phase-4 Sea/Northland
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

/**
 * A harvestable resource node placed in the world (a tree, ore vein, berry bush). It yields its
 * `goodType` when a settler runs the good's harvest atomic on its cell; `remaining` is the units
 * left — each completed harvest decrements it (AtomicSystem's harvest effect), so a finite node
 * empties and the planner's `remaining <= 0` gate then skips it. `harvestAtomic` is the
 * numeric atomic id to run (the good's `atomicForHarvesting`), kept so the planner stays data-driven
 * — it picks the atomic from content, never hardcodes one. A node sits on the cell under its
 * {@link Position} (snapped to a cell by `cellAtClamped`).
 */
export const Resource = defineComponent<{
  goodType: number;
  remaining: number;
  harvestAtomic: number;
}>('Resource');

/**
 * An in-progress production cycle on a workplace (a {@link Building} whose building type carries a
 * `recipe`). The ProductionSystem consumes the recipe's input goods from the building's own
 * {@link Stockpile} when a cycle starts, advances the integer `elapsed` tick counter, and on the
 * `recipe.ticks`-th tick deposits the output goods (capped at the building type's per-good capacity,
 * with room reserved at start so they always fit). The component exists only while a cycle is
 * running — its absence means the workplace is idle/ready to start the next cycle.
 *
 * Timing is the exact integer compare `elapsed >= duration` (like {@link CurrentAtomic}) — never an
 * accumulated fixed-point step, which would truncate and hang. `duration` mirrors the recipe's
 * `ticks` (snapshotted so a content edit mid-cycle can't change an in-flight cycle's length).
 */
export const Production = defineComponent<{
  /** Whole ticks elapsed in the current cycle; completion is the exact `elapsed >= duration`. */
  elapsed: number;
  /** Ticks one cycle takes (the recipe's `ticks`, snapshotted at cycle start; >= 1). */
  duration: number;
}>('Production');
