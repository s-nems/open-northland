import {
  Building,
  DefenceMode,
  Health,
  JobAssignment,
  Position,
  Settler,
  Stockpile,
  stampOwner,
  stockpileEntries,
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
import { destroyFieldsUnderBuilding } from '../economy/fields.js';
import { evictLooseGoodsFromFootprint } from '../economy/goods-evict.js';
import { releaseEmployment } from '../economy/jobs/index.js';
import { destroyStumpsInReserved } from '../economy/stumps.js';
import { evictWorkFlagsFromFootprint } from '../economy/work-flag.js';
import { canPlaceBuilding } from '../footprint/index.js';
import { evictSettlersFromFootprint } from '../movement/evict.js';
import { buildingEnabled, tribeShipsUnlocked } from '../progression/index.js';
import { upgradeTierOf } from '../stores/index.js';

/**
 * Release every settler bound to `building` before it is destroyed, so no {@link JobAssignment} dangles on
 * a dead entity. The released settler keeps its trade and loses only the post: employment is directed, so a
 * trade taken away here is one nothing gives back.
 *
 * Matches are collected before mutating because `world.remove` deletes from the `JobAssignment` store that
 * `world.query` may be iterating.
 */
export function unbindWorkersOf(world: World, ctx: SystemContext, building: Entity): void {
  const bound: Entity[] = [];
  for (const e of world.query(Settler, JobAssignment)) {
    if (world.get(e, JobAssignment).workplace === building) bound.push(e);
  }
  for (const e of bound) releaseEmployment(world, ctx, e);
}

export function placeBuilding(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeBuilding' }>,
): void {
  const type = contentIndex(ctx.content).commandBuildings.get(command.buildingType);
  if (type === undefined) return;

  if (command.force !== true) {
    if (!buildingEnabled(world, ctx, command.tribe, command.buildingType)) return;

    // Ground-collision gate, the original's free placement rule; a mapless sim validates trivially.
    if (
      ctx.terrain !== undefined &&
      !canPlaceBuilding(world, ctx, ctx.terrain, command.buildingType, command.x, command.y)
    ) {
      return;
    }
  }

  const e = world.create();
  // The anchor is a half-cell node; its Position is the node's fractional tile coords.
  world.add(e, Position, positionOfNode(command.x, command.y));
  const built = command.underConstruction ? fx.fromInt(0) : ONE;
  world.add(e, Building, { buildingType: command.buildingType, tribe: command.tribe, built, level: 0 });
  const amounts = new Map<number, number>();
  if (command.underConstruction) {
    // The ConstructionSystem ramps Health up as the site rises; it starts at 1 so a foundation is never a
    // 0-HP corpse the CleanupSystem reaps.
    world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
    if (type.hitpoints !== undefined) world.add(e, Health, { hitpoints: 1, max: type.hitpoints });
  } else if (command.fillStock) {
    for (const slot of type.stock) amounts.set(slot.goodType, slot.capacity);
  } else {
    for (const slot of type.stock) {
      if (slot.initial > 0) amounts.set(slot.goodType, slot.initial);
    }
  }
  if (!command.underConstruction) {
    // Authored starting stock is unclamped and not limited to the type's declared slots (Walhalla authors
    // 1000 iron into a 45-capacity barn). Approximation: additive-vs-replace is unobserved in the
    // original, and the verb is "add goods".
    for (const g of command.initialGoods ?? []) {
      if (g.amount > 0) amounts.set(g.good, (amounts.get(g.good) ?? 0) + g.amount);
    }
    // A placed-built building arrives at full life so it can be besieged; a type with no extracted
    // `hitpoints` carries no Health and cannot be attacked.
    if (type.hitpoints !== undefined)
      world.add(e, Health, { hitpoints: type.hitpoints, max: type.hitpoints });
  }
  world.add(e, Stockpile, { amounts });
  stampOwner(world, e, command.owner);
  // The plot is impassable from this tick. The placement gates ignore work flags and loose goods, so a house
  // may legally land on either; both are displaced outward rather than walled in.
  evictSettlersFromFootprint(world, ctx, e);
  evictWorkFlagsFromFootprint(world, ctx, e);
  evictLooseGoodsFromFootprint(world, ctx, e);
  // Bushes and felled-tree stumps are walkable and not a placement obstacle, so the plot may cover them; the
  // original clears landscape decoration in a building's reserved zone.
  destroyBerryBushesInReserved(world, ctx, e);
  destroyStumpsInReserved(world, ctx, e);
  // A field declares no build area, so it never refuses a site - this is the only thing that clears one.
  destroyFieldsUnderBuilding(world, ctx, e);
  ctx.events.emit({ kind: 'buildingPlaced', entity: e, at: { hx: command.x, hy: command.y } });
}

/**
 * Begin upgrading a built building into its type's `upgradeTarget` level - see the command doc. The
 * inventory is stashed on the {@link Upgrading} marker and the emptied {@link Stockpile} becomes the
 * site's build hold, seeded with the bill goods the building already holds.
 *
 * {@link JobAssignment}s and residences deliberately survive: the occupants leave the building but keep
 * their bindings and return when the upgrade completes (source basis: observed original behavior). An
 * in-flight production cycle is left to run out and deposits into the build hold; approximation, the
 * original's mid-upgrade batch behavior is unobserved.
 */
export function upgradeBuilding(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'upgradeBuilding' }>,
): void {
  const building = world.tryMut(command.building, Building);
  if (building === undefined || building.built < ONE) return;
  if (world.has(command.building, UnderConstruction)) return;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  const target = type === undefined ? undefined : upgradeTierOf(type, ctx);
  if (target === undefined) return; // top level, unchained, or malformed content
  if (!buildingEnabled(world, ctx, building.tribe, target.typeId)) return;

  const stock = world.tryMut(command.building, Stockpile);
  if (stock === undefined) return; // no build hold, so the site could never advance
  const hold = new Map<number, number>();
  const seeded = new Map<number, number>();
  for (const line of target.construction) {
    const take = Math.min(stock.amounts.get(line.goodType) ?? 0, line.amount);
    if (take <= 0) continue;
    // Accumulate rather than overwrite so a schema-legal duplicated bill line degrades like
    // consumeGoods does instead of destroying the earlier take.
    hold.set(line.goodType, (hold.get(line.goodType) ?? 0) + take);
    seeded.set(line.goodType, (seeded.get(line.goodType) ?? 0) + take);
    const rest = (stock.amounts.get(line.goodType) ?? 0) - take;
    if (rest > 0) stock.amounts.set(line.goodType, rest);
    else stock.amounts.delete(line.goodType);
  }
  world.add(command.building, Upgrading, { savedStock: stock.amounts, seeded });
  world.mut(command.building, Stockpile).amounts = hold;
  building.built = fx.fromInt(0);
  world.add(command.building, UnderConstruction, { labor: fx.fromInt(0) });
  // The panel hides the defence window for a site, so an alarm left standing could be neither seen nor
  // lowered and would silently call the garrison back once the upgrade finished.
  world.remove(command.building, DefenceMode);
  evictSettlersFromFootprint(world, ctx, command.building);
}

