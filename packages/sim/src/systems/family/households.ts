import type { BuildingType } from '@open-northland/data';
import {
  Age,
  Building,
  FoodReserve,
  Marriage,
  Residence,
  Stockpile,
  stockpileEntries,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isFood } from '../readviews/index.js';
import { canonicalById } from '../spatial.js';

// The household read model: who lives where, what a home stocks, and what of it is spoken for.

/** The `home`-kind {@link BuildingType} of a BUILT house entity, or undefined when the entity is not a
 *  completed residence (dead, not a building, still under construction, or not a home). */
export function builtHomeType(world: World, ctx: SystemContext, house: Entity): BuildingType | undefined {
  if (!world.isAlive(house)) return undefined;
  const b = world.tryGet(house, Building);
  if (b === undefined || b.built < ONE) return undefined;
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  return type?.kind === 'home' ? type : undefined;
}

/** The settlers living in `house` (their {@link Residence} points at it), ascending entity id. */
function residentsOf(world: World, house: Entity): Entity[] {
  const out: Entity[] = [];
  for (const e of canonicalById(world.query(Residence))) {
    if (world.get(e, Residence).home === house) out.push(e);
  }
  return out;
}

/**
 * A settler's household — itself, its living spouse, and their still-growing child — the unit the
 * `assignHouse` command moves as one. The child counts while it is alive and still carries an `Age`
 * (a grown child has left the family; ids are never recycled, so the stale probe is safe).
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

/** Whether the couple's child still counts against the one-child limit: still growing up (only a
 *  born-young settler carries an {@link Age}; adulthood removes it). */
export function isMinor(world: World, child: Entity): boolean {
  return world.has(child, Age);
}

/**
 * The distinct families living in `house`, each as its member list. A family is an adult, its living
 * cohabiting spouse, and the couple's still-growing child; a resident minor whose parents are gone
 * forms its own one-member household. `homeSize` (`houses.ini` `logichomesize` 1..5) caps FAMILIES,
 * not heads (user-specified design, 2026-07-16) — this grouping is that capacity's unit. Deterministic:
 * built over the ascending-id resident scan, so group order follows the lowest member id.
 */
export function familiesOf(world: World, house: Entity): Entity[][] {
  const residents = residentsOf(world, house);
  const residentSet = new Set(residents);
  const groups = new Map<Entity, Entity[]>(); // keyed by the family head — the couple's lower adult id
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
    else groups.set(minor, [minor]); // an orphan holds its own slot
  }
  return [...groups.values()];
}

/** Total edible units ({@link isFood}) in `house`'s stockpile — the larder the family draws on. */
export function storedFoodUnits(world: World, ctx: SystemContext, house: Entity): number {
  const stock = world.tryGet(house, Stockpile);
  if (stock === undefined) return 0;
  let total = 0;
  for (const [goodType, amount] of stockpileEntries(stock)) {
    if (amount > 0 && isFood(ctx, goodType)) total += amount;
  }
  return total;
}

/** The food units of `house`'s stock held back for child-making — 0 when nothing is reserved. */
export function reservedFoodUnits(world: World, house: Entity): number {
  return world.tryGet(house, FoodReserve)?.amount ?? 0;
}

/** Set (or clear, at 0) `house`'s {@link FoodReserve} to `amount`. */
export function setFoodReserve(world: World, house: Entity, amount: number): void {
  if (amount <= 0) {
    world.remove(house, FoodReserve);
    return;
  }
  const existing = world.tryGet(house, FoodReserve);
  if (existing === undefined) world.add(house, FoodReserve, { amount });
  else existing.amount = amount;
}

/**
 * Consume `units` edible units from `house`'s stockpile, lowest goodType first (canonical). The caller
 * must have checked {@link storedFoodUnits}` >= units`; a shortfall consumes what is there.
 */
export function consumeFoodUnits(world: World, ctx: SystemContext, house: Entity, units: number): void {
  const stock = world.tryGet(house, Stockpile);
  if (stock === undefined) return;
  let left = units;
  for (const [goodType, amount] of stockpileEntries(stock)) {
    if (left <= 0) break;
    if (amount <= 0 || !isFood(ctx, goodType)) continue;
    const take = Math.min(amount, left);
    stock.amounts.set(goodType, amount - take);
    left -= take;
  }
}
