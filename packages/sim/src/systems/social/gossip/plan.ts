import type { ContentSet } from '@open-northland/data';
import {
  Age,
  Carrying,
  Chat,
  ChatCooldown,
  CurrentAtomic,
  Engagement,
  FamilyDuty,
  Fleeing,
  ownerOf,
  Person,
  PlayerOrder,
  Position,
  Resting,
  Settler,
  type SettlerIdentity,
  Wedding,
} from '../../../components/index.js';
import { type Fixed, fx } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition, nodesAdjacent } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { isFighterJob } from '../../readviews/index.js';
import { FATIGUE_SLEEP_THRESHOLD, HUNGER_EAT_THRESHOLD } from '../../settlers/drives/needs.js';
import { canonicalById, isTravelling, NodeBuckets } from '../../spatial/nodes.js';

/** Company deficit at or above which a working settler leaves its work to find a chat partner, ¾ of a full
 *  bar, mirroring the eat/sleep/pray triggers in `drives/needs.ts` on the same approximation basis. */
const CHAT_SEEK_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4));

/** How far in half-cell nodes a lonely working settler searches. Authored: a bounded ring search. */
const CHAT_SEEK_RADIUS_NODES = 32;

/** Partner searches start at ring 1: a candidate stacked on the seeker's own node is skipped, since a pair
 *  chatting from one node stands inside each other. */
const CHAT_PARTNER_MIN_DIST_NODES = 1;

/** The idle-chat search covers exactly the adjacent lattice nodes: {@link nodesAdjacent} is Chebyshev 1, so
 *  Manhattan ring 2 is needed to reach the diagonals and the accept filter drops the (2,0) points. */
const CHAT_IDLE_MAX_RING = 2;

/** How far in half-cell nodes an idle settler may wander to a distant partner once its
 *  {@link CHAT_IDLE_WALK_MEAN_WAIT_TICKS} roll fires. Authored value, about 6 cells. */
const CHAT_IDLE_WALK_RADIUS_NODES = 12;

/** Mean ticks an idle settler stands before deciding to wander to a distant partner, a per-tick `1/N` seeded
 *  roll so idle chatter never herds standing crowds into one heap. Authored value, ~20 s at the 12 Hz tick. */
const CHAT_IDLE_WALK_MEAN_WAIT_TICKS = 240;

/** Whether `e` is still inside its post-chat breather at `tick`. Expired stamps sit until the next chat
 *  overwrites them, so reading is pure. */
function chatCooldownActive(world: World, tick: number, e: Entity): boolean {
  const cd = world.tryGet(e, ChatCooldown);
  return cd !== undefined && cd.until > tick;
}

/**
 * Lazily built per-tick chat-candidate buckets: every settler statically able to gossip, which is an adult
 * (approximation: children do not chat) and employed non-fighter, the soldier and hero `forbidatomic`
 * exclusion. Built on the first settler that looks for a partner, so a tick with nobody lonely pays
 * nothing; per-candidate dynamic state is checked at accept time instead.
 */
export class GossipCandidates {
  private buckets: NodeBuckets | null = null;
  constructor(
    private readonly world: World,
    private readonly content: ContentSet,
  ) {}

  ensure(): NodeBuckets {
    if (this.buckets === null) {
      const eligible = canonicalById(this.world.query(Person, Position)).filter((e) => {
        const s = this.world.get(e, Settler);
        return s.jobType !== null && !isFighterJob(this.content, s.jobType) && !this.world.has(e, Age);
      });
      this.buckets = new NodeBuckets(this.world, eligible);
    }
    return this.buckets;
  }
}

/** Whether `e` may be pulled into a chat right now: unclaimed, hands free, out of its post-chat breather,
 *  and not needing food or sleep more than company, since a survival need would cancel the chat at once. */
function mayJoinChat(world: World, tick: number, e: Entity): boolean {
  if (chatCooldownActive(world, tick, e)) return false;
  if (
    world.has(e, Chat) ||
    world.has(e, Wedding) ||
    world.has(e, FamilyDuty) ||
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, PlayerOrder) ||
    world.has(e, Resting) ||
    world.has(e, Carrying) ||
    world.has(e, CurrentAtomic)
  ) {
    return false;
  }
  const s = world.get(e, Settler);
  return s.hunger < HUNGER_EAT_THRESHOLD && s.fatigue < FATIGUE_SLEEP_THRESHOLD;
}

