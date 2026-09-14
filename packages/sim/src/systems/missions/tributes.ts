import { BUILDING_KIND } from '@open-northland/data';
import {
  Building,
  markTributePaid,
  ownerOf,
  Stockpile,
  type TributeDemand,
  tributeSlot,
  unpaidTributes,
} from '../../components/index.js';
import type { TributeCommand } from '../../core/commands/tribute.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { edibleClassOf, edibleGoodFormOf } from '../readviews/food.js';
import { countsAsOwnStock, stockOf, takeStock } from './stock.js';

/** One open, unpaid tribute as the diplomacy window lists it: each demand with what the payer's
 *  stores hold toward it between them, and whether one store could pay the whole slot now. */
export interface OpenTribute {
  readonly slot: number;
  readonly receiver: number;
  readonly stringId: number;
  readonly demands: readonly {
    readonly good: number;
    readonly amount: number;
    readonly onHand: number;
  }[];
  readonly payable: boolean;
}

interface PayingHouse {
  readonly entity: Entity;
  readonly buildingType: number;
}

const byEntity = (a: PayingHouse, b: PayingHouse): number => a.entity - b.entity;

/**
 * The payer's finished storages, then its finished workplaces, each ascending by id: the houses a
 * tribute is counted over and drained from, in that order. Approximation: the original drains its
 * headquarters type before the other storages.
 */
function payingHouses(world: World, ctx: ContentContext, payer: number): PayingHouse[] {
  const storages: PayingHouse[] = [];
  const workplaces: PayingHouse[] = [];
  const buildings = contentIndex(ctx.content).buildings;
  for (const entity of world.query(Building, Stockpile)) {
    const building = world.get(entity, Building);
    if (building.built !== ONE || ownerOf(world, entity) !== payer) continue;
    const kind = buildings.get(building.buildingType)?.kind;
    if (kind === BUILDING_KIND.storage) storages.push({ entity, buildingType: building.buildingType });
    else if (kind === BUILDING_KIND.workplace) {
      workplaces.push({ entity, buildingType: building.buildingType });
    }
  }
  return storages.sort(byEntity).concat(workplaces.sort(byEntity));
}

/**
 * The good a house answers a demand for `good` with, or undefined when it stocks none as its own. A
 * dish or an edible is met by the first good of its edible class the house stocks, the edible before
 * the dishes ascending by typeId, so a warehouse pays bread out of its `food_simple` and the bakery
 * out of its bread (reading of the original's food lookup); any other good only by itself.
 */
function stockedFormOf(ctx: ContentContext, buildingType: number, good: number): number | undefined {
  const edibleClass = edibleClassOf(ctx.content, edibleGoodFormOf(ctx.content, good));
  for (const candidate of edibleClass.length > 0 ? edibleClass : [good]) {
    if (countsAsOwnStock(ctx, buildingType, candidate)) return candidate;
  }
  return undefined;
}

function onHandAt(world: World, ctx: ContentContext, house: PayingHouse, good: number): number {
  const stocked = stockedFormOf(ctx, house.buildingType, good);
  return stocked === undefined ? 0 : stockOf(world, house.entity, stocked);
}

function onHandOver(world: World, ctx: ContentContext, houses: readonly PayingHouse[], good: number): number {
  let total = 0;
  for (const house of houses) total += onHandAt(world, ctx, house, good);
  return total;
}

/**
 * The drain the demands would take out of `houses` in order, each house giving what it holds of what
 * is still owed, and whether that covers every demand (reading of the original's payable test, which
 * sums the payer's warehouses and workplaces). Two demands one house answers with the same stocked
 * good share its stock, so they cannot both take the same units (deviation: the original lets each
 * see the full stock and leaves the slot unpaid after draining it).
 */
function drainPlan(
  world: World,
  ctx: ContentContext,
  houses: readonly PayingHouse[],
  demands: DeepReadonly<TributeDemand[]>,
): { readonly takes: ReadonlyMap<Entity, ReadonlyMap<number, number>>; readonly covered: boolean } {
  const owed = demands.map((demand) => ({ good: demand.good, amount: demand.amount }));
  const takes = new Map<Entity, Map<number, number>>();
  for (const house of houses) {
    const left = new Map<number, number>();
    let outstanding = 0;
    for (const demand of owed) {
      if (demand.amount <= 0) continue;
      const stocked = stockedFormOf(ctx, house.buildingType, demand.good);
      if (stocked !== undefined) {
        const available = left.get(stocked) ?? stockOf(world, house.entity, stocked);
        const take = Math.min(available, demand.amount);
        left.set(stocked, available - take);
        demand.amount -= take;
        if (take > 0) {
          let given = takes.get(house.entity);
          if (given === undefined) {
            given = new Map();
            takes.set(house.entity, given);
          }
          given.set(stocked, (given.get(stocked) ?? 0) + take);
        }
      }
      if (demand.amount > 0) outstanding++;
    }
    if (outstanding === 0) break;
  }
  return { takes, covered: owed.every((demand) => demand.amount <= 0) };
}

/** The `payTribute` command: hand the goods over out of the payer's houses in {@link payingHouses}
 *  order, each giving what it holds of what is still owed, and mark the slot paid. */
export function payTribute(world: World, ctx: ContentContext, command: TributeCommand): void {
  const held = tributeSlot(world, command.slot);
  if (held === undefined || held.payer !== command.player || !held.active || held.paid) return;
  const plan = drainPlan(world, ctx, payingHouses(world, ctx, held.payer), held.demands);
  if (!plan.covered) return;
  for (const [entity, given] of plan.takes) {
    for (const [stocked, amount] of given) takeStock(world, entity, stocked, amount);
  }
  markTributePaid(world, command.slot);
}

/** The open, unpaid tributes `payer` owes, ascending by slot, as detached copies. */
export function openTributes(world: World, ctx: ContentContext, payer: number): OpenTribute[] {
  const unpaid = unpaidTributes(world, payer);
  if (unpaid.length === 0) return [];
  const houses = payingHouses(world, ctx, payer);
  return unpaid.map(({ slot, tribute }) => ({
    slot,
    receiver: tribute.receiver,
    stringId: tribute.stringId,
    demands: tribute.demands.map((demand) => ({
      good: demand.good,
      amount: demand.amount,
      onHand: onHandOver(world, ctx, houses, demand.good),
    })),
    payable: drainPlan(world, ctx, houses, tribute.demands).covered,
  }));
}
