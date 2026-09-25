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
import { type GamePhase, gamePhase, HOARD_UNITS_BY_PHASE } from '../game-phase.js';
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

/** One of a good's {@link SupplyLines}, ascending. */
type SupplyLine = 'short' | 'comfort' | 'glut';

/**
 * The goods the seat's own workshops pass between themselves whose makers' crews and seats the supply lines
 * size, by stable content ids (authored): the farm's grain, the mill's flour and the mint's coins the druids'
 * potions take. The list is authored rather than every intermediate good, because a managed good's lines
 * hire and release its makers; that suits a chain whose consumers' shelves measure its use, not goods such
 * as mead or shoes that settlers draw at their own pace. A stocked product's consumers, not the sites, size
 * it, so it hoards no more with the game phase.
 */
export const STOCKED_PRODUCT_GOOD_IDS: readonly string[] = ['wheat', 'flour', 'coin'];

/** The unit of a good no bill takes and no workshop shelves. */
const FALLBACK_SUPPLY_UNIT = 1;

/** Per content set, per build order, per game phase: the lines of every managed good, by good type. */
const linesCache = new WeakMap<
  ContentSet,
  WeakMap<readonly BuildOrderEntry[], Map<GamePhase, ReadonlyMap<number, SupplyLines>>>
>();

/**
 * The supply lines in `phase` of every good the build order's bills take, the collected goods, its
 * collector goods and the {@link STOCKED_PRODUCT_GOOD_IDS} (authored approximation). A unit is the good's
 * largest bill line, or for a stocked product the larger of that and its widest consuming shelf. Short
 * covers {@link MAX_ACTIVE_CONSTRUCTION_SITES} sites of the unit, comfort adds the larger of the unit and a
 * consuming workshop's input shelf, and glut adds {@link HOARD_UNITS_BY_PHASE} units per
 * {@link BUILD_ORDER_LOOKAHEAD_ENTRIES} entry on top, a stocked product the opening's in every phase.
 */
export function supplyLines(
  content: ContentSet,
  order: readonly BuildOrderEntry[],
  phase: GamePhase = 'opening',
): ReadonlyMap<number, SupplyLines> {
  let byOrder = linesCache.get(content);
  if (byOrder === undefined) {
    byOrder = new WeakMap();
    linesCache.set(content, byOrder);
  }
  let byPhase = byOrder.get(order);
  if (byPhase === undefined) {
    byPhase = new Map();
    byOrder.set(order, byPhase);
  }
  let lines = byPhase.get(phase);
  if (lines === undefined) {
    lines = deriveLines(content, order, phase);
    byPhase.set(phase, lines);
  }
  return lines;
}

function deriveLines(
  content: ContentSet,
  order: readonly BuildOrderEntry[],
  phase: GamePhase,
): ReadonlyMap<number, SupplyLines> {
  const index = contentIndex(content);
  const managed = new Set<number>();
  for (const id of [...COLLECTED_GOOD_IDS, ...STOCKED_PRODUCT_GOOD_IDS])
    addKnown(managed, index.goodTypeBySlug.get(id));
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
  const stocked = new Set<number>();
  for (const id of STOCKED_PRODUCT_GOOD_IDS) addKnown(stocked, index.goodTypeBySlug.get(id));
  const lines = new Map<number, SupplyLines>();
  for (const good of managed) {
    const shelved = shelf.get(good) ?? 0;
    // A stocked product is measured by the shelf its consumers draw it from, whatever small bill lines
    // also take it: a crew sized by a two-grain bill would rest before the mill's shelf was full.
    const unit = stocked.has(good)
      ? Math.max(billUnit.get(good) ?? 0, shelved, FALLBACK_SUPPLY_UNIT)
      : (billUnit.get(good) ?? Math.max(shelved, FALLBACK_SUPPLY_UNIT));
    const short = MAX_ACTIVE_CONSTRUCTION_SITES * unit;
    const comfort = short + Math.max(unit, shelved);
    const hoard = HOARD_UNITS_BY_PHASE[stocked.has(good) ? 'opening' : phase];
    lines.set(good, { unit, short, comfort, glut: comfort + BUILD_ORDER_LOOKAHEAD_ENTRIES * unit * hoard });
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
 * still lack) against its {@link SupplyLines} in the decision's game phase. A workshop's own shelf is not
 * fetchable, so a workshop eating its raw good reads as the shortage it is to the builders. An unmanaged
 * good is never short.
 */
export class SeatSupply {
  private consumers: ReadonlyMap<number, number> | undefined;

  private constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly player: number,
    private readonly owned: readonly Entity[],
    private readonly stock: FetchableStock,
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
    const lines = supplyLines(ctx.content, order, gamePhase(ctx.tick));
    const owed = sitesShortfalls(world, ctx, owned);
    const stock = FetchableStock.of(world, ctx);
    const surplus = new Map<number, number>();
    for (const good of lines.keys()) surplus.set(good, stock.units(player, good) - (owed.get(good) ?? 0));
    return new SeatSupply(world, ctx, player, owned, stock, lines, surplus);
  }

  /** The seat's fetchable units of any good, managed or not, the sites' needs not deducted. */
  units(good: number): number {
    return this.stock.units(this.player, good);
  }

  lines(good: number): SupplyLines | undefined {
    return this.linesByGood.get(good);
  }

  surplus(good: number): number | undefined {
    return this.surplusByGood.get(good);
  }

  /** Whether the good's surplus lies under `line`; false for an unmanaged good. */
  isUnder(good: number, line: SupplyLine): boolean {
    const lines = this.linesByGood.get(good);
    const surplus = this.surplusByGood.get(good);
    return lines !== undefined && surplus !== undefined && surplus < lines[line];
  }

  /** Whether the good is under the line its lever reads: comfort while `engaged`, so a lever that pulled
   *  at the short line holds until comfort, and short otherwise. */
  isShort(good: number, engaged: boolean): boolean {
    return this.isUnder(good, engaged ? 'comfort' : 'short');
  }

  /** The units the good lacks to its comfort line, 0 at or above it; 0 for an unmanaged good. */
  lackToComfort(good: number): number {
    const lines = this.linesByGood.get(good);
    const surplus = this.surplusByGood.get(good);
    return lines === undefined || surplus === undefined ? 0 : Math.max(0, lines.comfort - surplus);
  }

  atGlut(good: number): boolean {
    return this.lines(good) !== undefined && !this.isUnder(good, 'glut');
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
