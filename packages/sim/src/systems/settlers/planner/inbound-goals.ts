import { MoveGoal, Owner, Settler } from '../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';

/**
 * The nodes owned settlers are walking to, by their {@link MoveGoal}, kept across ticks from a change feed.
 * A stand one settler set off for on an earlier tick is as taken as one a settler stands on, so the next
 * idler stepping off a crowd picks another node instead of following it there.
 */
export class InboundGoals {
  private readonly counts = new Map<NodeId, number>();
  private readonly goals = new Map<Entity, NodeId>();
  private readonly feed: ChangeFeed;
  private readonly refreshEntity = (e: Entity): void => this.refresh(e);

  constructor(private readonly world: World) {
    this.feed = world.watchChanges([Settler, Owner, MoveGoal], [MoveGoal]);
    this.rebuild();
  }

  /** Whether an owned settler other than `self` is walking to `node`. */
  heads(node: NodeId, self: Entity): boolean {
    const count = this.counts.get(node) ?? 0;
    return count > (this.goals.get(self) === node ? 1 : 0);
  }

  catchUp(): void {
    if (this.feed.pending && this.feed.drain(this.refreshEntity)) this.rebuild();
  }

  private refresh(e: Entity): void {
    const goal = goalOf(this.world, e);
    const held = this.goals.get(e);
    if (held === goal) return;
    if (held !== undefined) {
      this.goals.delete(e);
      const left = (this.counts.get(held) ?? 0) - 1;
      if (left > 0) this.counts.set(held, left);
      else this.counts.delete(held);
    }
    if (goal !== undefined) {
      this.goals.set(e, goal);
      this.counts.set(goal, (this.counts.get(goal) ?? 0) + 1);
    }
  }

  private rebuild(): void {
    this.goals.clear();
    this.counts.clear();
    for (const e of this.world.canonicalQuery(Settler, Owner, MoveGoal)) this.refresh(e);
  }

  verify(): string[] {
    this.catchUp();
    const walkers = this.world.canonicalQuery(Settler, Owner, MoveGoal);
    const fresh = new Map<NodeId, number>();
    for (const e of walkers) {
      const cell = this.world.get(e, MoveGoal).cell;
      fresh.set(cell, (fresh.get(cell) ?? 0) + 1);
    }
    const same =
      walkers.length === this.goals.size &&
      walkers.every((e) => this.goals.get(e) === this.world.get(e, MoveGoal).cell) &&
      fresh.size === this.counts.size &&
      [...fresh].every(([n, c]) => this.counts.get(n) === c);
    return same ? [] : ['inboundGoals diverges from a fresh scan'];
  }
}

function goalOf(world: World, e: Entity): NodeId | undefined {
  if (!world.has(e, Settler) || !world.has(e, Owner)) return undefined;
  return world.tryGet(e, MoveGoal)?.cell;
}

const inbound = new WeakMap<World, InboundGoals>();

/** The world's {@link InboundGoals}, caught up to the live world. */
export function inboundGoals(world: World): InboundGoals {
  let held = inbound.get(world);
  if (held === undefined) {
    const created = new InboundGoals(world);
    world.registerCacheVerifier('inboundGoals', () => created.verify());
    inbound.set(world, created);
    held = created;
  } else {
    held.catchUp();
  }
  return held;
}