/** Stamp the mirrored {@link Chat} pair - the seeker (who walks, and whose refill ends the chat) speaks
 *  the first round. */
function startChat(world: World, seeker: Entity, partner: Entity): void {
  world.add(seeker, Chat, { partner, seeker: true, talking: false, speaks: true });
  world.add(partner, Chat, { partner: seeker, seeker: false, talking: false, speaks: false });
}

/** The seek and idle rungs' shared partner predicate: a same-owner settler standing free and not walking
 *  anywhere. One home, so partner eligibility cannot drift between the two rungs. */
function idlePartnerFilter(
  world: World,
  tick: number,
  seeker: Entity,
  owner: number,
): (cand: Entity) => boolean {
  return (cand) =>
    cand !== seeker &&
    ownerOf(world, cand) === owner &&
    mayJoinChat(world, tick, cand) &&
    !isTravelling(world, cand);
}

/**
 * The working settler's company rung: at or above {@link CHAT_SEEK_THRESHOLD} it leaves its work and claims
 * the nearest same-owner chat-free settler, preferring an idle one over grabbing one mid-errand. Only
 * partners are gated on {@link Carrying}: a grabbed half needs its hands free, a desperate seeker chats with
 * its load still in hand.
 */
export function planGossipSeek(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity & { enjoyment: Fixed },
  hx: number,
  hy: number,
  candidates: GossipCandidates,
): boolean {
  if (settler.enjoyment < CHAT_SEEK_THRESHOLD) return false;
  if (settler.jobType === null || isFighterJob(ctx.content, settler.jobType)) return false;
  if (chatCooldownActive(world, ctx.tick, e)) return false;
  // Only owned settlers gossip, so unowned golden fixtures stay byte-identical, and partners must share
  // the owner.
  const owner = ownerOf(world, e);
  if (owner === undefined) return false;
  const buckets = candidates.ensure();
  const idle = idlePartnerFilter(world, ctx.tick, e, owner);
  const grabbable = (cand: Entity): boolean =>
    cand !== e && ownerOf(world, cand) === owner && mayJoinChat(world, ctx.tick, cand);
  const found =
    buckets.nearest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, CHAT_SEEK_RADIUS_NODES, idle) ??
    buckets.nearest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, CHAT_SEEK_RADIUS_NODES, grabbable);
  if (found === null) return false;
  startChat(world, e, found.entity);
  return true;
}

/**
 * The idle-settler chat rung at the bottom of the drive ladder: an idle settler chats even on a full company
 * bar, since the original's settlements visibly chatter. An adjacent partner is chatted up in place at once,
 * while a partner within {@link CHAT_IDLE_WALK_RADIUS_NODES} is only walked to once the
 * {@link CHAT_IDLE_WALK_MEAN_WAIT_TICKS} roll fires, so idlers stand around between chats.
 */
export function planGossipIdle(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  hx: number,
  hy: number,
  candidates: GossipCandidates,
): boolean {
  if (settler.jobType === null || isFighterJob(ctx.content, settler.jobType)) return false;
  if (chatCooldownActive(world, ctx.tick, e)) return false;
  // The owner gate sits before the wander roll below, so unowned fixtures consume no RNG and stay
  // byte-identical.
  const owner = ownerOf(world, e);
  if (owner === undefined) return false;
  const here = { hx, hy };
  const idle = idlePartnerFilter(world, ctx.tick, e, owner);
  const idleBeside = (cand: Entity): boolean => {
    if (!idle(cand)) return false;
    const p = world.get(cand, Position);
    return nodesAdjacent(nodeOfPosition(p.x, p.y), here);
  };
  const buckets = candidates.ensure();
  const beside = buckets.nearest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, CHAT_IDLE_MAX_RING, idleBeside);
  if (beside !== null) {
    startChat(world, e, beside.entity);
    return true;
  }
  if (ctx.rng.int(CHAT_IDLE_WALK_MEAN_WAIT_TICKS) !== 0) return false;
  const distant = buckets.nearest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, CHAT_IDLE_WALK_RADIUS_NODES, idle);
  if (distant === null) return false;
  startChat(world, e, distant.entity);
  return true;
}