/**
 * Abort an in-flight upgrade - see the command doc. The building's own bill goods that seeded the hold
 * return to the {@link Stockpile} with the stash, and whatever else the hold had accumulated is lost.
 * Type, level, Health, and every binding never changed, so nothing else needs restoring.
 */
export function cancelUpgrade(world: World, command: Extract<Command, { kind: 'cancelUpgrade' }>): void {
  const building = world.tryMut(command.building, Building);
  const upgrading = world.tryMut(command.building, Upgrading);
  if (building === undefined || upgrading === undefined) return;
  const stock = world.tryGet(command.building, Stockpile);
  if (stock !== undefined) {
    // The min defends the invariant that nothing withdraws from a site mid-upgrade.
    for (const [goodType, amount] of stockpileEntries({ amounts: upgrading.seeded })) {
      const back = Math.min(stock.amounts.get(goodType) ?? 0, amount);
      if (back > 0) upgrading.savedStock.set(goodType, (upgrading.savedStock.get(goodType) ?? 0) + back);
    }
    // The stash Map is exclusively the marker's; with the marker removed below, handing it back whole is safe.
    world.mut(command.building, Stockpile).amounts = upgrading.savedStock;
  }
  building.built = ONE;
  world.remove(command.building, UnderConstruction);
  world.remove(command.building, Upgrading);
}

/**
 * Place a boat hull - see the command doc. Source basis: the extracted vehicle IR, where the ship/cart
 * split is the `passengerslots` param and the unlock is the `jobEnablesVehicle` edge. The hull is a
 * static placed store here; movement, embark and disembark, and the cargo-load filter are deferred.
 */
export function placeBoat(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'placeBoat' }>,
): void {
  const unlocked = tribeShipsUnlocked(world, ctx, command.tribe);
  if (!unlocked.some((v) => v.typeId === command.vehicleType)) return;

  const e = world.create();
  world.add(e, Position, positionOfNode(command.x, command.y));
  world.add(e, Vehicle, { vehicleType: command.vehicleType, tribe: command.tribe });
  stampOwner(world, e, command.owner);
  world.add(e, Stockpile, { amounts: new Map<number, number>() });
  ctx.events.emit({ kind: 'boatPlaced', entity: e, at: { hx: command.x, hy: command.y } });
}
