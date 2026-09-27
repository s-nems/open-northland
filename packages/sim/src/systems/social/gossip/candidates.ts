import type { ContentSet } from '@open-northland/data';
import { Age, Person, Position, Settler, settlerTradeLog } from '../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import { isFighterJob } from '../../readviews/index.js';
import { NodeBuckets } from '../../spatial/nodes.js';

/** The held `hx` of an entity that is not a candidate: the Int32 minimum, which no node's `hx` reaches. An
 *  off-map settler's node is negative, so no smaller sentinel is safe. */
const NOT_HELD = -(2 ** 31);

/**
 * The world's settlers statically able to gossip, bucketed by node and kept across ticks from change
 * feeds. A candidate is an adult (approximation: children do not chat) and employed non-fighter, the
 * soldier and hero `forbidatomic` exclusion; per-candidate dynamic state is checked at accept time.
 */
class ChatEligible {
  readonly buckets: NodeBuckets;
  /** Each candidate's node by entity id, {@link NOT_HELD} in `hxs` for the rest: the move feed asks this
   *  for every walker each tick. */
  private hxs = new Int32Array(0);
  private hys = new Int32Array(0);
  /** Adds and removals of the stores eligibility reads. */
  private readonly membership: ChangeFeed;
  /** Position writes, which move a held candidate but never change who is one. */
  private readonly moves: ChangeFeed;
  /** Job changes: the needs drain writes every Settler each tick, so no feed watches its value. */
  private readonly jobChanges: Set<Entity>;
  /** The pass whose catch-up the buckets hold. */
  heldFor: GossipCandidates | null = null;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
  ) {
    this.membership = world.watchChanges([Person, Position, Settler, Age], []);
    this.moves = world.watchChanges([], [Position]);
    this.jobChanges = settlerTradeLog(world, 'gossipCandidates');
    this.buckets = new NodeBuckets(world, []);
    this.rebuild();
  }

  catchUp(): void {
    let lost = this.membership.pending && this.membership.drain((e) => this.refresh(e));
    for (const e of this.jobChanges) this.refresh(e);
    this.jobChanges.clear();
    if (this.moves.pending && this.moves.drain((e) => this.move(e))) lost = true;
    if (lost) this.rebuild();
  }

  private refresh(e: Entity): void {
    const p = isCandidate(this.world, this.content, e) ? this.world.tryGet(e, Position) : undefined;
    if (p === undefined) this.release(e);
    else this.hold(e, nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
  }

  /** Runs after the membership and job changes, so only a held entity can be a candidate. */
  private move(e: Entity): void {
    if ((this.hxs[e] ?? NOT_HELD) === NOT_HELD) return;
    const p = this.world.tryGet(e, Position);
    // A removal after the write, which the membership feed carries.
    if (p === undefined) return;
    this.hold(e, nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
  }

  private hold(e: Entity, hx: number, hy: number): void {
    const heldX = this.hxs[e] ?? NOT_HELD;
    const heldY = this.hys[e] ?? 0;
    if (heldX === hx && heldY === hy) return;
    if (heldX !== NOT_HELD) this.buckets.remove(e, heldX, heldY);
    this.buckets.insert(e, hx, hy);
    if (e >= this.hxs.length) this.grow(e);
    this.hxs[e] = hx;
    this.hys[e] = hy;
  }

  private release(e: Entity): void {
    const heldX = this.hxs[e] ?? NOT_HELD;
    if (heldX === NOT_HELD) return;
    this.buckets.remove(e, heldX, this.hys[e] ?? 0);
    this.hxs[e] = NOT_HELD;
  }

  private grow(e: Entity): void {
    const size = Math.max(this.world.nextEntityId, e + 1, 2 * this.hxs.length);
    const hxs = new Int32Array(size).fill(NOT_HELD);
    hxs.set(this.hxs);
    const hys = new Int32Array(size);
    hys.set(this.hys);
    this.hxs = hxs;
    this.hys = hys;
  }

  private rebuild(): void {
    this.hxs.fill(NOT_HELD);
    const candidates = freshCandidates(this.world, this.content);
    this.buckets.refill(this.world, candidates);
    for (const e of candidates) {
      const p = this.world.get(e, Position);
      if (e >= this.hxs.length) this.grow(e);
      this.hxs[e] = nodeHxOfPosition(p.x, p.y);
      this.hys[e] = nodeHyOfPosition(p.y);
    }
  }

  verify(): string[] {
    this.catchUp();
    const fresh = new NodeBuckets(this.world, freshCandidates(this.world, this.content));
    const problems: string[] = [];
    let freshNodes = 0;
    for (const { x, y, entities } of fresh.buckets()) {
      freshNodes++;
      const held = this.buckets.at(x, y);
      if (held.length !== entities.length || held.some((e, i) => entities[i] !== e)) {
        problems.push(`gossipCandidates node (${x}, ${y}) is stale`);
      }
    }
    let heldNodes = 0;
    for (const _ of this.buckets.buckets()) heldNodes++;
    if (heldNodes !== freshNodes) {
      problems.push(`gossipCandidates holds ${heldNodes} nodes, a fresh scan finds ${freshNodes}`);
    }
    return problems;
  }
}

function freshCandidates(world: World, content: ContentSet): Entity[] {
  return world.canonicalQuery(Person, Position).filter((e) => isCandidate(world, content, e));
}

function isCandidate(world: World, content: ContentSet, e: Entity): boolean {
  if (!world.has(e, Person) || world.has(e, Age)) return false;
  const s = world.tryGet(e, Settler);
  return s !== undefined && s.jobType !== null && !isFighterJob(content, s.jobType);
}

const eligibleByWorld = new WeakMap<World, ChatEligible>();

function chatEligible(world: World, content: ContentSet): ChatEligible {
  let held = eligibleByWorld.get(world);
  if (held === undefined || held.content !== content) {
    const created = new ChatEligible(world, content);
    world.registerCacheVerifier('gossipCandidates', () => created.verify());
    eligibleByWorld.set(world, created);
    held = created;
  }
  return held;
}

/**
 * One planner pass's view of the chat-candidate buckets: caught up on the pass's first partner search, so
 * a tick with nobody lonely pays nothing, and held as of that moment for the rest of the pass. The buckets
 * are shared per world, so a pass catches them up again when another one did last.
 */
export class GossipCandidates {
  constructor(
    private readonly world: World,
    private readonly content: ContentSet,
  ) {}

  ensure(): NodeBuckets {
    const eligible = chatEligible(this.world, this.content);
    if (eligible.heldFor !== this) {
      eligible.catchUp();
      eligible.heldFor = this;
    }
    return eligible.buckets;
  }
}
