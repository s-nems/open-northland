import { ForageClaim } from '../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';

/** The bushes live {@link ForageClaim}s name, kept per world from a feed of the claims. */
class ClaimedBushes {
  private readonly bushOf = new Map<Entity, Entity>();
  private readonly foragers = new Map<Entity, number>();
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(private readonly world: World) {
    this.feed = world.watchChanges([ForageClaim], [ForageClaim]);
    this.rebuild();
  }

  has(bush: Entity): boolean {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
    return this.foragers.has(bush);
  }

  verify(): string[] {
    const fresh = new Set<Entity>();
    for (const e of this.world.query(ForageClaim)) fresh.add(this.world.get(e, ForageClaim).bush);
    let same = true;
    for (const bush of fresh) if (!this.has(bush)) same = false;
    return same && fresh.size === this.foragers.size ? [] : ['forageClaims diverge from a fresh scan'];
  }

  private refresh(e: Entity): void {
    const bush = this.world.tryGet(e, ForageClaim)?.bush;
    const prior = this.bushOf.get(e);
    if (bush === prior) return;
    if (prior !== undefined) {
      const left = (this.foragers.get(prior) ?? 0) - 1;
      if (left > 0) this.foragers.set(prior, left);
      else this.foragers.delete(prior);
      this.bushOf.delete(e);
    }
    if (bush !== undefined) {
      this.bushOf.set(e, bush);
      this.foragers.set(bush, (this.foragers.get(bush) ?? 0) + 1);
    }
  }

  private rebuild(): void {
    this.bushOf.clear();
    this.foragers.clear();
    for (const e of this.world.query(ForageClaim)) this.refresh(e);
  }
}

const claimedByWorld = new WeakMap<World, ClaimedBushes>();

/** Whether a forager is walking to pick `bush`. */
export function bushClaimed(world: World, bush: Entity): boolean {
  let held = claimedByWorld.get(world);
  if (held === undefined) {
    const created = new ClaimedBushes(world);
    world.registerCacheVerifier('forageClaims', () => created.verify());
    claimedByWorld.set(world, created);
    held = created;
  }
  return held.has(bush);
}

/** Claim `bush` for `forager`'s walk to it, in place of any bush it claimed before. */
export function claimBush(world: World, forager: Entity, bush: Entity): void {
  world.add(forager, ForageClaim, { bush });
}

/** Release `forager`'s bush claim, if it holds one. */
export function releaseBushClaim(world: World, forager: Entity): void {
  world.remove(forager, ForageClaim);
}
