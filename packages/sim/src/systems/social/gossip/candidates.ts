import type { ContentSet } from '@open-northland/data';
import { Age, Person, Position, Settler, settlerTradeLog } from '../../../components/index.js';
import type { Fixed } from '../../../core/fixed.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { isFighterJob } from '../../readviews/index.js';
import { HeldNodes, NO_NODE } from '../../spatial/held-nodes.js';
import { moverNode } from '../../spatial/mover-node.js';
import { type NodeMoveFeed, watchNodeMoves } from '../../spatial/node-moves.js';

/** Nodes per side of a candidate block, as a shift: a walker re-files only when it crosses into another
 *  block, and a search reads the blocks its range overlaps. */
const BLOCK_SHIFT = 3;
/** Packs a block's coordinates into one map key; the bias keeps an off-map block's negative ones apart. */
const BLOCK_KEY_STRIDE = 1 << 16;
const BLOCK_KEY_BIAS = 1 << 15;

function blockKey(hx: number, hy: number): number {
  return ((hx >> BLOCK_SHIFT) + BLOCK_KEY_BIAS) * BLOCK_KEY_STRIDE + ((hy >> BLOCK_SHIFT) + BLOCK_KEY_BIAS);
}

/**
 * The world's settlers statically able to gossip, filed by node block and kept across ticks from change
 * feeds. A candidate is an adult (approximation: children do not chat) and employed non-fighter, the
 * soldier and hero `forbidatomic` exclusion; per-candidate dynamic state is checked at accept time.
 */
export class ChatCandidates {
  /** Each candidate's node, {@link NO_NODE} for the rest: the move feed asks this for every walker each
   *  tick. */
  private readonly nodes = new HeldNodes();
  /** Each candidate's index in its block's list, which keeps no order, so a removal swaps in the last. */
  private slots = new Int32Array(0);
  /** Candidates by {@link blockKey}; an emptied block keeps its list for the next walker in. */
  private readonly blocks = new Map<number, Entity[]>();
  /** Adds and removals of the stores eligibility reads. */
  private readonly membership: ChangeFeed;
  /** Node changes, which move a held candidate but never change who is one. */
  private readonly moves: NodeMoveFeed;
  /** Job changes, taken from the settler trade log instead of a Settler value feed. */
  private readonly jobChanges: Set<Entity>;
  /** The pass whose catch-up the blocks hold. */
  heldFor: GossipCandidates | null = null;

  constructor(
    private readonly world: World,
    readonly content: ContentSet,
  ) {
    this.membership = world.watchChanges([Person, Position, Settler, Age], []);
    this.moves = watchNodeMoves(world);
    this.jobChanges = settlerTradeLog(world, 'gossipCandidates');
    this.rebuild();
  }

  catchUp(): void {
    let lost = this.membership.pending && this.membership.drain((e) => this.refresh(e));
    for (const e of this.jobChanges) this.refresh(e);
    this.jobChanges.clear();
    if (this.moves.pending && this.moves.drain((e) => this.move(e))) lost = true;
    if (lost) this.rebuild();
  }

  /**
   * The candidate nearest node `(fromX, fromY)` by Manhattan node distance within `minDist..maxDist` that
   * `accept` passes, the lower entity id on a tie, or null. `accept` must be a pure read: it is asked
   * only of a candidate that would beat the best so far, in no fixed order.
   */
  nearest(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
  ): Entity | null {
    const { nodes } = this;
    let best: Entity | null = null;
    let bestDist = 0;
    const maxBx = (fromX + maxDist) >> BLOCK_SHIFT;
    const minBy = (fromY - maxDist) >> BLOCK_SHIFT;
    const maxBy = (fromY + maxDist) >> BLOCK_SHIFT;
    for (let bx = (fromX - maxDist) >> BLOCK_SHIFT; bx <= maxBx; bx++) {
      for (let by = minBy; by <= maxBy; by++) {
        const list = this.blocks.get((bx + BLOCK_KEY_BIAS) * BLOCK_KEY_STRIDE + (by + BLOCK_KEY_BIAS));
        if (list === undefined) continue;
        for (let i = 0; i < list.length; i++) {
          const e = list[i] as Entity;
          const d = Math.abs(nodes.hx(e) - fromX) + Math.abs(nodes.hy(e) - fromY);
          if (d < minDist || d > maxDist) continue;
          if (best !== null && (d > bestDist || (d === bestDist && e > best))) continue;
          if (accept(e)) {
            best = e;
            bestDist = d;
          }
        }
      }
    }
    return best;
  }

