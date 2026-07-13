import {
  Building,
  Health,
  JobAssignment,
  Position,
  Settler,
  Stockpile,
  stampOwner,
  UnderConstruction,
  Vehicle,
} from '../../components/index.js';
import type { Command } from '../../core/commands.js';
import { contentIndex } from '../../core/content-index.js';
import { fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { canPlaceBuilding } from '../footprint/index.js';
import { buildingEnabled, tribeShipsUnlocked } from '../progression/index.js';

/**
 * Release every settler bound to `building` ({@link JobAssignment}) before it is destroyed: drop the
 * binding and reset the settler to idle (`jobType = null`). Without this, a demolished workplace would
 * strand its operators — the binding would dangle on a dead entity (the AI/JobSystem consumers only
 * *defend* against a stale binding, none *clears* it), so the worker would neither produce (its
 * workplace is gone) nor be re-employable (it still looks employed-and-bound to the JobSystem). Faithful
 * to the original: pulling down a building turns its workers back into job-seekers.
 *
 * Determinism: a `query(Settler, JobAssignment)` scan that only *mutates the matched settlers* (drops
 * the binding, resets the job) — order-independent, no chosen-entity pick, so iterating store order is
 * permitted (AGENTS.md: only a scan whose result depends on *which* entity wins needs the canonical
 * order). The matches are collected before mutating because `world.remove` deletes from the
 * `JobAssignment` store, which `world.query` may be iterating — snapshot first, then mutate.
 */
export function unbindWorkersOf(world: World, building: Entity): void {
  const bound: Entity[] = [];
  for (const e of world.query(Settler, JobAssignment)) {
    if (world.get(e, JobAssignment).workplace === building) bound.push(e);
  }
  for (const e of bound) {
    world.remove(e, JobAssignment);
    world.get(e, Settler).jobType = null; // back to idle — the JobSystem re-assigns it next tick
  }
}

export function placeBuilding(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeBuilding' }>,
): void {
  const type = contentIndex(ctx.content).commandBuildings.get(command.buildingType);
  if (type === undefined) return; // unknown building type — skip (recoverable bad input)

  // `force` (map-authored imports + pinned demo fixtures) skips BOTH gates below: the original loads
  // a decoded map's houses verbatim — it never re-validates authored state against the interactive
  // placement rule (source basis: observed original behavior — scenario maps open with houses that
  // the free-placement rule would reject, e.g. packed villages).
  if (command.force !== true) {
    // Tech-graph gate: a house may be locked until a settler of an enabling job exists in the tribe
    // (`jobEnablesHouse`). A gated-out placement is a recoverable boundary failure (a stale/illegal UI
    // command), so it is skipped here but still recorded by commandSystem — replay stays faithful.
    if (!buildingEnabled(world, ctx, command.tribe, command.buildingType)) return;

    // Ground-collision gate — the original's FREE placement rule: the type's footprint must fit here
    // (its reserved zone on buildable ground, clear of resource nodes, its walls and every existing
    // building's walls outside each other's zones — see {@link canPlaceBuilding}). A placement that
    // doesn't fit is the same recoverable boundary failure as a tech-gated one: skipped, still logged.
    // A mapless sim (no terrain) or a footprint-less type (synthetic content) validates trivially.
    if (
      ctx.terrain !== undefined &&
      !canPlaceBuilding(world, ctx, ctx.terrain, command.buildingType, command.x, command.y)
    ) {
      return;
    }
  }

  const e = world.create();
  // The anchor is a half-cell node; its Position is the node's fractional tile coords (the render
  // projects Positions, so the building draws exactly on its authored half-cell).
  world.add(e, Position, positionOfNode(command.x, command.y));
  // `underConstruction` starts the building at built=0 — the ConstructionSystem advances it to ONE once
  // its `construction` material cost is delivered into its stockpile. Omitted (the default) places it
  // already built (the slice / golden path). An under-construction site begins with an EMPTY hold (it
  // accumulates delivered materials); a finished placement is seeded from the type's stock `initial`s so
  // a headquarters arrives with its starting goods — exactly as the tests construct one by hand.
  const built = command.underConstruction ? fx.fromInt(0) : ONE;
  world.add(e, Building, { buildingType: command.buildingType, tribe: command.tribe, built, level: 0 });
  const amounts = new Map<number, number>();
  if (command.underConstruction) {
    // A construction site: the builder-work marker (starts at 0 labor — a bare grey foundation) plus,
    // when the type has a hitpoints pool, a Health pool the ConstructionSystem ramps up as it rises
    // (stamped at 1 so the foundation is never a 0-HP corpse the CleanupSystem reaps). A type with no
    // extracted `hitpoints` (synthetic content) carries no Health — it still builds, just without a life
    // pool. Only an under-construction placement gets these; an already-built placement (the golden /
    // vertical-slice path) is a plain Building, hash untouched.
    world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
    if (type.hitpoints !== undefined) world.add(e, Health, { hitpoints: 1, max: type.hitpoints });
  } else {
    for (const slot of type.stock) {
      if (slot.initial > 0) amounts.set(slot.goodType, slot.initial);
    }
  }
  world.add(e, Stockpile, { amounts });
  // A building placed for a specific PLAYER carries an `Owner` (the separate-optional stamp): it is
  // that player's to select/command. Omitted / out-of-range leaves it neutral (golden path).
  stampOwner(world, e, command.owner);
  ctx.events.emit({ kind: 'buildingPlaced', entity: e, at: { x: command.x, y: command.y } });
}

/**
 * Place a **boat hull** — the boat analogue of {@link placeBuilding}: it creates a {@link Vehicle} hull
 * at (x,y) carrying an empty {@link Stockpile} (the "boats as mobile stores" entity the Sea/Northland
 * plan item names — a ship is a movable stockpile, its capacity being the ship type's `stockSlots`).
 *
 * The placement is gated by the tribe's **ship-unlock tech graph** ({@link tribeShipsUnlocked}): only a
 * `vehicleType` that is a ship the tribe has currently UNLOCKED (a `vehicle_ship` row — `passengerSlots > 0`
 * — whose `jobEnablesVehicle` edge is satisfied) is placed. A cart, a catapult, an unknown id, or a
 * not-yet-unlocked ship is a recoverable bad command — skipped (still recorded by commandSystem so replay
 * stays faithful), exactly the tech-gated-`placeBuilding` stance. Unlike a building the hull is seeded with
 * an **empty** hold: a boat is loaded by hauling cargo to it (applying the `cargoGoods` filter — a deferred
 * load slice), not pre-stocked with starting goods.
 *
 * source-basis: pinned to the extracted vehicle IR on both axes the entity reads — the ship/cart split is the
 * `passengerslots` param (`shipVehicles`/`isShipVehicle`) and the unlock is the `jobEnablesVehicle` edge
 * ({@link tribeShipsUnlocked}). The hull is a *static* placed store here: movement, passenger embark/disembark, the
 * cargo-load filter, and water-valency terrain (which cells it floats on) are deferred follow-ups
 * (source basis "Sea/Northland — boat hull entity"). Determinism: a pure read of the unlocked-ship set
 * (a filtered/sorted content scan + an order-independent live-settler membership query) then a single
 * `create()`; no RNG, no wall-clock.
 */
export function placeBoat(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeBoat' }>,
): void {
  // Only an UNLOCKED ship of this tribe may be fielded. tribeShipsUnlocked already excludes carts /
  // catapults (not ships), unknown ids, and ships behind an unmet tech edge — so a `vehicleType` absent
  // from it is bad input (a stale/illegal command), skipped here but still logged for faithful replay.
  const unlocked = tribeShipsUnlocked(world, ctx, command.tribe);
  if (!unlocked.some((v) => v.typeId === command.vehicleType)) return;

  const e = world.create();
  world.add(e, Position, positionOfNode(command.x, command.y));
  world.add(e, Vehicle, { vehicleType: command.vehicleType, tribe: command.tribe });
  // A hull placed for a specific PLAYER carries an `Owner` (the separate-optional stamp). Omitted /
  // out-of-range leaves it neutral (golden path).
  stampOwner(world, e, command.owner);
  // A hull arrives EMPTY — a boat-as-mobile-store is filled by hauling cargo to it (the `cargoGoods`
  // load filter, a deferred slice), not pre-seeded with starting goods like a headquarters. Its hold
  // CAPACITY is the ship type's `stockSlots` (read off the VehicleType, like `largestShipCapacity`).
  world.add(e, Stockpile, { amounts: new Map<number, number>() });
  ctx.events.emit({ kind: 'boatPlaced', entity: e, at: { x: command.x, y: command.y } });
}
