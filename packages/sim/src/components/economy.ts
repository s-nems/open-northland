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
 * Marks a {@link Resource} node that is **felled**, not gathered unit-by-unit — a tree the collector
 * chops down over several swings, faithful to the original's `tree → "tree falling" → trunk` lifecycle
 * (`landscapetypes.ini`; the good's `chopsToFell`/`yieldPerNode` gathering params). Present only on a
 * fellable node (the sim stamps it at spawn iff the good declares `chopsToFell > 0`); a single-hit node
 * (stone/clay, Step 4) carries no `Felling` and keeps the one-unit-per-swing behaviour. This is the
 * **separate-component pattern** the codebase uses for opt-in behaviour ({@link Vehicle}, `Health`,
 * `Owner`): a node without it hashes and plans exactly as before, so the goldens/scenes that place
 * plain resources are untouched.
 *
 * `chopsLeft` counts the chops still needed to fell the node — each completed harvest atomic decrements
 * it (yielding NOTHING onto the settler's back, unlike a single-hit gather), and the node falls when it
 * reaches 0: the standing node is destroyed (so the planner never sees a depleted stump-to-be again) and
 * its whole `Resource.remaining` yield drops at its cell as a bare {@link Stockpile} trunk pile (a
 * {@link GroundDrop}) the collector then carries off. Determinism: a plain integer counter, mutated only
 * by the AtomicSystem's harvest effect in the store's deterministic order.
 */
export const Felling = defineComponent<{ chopsLeft: number }>('Felling');

/**
 * A **stump / debris** decor entity left where a {@link Felling} node fell — the tree-debris the
 * original leaves behind (`ls_trees_dead.bmd` "tree debris", `landscapetype` logic 1: a pure-decor
 * landscape, non-blocking and not harvestable). It carries only a {@link Position} and this marker, so
 * it draws (the render side keys a per-good debris frame off `goodType`) but takes part in no sim
 * decision — the planner's resource/stockpile/building scans never see it. `goodType` records which
 * resource it is the remains of (a chopped tree → wood), so a future per-good decor binding can pick
 * the right debris. Inert on every golden that fells nothing (the separate-component pattern).
 */
export const Stump = defineComponent<{ goodType: number }>('Stump');

/**
 * Marks a bare {@link Stockpile} that is a **dropped resource pile** — the trunk a felled {@link Felling}
 * node leaves on the ground (Step 4 reuses it for a mined good's per-unit ground drops). It rides ON TOP
 * of the plain `Stockpile + Position` shape the existing ground-pile machinery already handles
 * (`nearestGroundPile`, the porter drive), so pickup/delivery consume it unchanged; the marker adds two
 * things a *designated* delivery flag (an equally-bare `Stockpile`) must NOT get: (1) it is the target a
 * felling collector's own collect-trunk drive prefers, and (2) it is **auto-reaped when emptied** (a
 * collected trunk vanishes, unlike a persistent flag), so a long game doesn't accrete an empty pile per
 * felled tree. A pure marker (`goodType` for legibility/debug); its presence is what the sim keys on.
 */
export const GroundDrop = defineComponent<{ goodType: number }>('GroundDrop');

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
