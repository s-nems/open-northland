import { PRAYER_SITE } from '@open-northland/data';
import { Building, Position, UnderConstruction } from '../../../components/index.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isFinishedPrayerSite } from '../../readviews/index.js';

const byId = (e: Entity): number => e;

/** The finished temples in ascending id, kept from a change feed so a pass over them reads no other
 *  building. Wounds, owners and stock are read by the caller, since they move without changing the list. */
class FinishedTemples {
  private readonly temples: Entity[] = [];
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(
    private readonly world: World,
    private ctx: SystemContext,
  ) {
    this.feed = world.watchChanges([Building, UnderConstruction], [Building]);
    this.rebuild();
  }

  finished(): readonly Entity[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    return this.temples;
  }

  retarget(ctx: SystemContext): void {
    const contentChanged = ctx.content !== this.ctx.content;
    this.ctx = ctx;
    if (contentChanged) this.rebuild();
  }

  private refresh(e: Entity): void {
    const wanted = this.isTemple(e);
    if (wanted === includesSortedId(this.temples, e, byId)) return;
    if (wanted) insertSortedById(this.temples, e, byId);
    else removeSortedById(this.temples, e, byId);
  }

  private rebuild(): void {
    this.temples.length = 0;
    for (const e of this.world.canonicalQuery(Building, Position)) {
      if (this.isTemple(e)) this.temples.push(e);
    }
  }

  private isTemple(e: Entity): boolean {
    return (
      this.world.isAlive(e) &&
      this.world.has(e, Position) &&
      isFinishedPrayerSite(this.world, this.ctx, e, PRAYER_SITE.temple)
    );
  }

  verify(): string[] {
    const held = [...this.finished()];
    const fresh = this.world.canonicalQuery(Building, Position).filter((e) => this.isTemple(e));
    const same = held.length === fresh.length && held.every((e, i) => fresh[i] === e);
    return same ? [] : ['finishedTemples diverge from a fresh scan'];
  }
}

const templeLists = new WeakMap<World, FinishedTemples>();

/** Every player's finished temples in ascending id. Shared: never mutate it. */
export function finishedTemples(world: World, ctx: SystemContext): readonly Entity[] {
  let held = templeLists.get(world);
  if (held === undefined) {
    const created = new FinishedTemples(world, ctx);
    world.registerCacheVerifier('finishedTemples', () => created.verify());
    templeLists.set(world, created);
    held = created;
  } else {
    held.retarget(ctx);
  }
  return held.finished();
}