  private refresh(e: Entity): void {
    const p = isCandidate(this.world, this.content, e) ? this.world.tryGet(e, Position) : undefined;
    if (p === undefined) this.release(e);
    else this.holdAt(e, p);
  }

  /** Runs after the membership and job changes, so only a held entity can be a candidate. */
  private move(e: Entity): void {
    if (this.nodes.hx(e) === NO_NODE) return;
    const hx = this.moves.heldHx(e);
    // A removal after the write, which the membership feed carries.
    if (hx === NO_NODE) return;
    this.hold(e, hx, this.moves.heldHy(e));
  }

  private holdAt(e: Entity, p: { readonly x: Fixed; readonly y: Fixed }): void {
    const node = moverNode(this.world, e, p);
    this.hold(e, node.hx, node.hy);
  }

  private hold(e: Entity, hx: number, hy: number): void {
    const heldX = this.nodes.hx(e);
    const heldY = this.nodes.hy(e);
    if (heldX === hx && heldY === hy) return;
    this.nodes.set(e, hx, hy, this.world.nextEntityId);
    const key = blockKey(hx, hy);
    if (heldX === NO_NODE || blockKey(heldX, heldY) !== key) {
      if (heldX !== NO_NODE) this.unfile(e, heldX, heldY);
      this.file(e, key);
    }
  }

  private release(e: Entity): void {
    const heldX = this.nodes.hx(e);
    if (heldX === NO_NODE) return;
    this.unfile(e, heldX, this.nodes.hy(e));
    this.nodes.set(e, NO_NODE, 0, this.world.nextEntityId);
  }

  private file(e: Entity, key: number): void {
    if (e >= this.slots.length) this.growSlots(e);
    let list = this.blocks.get(key);
    if (list === undefined) {
      list = [];
      this.blocks.set(key, list);
    }
    this.slots[e] = list.length;
    list.push(e);
  }

  private unfile(e: Entity, hx: number, hy: number): void {
    const list = this.blocks.get(blockKey(hx, hy));
    if (list === undefined) return;
    const slot = this.slots[e] as number;
    const last = list.pop() as Entity;
    if (last !== e) {
      list[slot] = last;
      this.slots[last] = slot;
    }
  }

  private growSlots(e: Entity): void {
    const slots = new Int32Array(Math.max(this.world.nextEntityId, e + 1, 2 * this.slots.length));
    slots.set(this.slots);
    this.slots = slots;
  }

  private rebuild(): void {
    this.nodes.clear();
    for (const list of this.blocks.values()) list.length = 0;
    for (const e of freshCandidates(this.world, this.content)) {
      const p = this.world.get(e, Position);
      this.holdAt(e, p);
    }
  }

  verify(): string[] {
    this.catchUp();
    const fresh = freshCandidates(this.world, this.content);
    for (const e of fresh) {
      const { hx, hy } = moverNode(this.world, e, this.world.get(e, Position));
      const list = this.blocks.get(blockKey(hx, hy));
      if (this.nodes.hx(e) !== hx || this.nodes.hy(e) !== hy || list?.[this.slots[e] as number] !== e) {
        return [`gossipCandidates holds ${e} off its node (${hx}, ${hy})`];
      }
    }
    let held = 0;
    for (const list of this.blocks.values()) held += list.length;
    return held === fresh.length
      ? []
      : [`gossipCandidates holds ${held}, a fresh scan finds ${fresh.length}`];
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

const eligibleByWorld = new WeakMap<World, ChatCandidates>();

function chatEligible(world: World, content: ContentSet): ChatCandidates {
  let held = eligibleByWorld.get(world);
  if (held === undefined || held.content !== content) {
    const created = new ChatCandidates(world, content);
    world.registerCacheVerifier('gossipCandidates', () => created.verify());
    eligibleByWorld.set(world, created);
    held = created;
  }
  return held;
}

/**
 * One planner pass's view of the chat candidates: caught up on the pass's first partner search, so a tick
 * with nobody lonely pays nothing, and held as of that moment for the rest of the pass. The candidates are
 * shared per world, so a pass catches them up again when another one did last.
 */
export class GossipCandidates {
  constructor(
    private readonly world: World,
    private readonly content: ContentSet,
  ) {}

  ensure(): ChatCandidates {
    const eligible = chatEligible(this.world, this.content);
    if (eligible.heldFor !== this) {
      eligible.catchUp();
      eligible.heldFor = this;
    }
    return eligible;
  }
}
