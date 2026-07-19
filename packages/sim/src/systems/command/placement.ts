import {
  Building,
  Health,
  JobAssignment,
  Position,
  Settler,
  Stockpile,
  stampOwner,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import { fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { destroyBerryBushesInReserved } from '../economy/berries.js';
import { evictWorkFlagsFromFootprint } from '../economy/flags.js';
import { destroyStumpsInReserved } from '../economy/stumps.js';
import { canPlaceBuilding } from '../footprint/index.js';
import { evictSettlersFromFootprint } from '../movement/evict.js';
import { buildingEnabled, tribeShipsUnlocked } from '../progression/index.js';
import { upgradeTierOf } from '../stores/index.js';

/**
 * Release every settler bound to `building` ({@link JobAssignment}) before it is destroyed: drop the binding
 * and reset the settler to idle (`jobType = null`). Without this a demolished workplace would strand its
 * operators — the binding would dangle on a dead entity (the AI/JobSystem consumers only defend against a
 * stale binding, none clears it), so the worker would neither produce nor be re-employable. Faithful to the
 * original: pulling down a building turns its workers back into job-seekers.
 *
 * The scan only mutates the matched settlers (no chosen-entity pick), so iterating store order is permitted.
 * Matches are collected before mutating because `world.remove` deletes from the `JobAssignment` store that
 * `world.query` may be iterating — snapshot first, then mutate.
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

  // `force` (map-authored imports + pinned demo fixtures) skips both gates below: the original loads a decoded
  // map's houses verbatim, never re-validating authored state against the interactive placement rule (source
  // basis: observed original behavior — scenario maps open with houses free-placement would reject, e.g.
  // packed villages). A gated-out placement below is recoverable bad input: skipped, still logged for replay.
  if (command.force !== true) {
    // Tech-unlock gate: a house may be locked until a settler of an enabling job exists in the tribe
    // (`jobEnablesHouse`). Currently a no-op — the gate is disabled feature-wide (see {@link buildingEnabled});
    // the call stays so re-enabling the switch restores placement gating with no code move.
    if (!buildingEnabled(world, ctx, command.tribe, command.buildingType)) return;

    // Ground-collision gate — the original's free placement rule: the type's footprint must fit here (its
    // reserved zone on buildable ground, clear of resource nodes, its walls and every existing building's walls
    // outside each other's zones — see {@link canPlaceBuilding}). A mapless sim (no terrain) or a
    // footprint-less type (synthetic content) validates trivially.
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
  // `underConstruction` starts the building at built=0 — the ConstructionSystem advances it to ONE once its
  // `construction` material cost is delivered into its stockpile. Omitted (the default) places it already
  // built. An under-construction site begins with an empty hold (it accumulates delivered materials); a
  // finished placement is seeded from the type's stock `initial`s so a headquarters arrives with its goods.
  const built = command.underConstruction ? fx.fromInt(0) : ONE;
  world.add(e, Building, { buildingType: command.buildingType, tribe: command.tribe, built, level: 0 });
  const amounts = new Map<number, number>();
  if (command.underConstruction) {
    // A construction site: the builder-work marker (starts at 0 labor) plus, when the type has a hitpoints
    // pool, a Health pool the ConstructionSystem ramps up as it rises (stamped at 1 so the foundation is never
    // a 0-HP corpse the CleanupSystem reaps). A type with no extracted `hitpoints` (synthetic content) carries
    // no Health — it still builds, just without a life pool.
    world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
    if (type.hitpoints !== undefined) world.add(e, Health, { hitpoints: 1, max: type.hitpoints });
  } else if (command.fillStock) {
    // An authored pre-stocked placement (a scene's full warehouse): every stock slot at capacity.
    for (const slot of type.stock) amounts.set(slot.goodType, slot.capacity);
  } else {
    for (const slot of type.stock) {
      if (slot.initial > 0) amounts.set(slot.goodType, slot.initial);
    }
  }
  if (!command.underConstruction) {
    // Authored starting stock (a decoded map's `addgoods`) adds on top of the seeding above,
    // unclamped (Walhalla authors 1000 iron into a 45-capacity barn) and not limited to the type's
    // declared slots. Named approximation: additive-vs-replace is unobserved in the original; additive
    // is the guess (the verb is "add goods"), and it diverges from replace only by a slot's extracted
    // 1-unit `initial` where a map stocks a slot that seeds itself (e.g. the tutorials' bakery water).
    for (const g of command.initialGoods ?? []) {
      if (g.amount > 0) amounts.set(g.good, (amounts.get(g.good) ?? 0) + g.amount);
    }
    // A placed-built building arrives at full life so it can be besieged (an under-construction site
    // instead gets its ramping Health above). A type with no extracted `hitpoints` (synthetic content)
    // carries no Health and cannot be attacked — the same rule the construction ramp already followed.
    if (type.hitpoints !== undefined)
      world.add(e, Health, { hitpoints: type.hitpoints, max: type.hitpoints });
  }
  world.add(e, Stockpile, { amounts });
  // A building placed for a specific player carries an `Owner` — that player's to select/command. Omitted /
  // out-of-range leaves it neutral.
  stampOwner(world, e, command.owner);
  // The plot is impassable from this tick — settlers standing on it step aside instead of being walled in,
  // and a work flag already planted there is pushed to the nearest legal field (the placement gates ignore
  // flags, so a house may legally land on one).
  evictSettlersFromFootprint(world, ctx, e);
  evictWorkFlagsFromFootprint(world, ctx, e);
  // Bushes and felled-tree stumps are walkable and not a placement obstacle, so the plot may cover them —
  // raze both (the original clears landscape decoration in a building's reserved zone).
  destroyBerryBushesInReserved(world, ctx, e);
  destroyStumpsInReserved(world, ctx, e);
  ctx.events.emit({ kind: 'buildingPlaced', entity: e, at: { hx: command.x, hy: command.y } });
}

/**
 * Begin upgrading a built building into its type's `upgradeTarget` level — the `upgradeBuilding`
 * command's effect. The building re-opens as a construction site: its inventory is stashed into the
 * {@link Upgrading} marker and the emptied {@link Stockpile} becomes the site's separate build hold,
 * `built` drops to 0 (suspending production/housing — the same gates a from-scratch site sits behind),
 * an {@link UnderConstruction} marker starts the builder-work clock, and settlers standing on the
 * footprint are pushed out. Deliberately NOT cleared: {@link JobAssignment}s and residences — the
 * occupants leave the building but keep their bindings and return when the upgrade completes
 * (source basis: observed original behavior). An in-flight {@link Production} cycle is also left to
 * run out — operators pause it by stepping off the door, and a batch that still completes deposits
 * into the (now build-hold) stockpile (goods-conserving; named approximation, the original's
 * mid-upgrade batch behavior is unobserved).
 *
 * Skip conditions (recoverable bad input, still logged): a dead / non-building target, one still under
 * construction (or already upgrading), a stockpile-less building (a bare fixture — its {@link Stockpile}
 * is the site's build hold, and the ConstructionSystem only advances `(Building, Stockpile)` sites), a
 * type with no `upgradeTarget` (top level / unchained), a target absent from content, or a target the
 * tribe has not tech-unlocked ({@link buildingEnabled} — the same gate as direct placement, so the
 * upgrade path can't unlock what placement forbids; our design invariant, the original's upgrade gating
 * is unobserved).
 */
export function upgradeBuilding(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'upgradeBuilding' }>,
): void {
  const building = world.tryGet(command.building, Building);
  if (building === undefined || building.built < ONE) return; // not a built building
  if (world.has(command.building, UnderConstruction)) return; // already a site
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  const target = type === undefined ? undefined : upgradeTierOf(type, ctx);
  if (target === undefined) return; // top level / unchained / malformed content
  if (!buildingEnabled(world, ctx, building.tribe, target.typeId)) return; // target not tech-unlocked

  const stock = world.tryGet(command.building, Stockpile);
  if (stock === undefined) return; // no build hold — the site could never advance (see the doc)
  world.add(command.building, Upgrading, { savedStock: stock.amounts });
  stock.amounts = new Map<number, number>();
  world.touchComponent(Stockpile); // an in-place empty — log it so the porter dormancy gate re-scans
  building.built = fx.fromInt(0);
  world.add(command.building, UnderConstruction, { labor: fx.fromInt(0) });
  // The plot is a building site again — settlers standing on it step out (bindings kept, see above).
  evictSettlersFromFootprint(world, ctx, command.building);
}

/**
 * Abort an in-flight upgrade — the `cancelUpgrade` command's effect, {@link upgradeBuilding}'s inverse
 * short of the materials: the stashed inventory returns to the {@link Stockpile} (whatever the site
 * hold had accumulated is LOST — the price of changing one's mind, user decision 2026-07-18), `built`
 * returns to ONE (only a built building can start an upgrade), and both site markers come off. The
 * type, level, Health, and every binding never changed mid-upgrade, so nothing else needs restoring.
 *
 * Skip conditions (recoverable bad input, still logged): a dead / non-building target, or one not
 * upgrading — a from-scratch construction site has no previous level to fall back to.
 */
export function cancelUpgrade(world: World, command: Extract<Command, { kind: 'cancelUpgrade' }>): void {
  const building = world.tryGet(command.building, Building);
  const upgrading = world.tryGet(command.building, Upgrading);
  if (building === undefined || upgrading === undefined) return;
  const stock = world.tryGet(command.building, Stockpile);
  if (stock !== undefined) {
    // The stash Map is exclusively the marker's; with the marker removed below, handing it back whole
    // is safe. An in-place swap — log it so the porter dormancy gate re-scans.
    stock.amounts = upgrading.savedStock;
    world.touchComponent(Stockpile);
  }
  building.built = ONE;
  world.remove(command.building, UnderConstruction);
  world.remove(command.building, Upgrading);
}

/**
 * Place a boat hull — the boat analogue of {@link placeBuilding}: it creates a {@link Vehicle} hull at (x,y)
 * carrying an empty {@link Stockpile} (a ship is a movable stockpile, its capacity being the ship type's
 * `stockSlots`).
 *
 * Gated by the tribe's ship-unlock tech graph ({@link tribeShipsUnlocked}): only a `vehicleType` that is a
 * ship the tribe has currently unlocked (a `vehicle_ship` row — `passengerSlots > 0` — whose
 * `jobEnablesVehicle` edge is satisfied) is placed. A cart, a catapult, an unknown id, or a not-yet-unlocked
 * ship is recoverable bad input — skipped, still logged. Unlike a building the hull is seeded with an empty
 * hold: a boat is loaded by hauling cargo to it (the `cargoGoods` filter, a deferred load slice), not
 * pre-stocked.
 *
 * Source basis: pinned to the extracted vehicle IR — the ship/cart split is the `passengerslots` param
 * (`shipVehicles`/`isShipVehicle`) and the unlock is the `jobEnablesVehicle` edge ({@link tribeShipsUnlocked}).
 * The hull is a static placed store here: movement, passenger embark/disembark, the cargo-load filter, and
 * water-valency terrain are deferred follow-ups (source basis "Sea/Northland — boat hull entity").
 */
export function placeBoat(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeBoat' }>,
): void {
  // tribeShipsUnlocked already excludes carts / catapults, unknown ids, and ships behind an unmet tech edge,
  // so a `vehicleType` absent from it is bad input — skipped, still logged.
  const unlocked = tribeShipsUnlocked(world, ctx, command.tribe);
  if (!unlocked.some((v) => v.typeId === command.vehicleType)) return;

  const e = world.create();
  world.add(e, Position, positionOfNode(command.x, command.y));
  world.add(e, Vehicle, { vehicleType: command.vehicleType, tribe: command.tribe });
  // A hull placed for a specific player carries an `Owner`. Omitted / out-of-range leaves it neutral.
  stampOwner(world, e, command.owner);
  // A hull arrives empty — filled by hauling cargo to it, not pre-seeded. Its hold capacity is the ship type's
  // `stockSlots` (read off the VehicleType, like `largestShipCapacity`).
  world.add(e, Stockpile, { amounts: new Map<number, number>() });
  ctx.events.emit({ kind: 'boatPlaced', entity: e, at: { hx: command.x, hy: command.y } });
}
