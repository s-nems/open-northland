import type { BuildingType } from '@open-northland/data';
import { Building, Stockpile, UnderConstruction } from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { buildingEnabled } from '../progression/index.js';

/** The tiers above `type` on its upgrade chain that `seat` has enabled without a gap, lowest first, kept to
 *  `allowed` when given: each is a target `upgradeBuilding` accepts and a type `placeBuilding` places. */
export function enabledTiersAbove(
  world: World,
  ctx: SystemContext,
  seat: number,
  tribe: number,
  type: BuildingType,
  allowed?: ReadonlySet<number>,
): BuildingType[] {
  const index = contentIndex(ctx.content);
  const tiers: BuildingType[] = [];
  for (let tier = type.upgradeTarget; tier !== undefined; ) {
    const next = index.buildings.get(tier);
    if (next === undefined || tiers.includes(next) || (allowed !== undefined && !allowed.has(tier))) break;
    if (!buildingEnabled(world, ctx, seat, tribe, tier)) break;
    tiers.push(next);
    tier = next.upgradeTarget;
  }
  return tiers;
}

/** Owner ruling: the computer player raises a warehouse, and a colony home, at the top of its chain. The
 *  highest tier of `type`'s chain `seat` has enabled, else `type` itself. */
export function topEnabledTier(
  world: World,
  ctx: SystemContext,
  seat: number,
  tribe: number,
  type: BuildingType,
): BuildingType {
  return enabledTiersAbove(world, ctx, seat, tribe, type).at(-1) ?? type;
}

/** The highest tier above the built `building` that its owner `seat` has enabled, or undefined: none, or
 *  the building is a site or upgrading. */
export function liftTarget(
  world: World,
  ctx: SystemContext,
  seat: number,
  building: Entity,
): BuildingType | undefined {
  if (world.has(building, UnderConstruction)) return undefined;
  const house = world.get(building, Building);
  const type = contentIndex(ctx.content).buildings.get(house.buildingType);
  return type === undefined ? undefined : enabledTiersAbove(world, ctx, seat, house.tribe, type).at(-1);
}

/** Whether `building`'s own pile holds the whole bill of upgrading it to `target`: the upgrade seeds its
 *  site from that pile, so it waits on no delivery. */
export function holdsUpgradeBill(
  world: World,
  ctx: SystemContext,
  building: Entity,
  target: number,
): boolean {
  const from = world.get(building, Building).buildingType;
  const bill = contentIndex(ctx.content).upgradeBillByTarget.get(from)?.get(target);
  const pile = world.tryGet(building, Stockpile)?.amounts;
  return bill !== undefined && bill.every((line) => (pile?.get(line.goodType) ?? 0) >= line.amount);
}

/** The command upgrading `building` straight to `target`. */
export function liftCommand(building: Entity, target: BuildingType): PlayerCommand {
  return { kind: 'upgradeBuilding', building, target: target.typeId };
}
