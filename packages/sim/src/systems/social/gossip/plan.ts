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
import { FATIGUE_SLEEP_THRESHOLD, HUNGER_EAT_THRESHOLD } from '../../agents/drives-needs.js';
import type { SystemContext } from '../../context.js';
import { isFighterJob } from '../../readviews/index.js';
import { canonicalById, isTravelling, NodeBuckets } from '../../spatial.js';

/**
 * The gossip PLANNER half — the rungs that START a chat (see `index.ts` for the mechanic's source
 * basis): the deficit-driven {@link planGossipSeek} and the bottom-of-ladder {@link planGossipIdle},
 * with their shared candidate machinery. The started pair is then driven per tick by `drive.ts`.
 */

/** Company deficit at or above which a WORKING settler leaves its work to find a chat partner — ¾ of a
 *  full bar, mirroring the eat/sleep/pray triggers (`drives-needs.ts`; the same approximation basis). */
const CHAT_SEEK_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4));

/** How far (half-cell nodes) a lonely working settler searches for a partner. Design rule: a bounded
 *  neighbourhood ring search, not a map scan. */
const CHAT_SEEK_RADIUS_NODES = 32;

/** Partner searches start at ring 1: a candidate stacked on the seeker's own node is skipped — the
 *  de-stack drive is about to step it aside, and a pair chatting from one node stands inside each other. */
const CHAT_PARTNER_MIN_DIST_NODES = 1;

/** The idle-chat search covers exactly the adjacent lattice nodes ({@link nodesAdjacent}: Chebyshev 1 —
 *  Manhattan ring 2 reaches the diagonals, the accept filter drops the ring's non-adjacent (2,0) points).
 *  An idle settler chats with a NEIGHBOUR immediately and in place; walking to more distant company is
 *  the paced wander below, so idle chatter never instantly perturbs a standing formation. */
const CHAT_IDLE_MAX_RING = 2;

/** How far (half-cell nodes, ~6 cells) an idle settler may wander to reach a distant idle partner once
 *  its {@link CHAT_IDLE_WALK_MEAN_WAIT_TICKS} roll fires (design value — near enough to feel local). */
const CHAT_IDLE_WALK_RADIUS_NODES = 12;

/** Mean ticks an idle settler stands before deciding to wander to a distant partner — a per-tick `1/N`
 *  seeded roll, so idlers mostly stay put and idle chatter never herds standing crowds into one heap
 *  (design value, ~20 s at the 12 Hz tick; adjacent neighbours still chat at once with no roll). */
const CHAT_IDLE_WALK_MEAN_WAIT_TICKS = 240;

/** Whether `e` is still inside its post-chat breather at `tick` (the {@link ChatCooldown} stamped by the
 *  drive half's endChat). Expired stamps just sit until the next chat overwrites them — reading is pure,
 *  no removal. */
function chatCooldownActive(world: World, tick: number, e: Entity): boolean {
  const cd = world.tryGet(e, ChatCooldown);
  return cd !== undefined && cd.until > tick;
}

/**
 * Lazily-built per-tick chat-candidate buckets: every settler statically able to gossip (adult, employed,
 * not a fighter — the soldier/hero `forbidatomic` exclusion; dropping `Age` holders is the named
 * children-don't-chat approximation, see the module doc), bucketed by node for the ring searches. Built
 * on the first settler that actually looks for a partner, so a tick with nobody lonely pays nothing;
 * per-candidate dynamic state (busy, claimed, mid-wedding) is checked at accept time instead.
 */
export class GossipCandidates {
  private buckets: NodeBuckets | null = null;
  constructor(private readonly world: World) {}

  ensure(): NodeBuckets {
    if (this.buckets === null) {
      const eligible = canonicalById(this.world.query(Settler, Position)).filter((e) => {
        const s = this.world.get(e, Settler);
        return s.jobType !== null && !isFighterJob(s.jobType) && !this.world.has(e, Age);
      });
      this.buckets = new NodeBuckets(this.world, eligible);
    }
    return this.buckets;
  }
}

/** Whether `e` may be pulled into a chat right now: not already claimed by a chat/wedding/family duty,
 *  not combat-held or player-ordered, not hidden inside a building, hands free, not mid-animation, not
 *  in its post-chat breather, and not needing food/sleep more than company (a pressing survival need
 *  would cancel the chat at once). */
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

/** Stamp the mirrored {@link Chat} pair — the seeker (who walks, and whose refill ends the chat) speaks
 *  the first round. */
function startChat(world: World, seeker: Entity, partner: Entity): void {
  world.add(seeker, Chat, { partner, seeker: true, talking: false, speaks: true });
  world.add(partner, Chat, { partner: seeker, seeker: false, talking: false, speaks: false });
}

/** The seek/idle rungs' shared partner predicate: an eligible same-owner settler standing free — chat-free
 *  ({@link mayJoinChat}) and not walking anywhere. One home so partner eligibility can't drift between the
 *  two rungs. */
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
 * The working settler's company rung: at/above {@link CHAT_SEEK_THRESHOLD} it leaves its work and claims
 * the nearest chat-free settler — preferring an IDLE one (standing, nothing to do), else "grabbing" any
 * eligible one mid-errand (the grabbed half finishes its current swing, then stands and talks). Same-owner
 * only. A CARRYING seeker chats with its load in hand and delivers after (only partners are gated on
 * {@link Carrying} — a grabbed half must have its hands free, a desperate seeker needn't). Returns `true`
 * when a chat was started (the settler is spoken for this tick).
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
  if (settler.jobType === null || isFighterJob(settler.jobType)) return false;
  if (chatCooldownActive(world, ctx.tick, e)) return false;
  // Owner-gated like deStackIdle: only player-owned settlers gossip, so unowned golden/economy fixtures
  // stay byte-identical; partners must share the owner (nobody chats up the enemy).
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
 * The idle-settler chat rung, at the very bottom of the drive ladder: a settler with nothing at all to do
 * strikes up a chat with another idle settler — even on a full company bar, idle neighbours gossip because
 * why not (the original's settlements visibly chatter; design rule). A partner ALREADY STANDING BESIDE it
 * ({@link nodesAdjacent}) is chatted up at once, in place; a more distant idle partner (within
 * {@link CHAT_IDLE_WALK_RADIUS_NODES}) is only wandered to after the {@link CHAT_IDLE_WALK_MEAN_WAIT_TICKS}
 * roll fires, so idlers visibly stand around between chats instead of perpetually herding together.
 * Returns `true` when a chat was started.
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
  if (settler.jobType === null || isFighterJob(settler.jobType)) return false;
  if (chatCooldownActive(world, ctx.tick, e)) return false;
  // Owner-gated like the seek rung (and deStackIdle) — see planGossipSeek. The gate sits before the
  // wander roll below, so unowned golden fixtures consume no RNG and stay byte-identical.
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
