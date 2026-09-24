import type { BuildingType } from '@open-northland/data';
import {
  Age,
  Building,
  FoodReserve,
  Marriage,
  Residence,
  Settler,
  stockpileEntries,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isFood } from '../readviews/index.js';
import { accessibleStockAmounts, setAccessibleStockAmount } from '../stores/index.js';

/** The `home`-kind {@link BuildingType} of a house entity, including one still under construction. */
function homeType(world: World, ctx: SystemContext, house: Entity): BuildingType | undefined {
  if (!world.isAlive(house)) return undefined;
  const b = world.tryGet(house, Building);
  if (b === undefined) return undefined;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  return type?.kind === 'home' ? type : undefined;
}

/** The `home`-kind {@link BuildingType} of a completed house entity. */
export function builtHomeType(world: World, ctx: SystemContext, house: Entity): BuildingType | undefined {
  const type = homeType(world, ctx, house);
  if (type === undefined || world.get(house, Building).built < ONE) return undefined;
  return type;
}

/** The settlers living in `house`, ascending entity id. */
function residentsOf(world: World, house: Entity): Entity[] {
  const out: Entity[] = [];
  for (const e of world.canonicalQuery(Residence)) {
    if (world.get(e, Residence).home === house) out.push(e);
  }
  return out;
}

/** Unhouse every family living in `house`, for a home leaving the map. */
export function evictResidentsOf(world: World, house: Entity): void {
  for (const e of residentsOf(world, house)) world.remove(e, Residence);
}

/**
 * A settler's household - itself, its living spouse, and their still-growing child - the unit the
 * `assignHouse` command moves as one. A grown child has left the family.
 */
export function familyOf(world: World, e: Entity): Entity[] {
  const family = [e];
  const marriage = world.tryGet(e, Marriage);
  if (marriage !== undefined) {
    if (world.isAlive(marriage.spouse)) family.push(marriage.spouse);
    const child = marriage.child;
    if (child !== null && world.isAlive(child) && isMinor(world, child)) family.push(child);
  }
  return family;
}

/** Whether `child` is still growing up; only a born-young settler carries an {@link Age}. */
export function isMinor(world: World, child: Entity): boolean {
  return world.has(child, Age);
}

/**
 * The distinct families living in `house`, each as its member list. A family is an adult, its living
 * cohabiting spouse, and the couple's still-growing child; a resident minor whose parents are gone forms
 * its own one-member household. Authored: `homeSize` (`houses.ini` `logichomesize` 1..5) caps families,
 * not heads, and this grouping is that capacity's unit. Group order follows the lowest member id.
 */
export function familiesOf(world: World, house: Entity): Entity[][] {
  const residents = residentsOf(world, house);
  const residentSet = new Set(residents);
  const groups = new Map<Entity, Entity[]>(); // keyed by the family head - the couple's lower adult id
  const headByChild = new Map<Entity, Entity>();
  const minors: Entity[] = [];
  for (const e of residents) {
    if (isMinor(world, e)) {
      minors.push(e);
      continue;
    }
    const marriage = world.tryGet(e, Marriage);
    const spouse =
      marriage !== undefined && world.isAlive(marriage.spouse) && residentSet.has(marriage.spouse)
        ? marriage.spouse
        : undefined;
    const head = spouse !== undefined && spouse < e ? spouse : e;
    const group = groups.get(head);
    if (group === undefined) groups.set(head, [e]);
    else group.push(e);
    const child = marriage?.child;
    if (child != null && residentSet.has(child)) headByChild.set(child, head);
  }
  for (const minor of minors) {
    const head = headByChild.get(minor);
    const parents = head !== undefined ? groups.get(head) : undefined;
    if (parents !== undefined) parents.push(minor);
    else groups.set(minor, [minor]);
  }
  return [...groups.values()];
}

/**
 * Reserve `house` for `e`'s household, where `e` is a settler. The reservation may be made while the home
 * is under construction; household drives continue to require {@link builtHomeType} before using it.
 * Refuses another tribe's home or one without a free family slot.
 */
export function moveFamilyInto(world: World, ctx: SystemContext, e: Entity, house: Entity): void {
  const type = homeType(world, ctx, house);
  if (type === undefined) return;
  if (world.get(house, Building).tribe !== world.get(e, Settler).tribe) return;
  const family = familyOf(world, e);
  const members = new Set(family);
  // The mover's own household is excluded, so a re-assign into the same home costs no extra slot.
  const others = familiesOf(world, house).filter((fam) => !fam.some((m) => members.has(m))).length;
  if (others + 1 > type.homeSize) return; // no free family slot
  for (const member of family) {
    world.add(member, Residence, { home: house }); // add overwrites - a move drops the old home
  }
}

/** Total edible units ({@link isFood}) in `house`'s accessible inventory - the family larder. */
export function storedFoodUnits(world: World, ctx: SystemContext, house: Entity): number {
  const stock = accessibleStockAmounts(world, house);
  if (stock === undefined) return 0;
  let total = 0;
  for (const [goodType, amount] of stockpileEntries({ amounts: stock })) {
    if (amount > 0 && isFood(ctx, goodType)) total += amount;
  }
  return total;
}

/** The food units of `house`'s stock held back for child-making. */
export function reservedFoodUnits(world: World, house: Entity): number {
  return world.tryGet(house, FoodReserve)?.amount ?? 0;
}

/** Set (or clear, at 0) `house`'s {@link FoodReserve} to `amount`. */
export function setFoodReserve(world: World, house: Entity, amount: number): void {
  if (amount <= 0) {
    world.remove(house, FoodReserve);
    return;
  }
  const existing = world.tryMut(house, FoodReserve);
  if (existing === undefined) world.add(house, FoodReserve, { amount });
  else existing.amount = amount;
}

/**
 * Consume `units` edible units from `house`'s accessible inventory, lowest goodType first; a shortfall consumes what
 * is there.
 */
export function consumeFoodUnits(world: World, ctx: SystemContext, house: Entity, units: number): void {
  const stock = accessibleStockAmounts(world, house);
  if (stock === undefined) return;
  let left = units;
  for (const [goodType, amount] of stockpileEntries({ amounts: stock })) {
    if (left <= 0) break;
    if (amount <= 0 || !isFood(ctx, goodType)) continue;
    const take = Math.min(amount, left);
    setAccessibleStockAmount(world, house, goodType, amount - take);
    left -= take;
  }
}
