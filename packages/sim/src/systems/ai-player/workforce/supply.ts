import type { ContentSet } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { FetchableStock } from '../../settlers/targets/index.js';
import {
  BUILD_ORDER_LOOKAHEAD_ENTRIES,
  type BuildOrderEntry,
  MAX_ACTIVE_CONSTRUCTION_SITES,
} from '../build-order/index.js';
import { sitesShortfalls } from '../build-order/upgrade-supply.js';
import { isBuilt } from '../seat-roster.js';
import { COLLECTED_GOOD_IDS } from './collectors/index.js';
import { plannedOperators } from './staffing-plan.js';

/** A managed good's stock lines, in fetchable units beyond what the seat's sites still lack. */
export interface SupplyLines {
  /** What one site takes of the good: its largest bill line in the build order, else its widest
   *  consuming shelf, else one. */
  readonly unit: number;
  readonly short: number;
  readonly comfort: number;
  readonly glut: number;
}

/** The unit of a good no bill takes and no workshop shelves. */
const FALLBACK_SUPPLY_UNIT = 1;

/** Per content set, per build order: the lines of every managed good, by good type. */
const linesCache = new WeakMap<
  ContentSet,
  WeakMap<readonly BuildOrderEntry[], ReadonlyMap<number, SupplyLines>>
>();

/**
 * The supply lines of every good the build order's bills take, the collected goods and its collector
 * goods (authored approximation). Short covers {@link MAX_ACTIVE_CONSTRUCTION_SITES} sites of the good's
 * unit, comfort adds the larger of the unit and a consuming workshop's input shelf, and glut adds one
 * unit per {@link BUILD_ORDER_LOOKAHEAD_ENTRIES} entry on top.
 */
export function supplyLines(
  content: ContentSet,
  order: readonly BuildOrderEntry[],
): ReadonlyMap<number, SupplyLines> {
  let byOrder = linesCache.get(content);
  if (byOrder === undefined) {
    byOrder = new WeakMap();
    linesCache.set(content, byOrder);
  }
  let lines = byOrder.get(order);
  if (lines === undefined) {
    lines = deriveLines(content, order);
    byOrder.set(order, lines);
  }
  return lines;
}

function deriveLines(
  content: ContentSet,
  order: readonly BuildOrderEntry[],
): ReadonlyMap<number, SupplyLines> {
  const index = contentIndex(content);
  const managed = new Set<number>();
  for (const id of COLLECTED_GOOD_IDS) addKnown(managed, index.goodTypeBySlug.get(id));
  const named = new Set<number>();
  for (const entry of order) {
    if (entry.kind === 'collector') addKnown(managed, index.goodTypeBySlug.get(entry.good));
    else addKnown(named, index.buildingTypeBySlug.get(entry.building));
  }
  // A placement charges the merged bill of the whole tier chain, so that is the bill a unit measures.
  const billUnit = new Map<number, number>();
  const shelf = new Map<number, number>();
  for (const typeId of named) {
    for (const line of index.constructionBillByBuilding.get(typeId) ?? []) {
      raiseTo(billUnit, line.goodType, line.amount);
      managed.add(line.goodType);
    }
    const capacities = index.stockSlotCapacityByBuilding.get(typeId);
    for (const input of index.mergedRecipeByBuilding.get(typeId)?.inputs ?? []) {
      raiseTo(shelf, input.goodType, capacities?.get(input.goodType) ?? 0);
    }
  }
  const lines = new Map<number, SupplyLines>();
  for (const good of managed) {
    const shelved = shelf.get(good) ?? 0;
    const unit = billUnit.get(good) ?? Math.max(shelved, FALLBACK_SUPPLY_UNIT);
    const short = MAX_ACTIVE_CONSTRUCTION_SITES * unit;
    const comfort = short + Math.max(unit, shelved);
    lines.set(good, { unit, short, comfort, glut: comfort + BUILD_ORDER_LOOKAHEAD_ENTRIES * unit });
  }
  return lines;
}

function addKnown(set: Set<number>, typeId: number | undefined): void {
  if (typeId !== undefined) set.add(typeId);
}

function raiseTo(map: Map<number, number>, key: number, value: number): void {
  map.set(key, Math.max(map.get(key) ?? 0, value));
}

/**
 * One seat's supply this decision: each managed good's surplus (fetchable units minus what the sites
 * still lack) against its {@link SupplyLines}. A workshop's own shelf is not fetchable, so a workshop
 * eating its raw good reads as the shortage it is to the builders. An unmanaged good is never short.
 */
export class SeatSupply {
  private consumers: ReadonlyMap<number, number> | undefined;

  private constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly owned: readonly Entity[],
    private readonly linesByGood: ReadonlyMap<number, SupplyLines>,
    private readonly surplusByGood: ReadonlyMap<number, number>,
  ) {}

  static of(
    world: World,
    ctx: SystemContext,
    player: number,
    owned: readonly Entity[],
    order: readonly BuildOrderEntry[],
  ): SeatSupply {
    const lines = supplyLines(ctx.content, order);
    const owed = sitesShortfalls(world, ctx, owned);
    const stock = FetchableStock.of(world, ctx);
    const surplus = new Map<number, number>();
    for (const good of lines.keys()) surplus.set(good, stock.units(player, good) - (owed.get(good) ?? 0));
    return new SeatSupply(world, ctx, owned, lines, surplus);
  }

  lines(good: number): SupplyLines | undefined {
    return this.linesByGood.get(good);
  }

  surplus(good: number): number | undefined {
    return this.surplusByGood.get(good);
  }

  /** Whether the good is under the line its lever reads: comfort while `engaged`, so a lever that pulled
   *  at the short line holds until comfort, and short otherwise. */
  isShort(good: number, engaged: boolean): boolean {
    const lines = this.linesByGood.get(good);
    const surplus = this.surplusByGood.get(good);
    if (lines === undefined || surplus === undefined) return false;
    return surplus < (engaged ? lines.comfort : lines.short);
  }

  atGlut(good: number): boolean {
    const lines = this.linesByGood.get(good);
    const surplus = this.surplusByGood.get(good);
    return lines !== undefined && surplus !== undefined && surplus >= lines.glut;
  }

  /** The planned operators of the seat's built workshops whose recipes consume the good. */
  plannedConsumers(good: number): number {
    this.consumers ??= this.countPlannedConsumers();
    return this.consumers.get(good) ?? 0;
  }

  private countPlannedConsumers(): ReadonlyMap<number, number> {
    const index = contentIndex(this.ctx.content);
    const consumers = new Map<number, number>();
    for (const e of this.owned) {
      if (!isBuilt(this.world, e)) continue;
      const typeId = this.world.get(e, Building).buildingType;
      const inputs = index.mergedRecipeByBuilding.get(typeId)?.inputs;
      const type = index.buildings.get(typeId);
      if (inputs === undefined || type === undefined) continue;
      const operators = plannedOperators(this.ctx, type);
      for (const input of inputs)
        consumers.set(input.goodType, (consumers.get(input.goodType) ?? 0) + operators);
    }
    return consumers;
  }
}
