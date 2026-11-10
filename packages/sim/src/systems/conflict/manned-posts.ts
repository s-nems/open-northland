import type { ContentSet } from '@open-northland/data';
import {
  Building,
  Garrison,
  JobAssignment,
  Position,
  Settler,
  UnderConstruction,
} from '../../components/index.js';
import type { ChangeFeed, Component, Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { mannedPostOf } from './tower-post.js';

/** The stores {@link mannedPostOf} reads of a garrison and of its post, bar Position: a write to one of
 *  them is rare, so its feed entry may cost a store lookup. */
const POST_MEMBERSHIP: readonly Component<unknown>[] = [
  Garrison,
  Settler,
  JobAssignment,
  Building,
  UnderConstruction,
];
const POST_VALUES: readonly Component<unknown>[] = [Garrison, Settler, JobAssignment, Building];
/** Every walker writes its Position each tick, so that feed is read by role flag alone. */
const PLACE_STORES: readonly Component<unknown>[] = [Position];

const ROLE_GARRISON = 1;
const ROLE_POST = 2;

/**
 * Which garrison holds its post ({@link mannedPostOf}), kept per world from change feeds over the stores
 * that answer reads, so a pass costs the garrisons and posts that changed rather than every posted man.
 * Derived state, never hashed; the registered verifier re-derives it.
 */
export class MannedPosts {
  /** Every {@link Garrison} holder's post as of the last {@link sync}. */
  private readonly postOf = new Map<Entity, Entity>();
  /** The holders manning that post. */
  private readonly manning = new Set<Entity>();
  private readonly menOf = new Map<Entity, Entity[]>();
  /** {@link ROLE_GARRISON} and {@link ROLE_POST} by entity id, so a walker's entry costs one array read. */
  private roles = new Uint8Array(0);
  private built = false;
  private ctx: SystemContext | undefined;
  private readonly changed = (e: Entity): void => {
    const role = this.roleOf(e);
    if ((role & ROLE_POST) !== 0) this.placeMenOf(e);
    if ((role & ROLE_GARRISON) !== 0 || this.world.has(e, Garrison)) this.place(e);
  };
  private readonly moved = (e: Entity): void => {
    const role = this.roleOf(e);
    if ((role & ROLE_POST) !== 0) this.placeMenOf(e);
    if ((role & ROLE_GARRISON) !== 0) this.place(e);
  };

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
    private readonly feed: ChangeFeed,
    private readonly places: ChangeFeed,
  ) {}

  /** Bring the kept answers up to the world as it stands. */
  sync(ctx: SystemContext): void {
    this.ctx = ctx;
    const lost = !this.built || this.feed.drain(this.changed) || this.places.drain(this.moved);
    if (!lost) return;
    this.feed.drain(() => {});
    this.places.drain(() => {});
    this.postOf.clear();
    this.manning.clear();
    this.menOf.clear();
    this.roles.fill(0);
    for (const e of this.world.query(Garrison)) this.place(e);
    this.built = true;
  }

  /** {@link mannedPostOf}, read off the last {@link sync} unless `e` or its post was written since. */
  mannedPost(ctx: SystemContext, e: Entity): Entity | null {
    const post = this.postOf.get(e);
    if (post === undefined || this.pending(e) || this.pending(post)) return mannedPostOf(this.world, ctx, e);
    return this.manning.has(e) ? post : null;
  }

  /** Hand `visit` every garrison manning its post as of the last {@link sync}, with that post. */
  forEachManning(visit: (e: Entity, post: Entity) => void): void {
    this.visit = visit;
    this.manning.forEach(this.visitManning);
    this.visit = undefined;
  }

  private visit: ((e: Entity, post: Entity) => void) | undefined;
  private readonly visitManning = (e: Entity): void => {
    const post = this.postOf.get(e);
    if (post !== undefined) this.visit?.(e, post);
  };

  verify(): string[] {
    const { world, ctx } = this;
    if (!this.built || ctx === undefined) return [];
    const waiting = new Set<Entity>();
    const note = (e: Entity): void => {
      waiting.add(e);
    };
    if (this.feed.peek(note) || this.places.peek(note)) return [];
    for (const e of world.query(Garrison)) {
      const { post } = world.get(e, Garrison);
      if (waiting.has(e) || waiting.has(post)) continue;
      if (this.postOf.get(e) !== post) return [`combatMannedPosts holds a stale post for ${e}`];
      if (this.manning.has(e) !== (mannedPostOf(world, ctx, e) !== null)) {
        return [`combatMannedPosts holds a stale answer for ${e} - it changed without a feed entry`];
      }
    }
    for (const e of this.postOf.keys()) {
      if (!waiting.has(e) && !world.has(e, Garrison)) return [`combatMannedPosts still holds ${e}`];
    }
    return [];
  }

  private pending(e: Entity): boolean {
    return this.feed.has(e) || this.places.has(e);
  }

  private roleOf(e: Entity): number {
    return this.roles[e] ?? 0;
  }

  private setRole(e: Entity, role: number, on: boolean): void {
    if (e >= this.roles.length) {
      const grown = new Uint8Array(Math.max(e + 1, 2 * this.roles.length));
      grown.set(this.roles);
      this.roles = grown;
    }
    const held = this.roles[e] ?? 0;
    this.roles[e] = on ? held | role : held & ~role;
  }

  private placeMenOf(post: Entity): void {
    const men = this.menOf.get(post);
    if (men === undefined) return;
    // Copied: placing a man whose Garrison moved on edits the list.
    for (const e of [...men]) this.place(e);
  }

  /** Bring `e`'s entry in line with the world: track, re-post, re-answer or drop it. */
  private place(e: Entity): void {
    const post = this.world.tryGet(e, Garrison)?.post;
    const held = this.postOf.get(e);
    if (held !== post) {
      if (held !== undefined) this.untrack(e, held);
      if (post !== undefined) this.track(e, post);
    }
    if (post === undefined || this.ctx === undefined) return;
    if (mannedPostOf(this.world, this.ctx, e) !== null) this.manning.add(e);
    else this.manning.delete(e);
  }

  private track(e: Entity, post: Entity): void {
    this.postOf.set(e, post);
    this.setRole(e, ROLE_GARRISON, true);
    this.setRole(post, ROLE_POST, true);
    const men = this.menOf.get(post);
    if (men === undefined) this.menOf.set(post, [e]);
    else men.push(e);
  }

  private untrack(e: Entity, post: Entity): void {
    this.postOf.delete(e);
    this.manning.delete(e);
    this.setRole(e, ROLE_GARRISON, false);
    const men = this.menOf.get(post);
    if (men === undefined) return;
    const at = men.indexOf(e);
    if (at >= 0) men.splice(at, 1);
    if (men.length > 0) return;
    this.menOf.delete(post);
    this.setRole(post, ROLE_POST, false);
  }
}

const mannedPosts = new WeakMap<World, MannedPosts>();

/** The world's {@link MannedPosts}; a caller syncs it before reading. */
export function mannedPostsOf(world: World, content: ContentSet): MannedPosts {
  const held = mannedPosts.get(world);
  if (held !== undefined && held.content === content) return held;
  const posts = new MannedPosts(
    world,
    content,
    world.watchChanges(POST_MEMBERSHIP, POST_VALUES),
    world.watchChanges(PLACE_STORES, PLACE_STORES),
  );
  mannedPosts.set(world, posts);
  world.registerCacheVerifier('combatMannedPosts', () => mannedPosts.get(world)?.verify() ?? []);
  return posts;
}
