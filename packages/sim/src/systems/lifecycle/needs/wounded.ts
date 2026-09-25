import { Health, Person } from '../../../components/index.js';
import { includesSortedId, insertSortedById, removeSortedById } from '../../../core/sorted-id.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';

const byId = (e: Entity): number => e;

/** The living persons below their max hitpoints in ascending id, kept from a change feed so a pass that
 *  only heals reads nobody at full health. */
class WoundedPersons {
  private readonly wounded: Entity[] = [];
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(private readonly world: World) {
    this.feed = world.watchChanges([Health, Person], [Health]);
    this.rebuild();
  }

  current(): readonly Entity[] {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    return this.wounded;
  }

  private refresh(e: Entity): void {
    const wanted = this.isWounded(e);
    if (wanted === includesSortedId(this.wounded, e, byId)) return;
    if (wanted) insertSortedById(this.wounded, e, byId);
    else removeSortedById(this.wounded, e, byId);
  }

  private rebuild(): void {
    this.wounded.length = 0;
    for (const e of this.world.canonicalQuery(Person, Health)) {
      if (this.isWounded(e)) this.wounded.push(e);
    }
  }

  private isWounded(e: Entity): boolean {
    if (!this.world.isAlive(e) || !this.world.has(e, Person)) return false;
    const health = this.world.tryGet(e, Health);
    return health !== undefined && health.hitpoints > 0 && health.hitpoints < health.max;
  }

  verify(): string[] {
    const held = [...this.current()];
    const fresh = this.world.canonicalQuery(Person, Health).filter((e) => this.isWounded(e));
    const same = held.length === fresh.length && held.every((e, i) => fresh[i] === e);
    return same ? [] : ['woundedPersons diverge from a fresh scan'];
  }
}

const woundedLists = new WeakMap<World, WoundedPersons>();

/** The persons of `world` below their max hitpoints, alive, in ascending id. */
export function woundedPersonsOf(world: World): readonly Entity[] {
  let held = woundedLists.get(world);
  if (held === undefined) {
    const created = new WoundedPersons(world);
    world.registerCacheVerifier('woundedPersons', () => created.verify());
    woundedLists.set(world, created);
    held = created;
  }
  return held.current();
}
