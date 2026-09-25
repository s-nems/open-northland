import { Building, Stockpile, setStockAmount, UnderConstruction, Upgrading } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { buildingProduces, refillsOwnStock, stockCapacity } from '../stores/index.js';

const byId = (e: Entity): number => e;

/**
 * Tops each self-filling house (the well, the hive) up by one unit of every good it produces once per
 * game second while it is below capacity, with no worker: original behavior. The refill is no craft, so
 * it emits no `goodProduced`.
 */
export const selfFillingStockSystem: System = (world, ctx) => {
  // Caught up every tick, so a busy economy's stock writes never pile past the feed's limit.
  const below = selfFillingStoresOf(world, ctx).belowCapacity();
  if (ctx.tick % TICKS_PER_SECOND !== 0) return;
  for (const e of below) {
    const amounts = world.get(e, Stockpile).amounts;
    for (const good of buildingProduces(world, ctx, e)) {
      const have = amounts.get(good) ?? 0;
      if (have < stockCapacity(world, ctx, e, good)) setStockAmount(world, e, good, have + 1);
    }
  }
};

/** The finished self-filling houses short of a produced good, in ascending id, kept from a change feed so
 *  the pass touches only the ones that were drawn from. */
class SelfFillingStores {
  private readonly below: Entity[] = [];
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(
    private readonly world: World,
    private ctx: SystemContext,
  ) {
    this.feed = world.watchChanges(
      [Building, Stockpile, UnderConstruction, Upgrading],
      [Building, Stockpile],
    );
    this.rebuild();
  }

  belowCapacity(): readonly Entity[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    return this.below;
  }

  retarget(ctx: SystemContext): void {
    const contentChanged = ctx.content !== this.ctx.content;
    this.ctx = ctx;
    if (contentChanged) this.rebuild();
  }

  private refresh(e: Entity): void {
    const wanted = needsRefill(this.world, this.ctx, e);
    if (wanted === includesSortedId(this.below, e, byId)) return;
    if (wanted) insertSortedById(this.below, e, byId);
    else removeSortedById(this.below, e, byId);
  }

  private rebuild(): void {
    this.below.length = 0;
    for (const e of this.world.canonicalQuery(Building, Stockpile)) {
      if (needsRefill(this.world, this.ctx, e)) this.below.push(e);
    }
  }

  verify(): string[] {
    const held = [...this.belowCapacity()];
    const fresh = this.world
      .canonicalQuery(Building, Stockpile)
      .filter((e) => needsRefill(this.world, this.ctx, e));
    const same = held.length === fresh.length && held.every((e, i) => fresh[i] === e);
    return same ? [] : ['selfFillingStores diverge from a fresh scan'];
  }
}

function needsRefill(world: World, ctx: SystemContext, e: Entity): boolean {
  const building = world.tryGet(e, Building);
  if (building === undefined || building.built < ONE || !refillsOwnStock(world, ctx, e)) return false;
  if (world.has(e, UnderConstruction) || world.has(e, Upgrading)) return false;
  const amounts = world.tryGet(e, Stockpile)?.amounts;
  if (amounts === undefined) return false;
  return buildingProduces(world, ctx, e).some(
    (good) => (amounts.get(good) ?? 0) < stockCapacity(world, ctx, e, good),
  );
}

const stores = new WeakMap<World, SelfFillingStores>();

function selfFillingStoresOf(world: World, ctx: SystemContext): SelfFillingStores {
  let held = stores.get(world);
  if (held === undefined) {
    const created = new SelfFillingStores(world, ctx);
    world.registerCacheVerifier('selfFillingStores', () => created.verify());
    stores.set(world, created);
    held = created;
  } else {
    held.retarget(ctx);
  }
  return held;
}
