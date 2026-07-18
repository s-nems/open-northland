import {
  Age,
  Carrying,
  Chat,
  ChatCooldown,
  CurrentAtomic,
  Engagement,
  FamilyDuty,
  Fleeing,
  MoveGoal,
  ownerOf,
  PathRequest,
  PlayerOrder,
  Position,
  Resting,
  Settler,
  type SettlerIdentity,
  Wedding,
} from '../../components/index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, nodesAdjacent } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { startAtomic } from '../agents/actions.js';
import { FATIGUE_SLEEP_THRESHOLD, HUNGER_EAT_THRESHOLD } from '../agents/drives-needs.js';
import type { System, SystemContext } from '../context.js';
import {
  atomicAnimationName,
  atomicDurationForName,
  atomicEventChannelDelta,
} from '../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, atomicAnimationByName, isFighterJob } from '../readviews/index.js';
import { canonicalById, clearNavState, isTravelling, NodeBuckets } from '../spatial.js';

/**
 * GOSSIP — the company need's self-satisfying drive: settlers pair up and talk. The original satisfies
 * the SOCIAL bar only through the talk/monologuize/listen atomics (their animations fire `event <at> 3
 * <delta>` pulses — `atomicanimations.ini`), with no building satisfier; soldiers are the one class that
 * cannot (`jobtypes.ini` soldier `forbidatomic 13/14/15`), while scouts inherit the civilist set and
 * gossip like anyone. This module is both halves of that mechanic: the planner rungs that START a chat
 * ({@link planGossipSeek}/{@link planGossipIdle}) and the {@link gossipSystem} that drives every standing
 * {@link Chat} pair (walk together, alternate talk/listen on adjacent cells, pulse the bar back down).
 */

/** The paired talk/listen atomic ids — `logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_TALK = 14` /
 *  `LISTEN = 15`, bound per tribe in `tribetypes.ini` (`setatomic 5/6 14 "..._talk"`, `... 15 "..._listen"`). */
export const TALK_ATOMIC_ID = 14;
export const LISTEN_ATOMIC_ID = 15;

/** Company deficit at or above which a WORKING settler leaves its work to find a chat partner — ¾ of a
 *  full bar, mirroring the eat/sleep/pray triggers (`drives-needs.ts`; the same approximation basis). */
const CHAT_SEEK_THRESHOLD: Fixed = fx.div(fx.fromInt(3), fx.fromInt(4));

/**
 * A chat ENDS once the seeker's deficit falls below this bound, 10% of a full bar (design rule: the last
 * pulses land near 0, but the bar keeps rising a hair per tick mid-round, so an exact `=== 0` test would
 * never pass). Ending the chat hands the pair back to the planner between rounds — work can reclaim them;
 * a pair still idle simply strikes up the next chat.
 */
const CHAT_SATISFIED_DEFICIT: Fixed = fx.div(ONE, fx.fromInt(10));

/** How far (half-cell nodes) a lonely working settler searches for a partner. Design rule: a bounded
 *  neighbourhood ring search, not a map scan. */
const CHAT_SEEK_RADIUS_NODES = 32;

/** Partner searches start at ring 1: a candidate stacked on the seeker's own node is skipped — the
 *  de-stack drive is about to step it aside, and a pair chatting from one node stands inside each other. */
const CHAT_PARTNER_MIN_DIST_NODES = 1;

/** The idle-chat search covers exactly the adjacent lattice nodes ({@link nodesAdjacent}: Chebyshev 1 —
 *  Manhattan ring 2 reaches the diagonals, the accept filter drops the ring's non-adjacent (2,0) points).
 *  An idle settler only chats with a NEIGHBOUR, in place; walking to company is the seek drive's move,
 *  so idle chatter never perturbs a standing formation. */
const CHAT_IDLE_MAX_RING = 2;

/** How long (ticks) after a chat ends before either half chats again — the {@link ChatCooldown} breather
 *  that lets the freed settlers' own work rungs reclaim them (design value, ~2 s of sim time). */
export const CHAT_COOLDOWN_TICKS = 40;

/** Whether `e` is still inside its post-chat breather at `tick`. Expired stamps just sit until the next
 *  chat overwrites them — reading is pure, no removal. */
function chatCooldownActive(world: World, tick: number, e: Entity): boolean {
  const cd = world.tryGet(e, ChatCooldown);
  return cd !== undefined && cd.until > tick;
}

/**
 * The original's social-event scale: +4000 channel units restore one full bar. Basis: the eat animation's
 * one `event 30 2 +4000` maps to the sim's full hunger reset, and the talk animation's five `event <at> 3
 * +800` pulses total the same 4000 — so a full talk clip refills a full company bar, matching the eat
 * precedent (approximated — the engine's internal bar scale is not readable).
 */
const SOCIAL_EVENT_UNITS_PER_BAR = 4000;

/**
 * The civilist job (`jobtypes.ini` `type 6 name "civilist"`) — the base atomic set most trades inherit
 * (`baseatomics 6`). The readable `setatomic` talk/listen bindings exist only for the woman/civilist jobs,
 * so a trade's chat animation resolves through this job, mirroring that inheritance.
 */
const CIVILIST_JOB = 6;

/** Resolve the animation name a settler's tribe binds to a chat atomic, falling back to the tribe's
 *  civilist binding — the `baseatomics 6` inheritance the readable per-trade rows leave implicit. */
function chatAnimationName(ctx: SystemContext, s: SettlerIdentity, atomicId: number): string | undefined {
  return (
    atomicAnimationName(ctx.content, s, atomicId) ??
    atomicAnimationName(ctx.content, { tribe: s.tribe, jobType: CIVILIST_JOB }, atomicId)
  );
}

/** A chat atomic's duration (ticks) through the civilist-fallback name resolution above. */
function chatDuration(ctx: SystemContext, s: SettlerIdentity, atomicId: number): number {
  return atomicDurationForName(ctx.content, chatAnimationName(ctx, s, atomicId));
}

/**
 * Lazily-built per-tick chat-candidate buckets: every settler statically able to gossip (adult, employed,
 * not a fighter — the soldier/hero `forbidatomic` exclusion), bucketed by node for the ring searches. Built
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

/**
 * The working settler's company rung: at/above {@link CHAT_SEEK_THRESHOLD} it leaves its work and claims
 * the nearest chat-free settler — preferring an IDLE one (standing, nothing to do), else "grabbing" any
 * eligible one mid-errand (the grabbed half finishes its current swing, then stands and talks). Same-owner
 * only. Returns `true` when a chat was started (the settler is spoken for this tick).
 */
export function planGossipSeek(
  world: World,
  tick: number,
  e: Entity,
  settler: SettlerIdentity & { enjoyment: Fixed },
  hx: number,
  hy: number,
  candidates: GossipCandidates,
): boolean {
  if (settler.enjoyment < CHAT_SEEK_THRESHOLD) return false;
  if (settler.jobType === null || isFighterJob(settler.jobType)) return false;
  if (chatCooldownActive(world, tick, e)) return false;
  // Owner-gated like deStackIdle: only player-owned settlers gossip, so unowned golden/economy fixtures
  // stay byte-identical; partners must share the owner (nobody chats up the enemy).
  const owner = ownerOf(world, e);
  if (owner === undefined) return false;
  const buckets = candidates.ensure();
  const idle = (cand: Entity): boolean =>
    cand !== e &&
    ownerOf(world, cand) === owner &&
    mayJoinChat(world, tick, cand) &&
    !isTravelling(world, cand);
  const grabbable = (cand: Entity): boolean =>
    cand !== e && ownerOf(world, cand) === owner && mayJoinChat(world, tick, cand);
  const found =
    buckets.nearest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, CHAT_SEEK_RADIUS_NODES, idle) ??
    buckets.nearest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, CHAT_SEEK_RADIUS_NODES, grabbable);
  if (found === null) return false;
  startChat(world, e, found.entity);
  return true;
}

/**
 * The idle-settler chat rung, at the very bottom of the drive ladder: a settler with nothing at all to do
 * strikes up a chat with an idle settler ALREADY STANDING BESIDE it ({@link nodesAdjacent}) — even on a
 * full company bar, idle neighbours gossip because why not (the original's settlements visibly chatter;
 * design rule). In place only: nobody walks for an idle chat, so standing formations stay put. Returns
 * `true` when a chat was started.
 */
export function planGossipIdle(
  world: World,
  tick: number,
  e: Entity,
  settler: SettlerIdentity,
  hx: number,
  hy: number,
  candidates: GossipCandidates,
): boolean {
  if (settler.jobType === null || isFighterJob(settler.jobType)) return false;
  if (chatCooldownActive(world, tick, e)) return false;
  // Owner-gated like the seek rung (and deStackIdle) — see planGossipSeek.
  const owner = ownerOf(world, e);
  if (owner === undefined) return false;
  const here = { hx, hy };
  const idleBeside = (cand: Entity): boolean => {
    if (cand === e || ownerOf(world, cand) !== owner) return false;
    if (!mayJoinChat(world, tick, cand) || isTravelling(world, cand)) return false;
    const p = world.get(cand, Position);
    return nodesAdjacent(nodeOfPosition(p.x, p.y), here);
  };
  const found = candidates
    .ensure()
    .nearest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, CHAT_IDLE_MAX_RING, idleBeside);
  if (found === null) return false;
  startChat(world, e, found.entity);
  return true;
}

/** Remove a chat from both halves, interrupting any talk/listen atomic in flight (the clips are
 *  `interruptable 1` in the data — a chat never holds a settler against a higher drive), and stamp the
 *  {@link ChatCooldown} breather on both so the freed settlers' own planner passes run before any re-chat. */
function endChat(world: World, tick: number, e: Entity): void {
  const c = world.tryGet(e, Chat);
  if (c !== undefined && world.isAlive(c.partner)) {
    world.remove(c.partner, Chat);
    interruptChatAtomic(world, c.partner);
    world.add(c.partner, ChatCooldown, { until: tick + CHAT_COOLDOWN_TICKS });
  }
  world.remove(e, Chat);
  interruptChatAtomic(world, e);
  world.add(e, ChatCooldown, { until: tick + CHAT_COOLDOWN_TICKS });
}

function interruptChatAtomic(world: World, e: Entity): void {
  if (chatAtomicRunning(world, e)) world.remove(e, CurrentAtomic);
}

/** Whether `e` is currently playing its half of a chat round (a talk or listen atomic in flight). */
function chatAtomicRunning(world: World, e: Entity): boolean {
  const atomic = world.tryGet(e, CurrentAtomic);
  return atomic !== undefined && (atomic.atomicId === TALK_ATOMIC_ID || atomic.atomicId === LISTEN_ATOMIC_ID);
}

/** Whether a higher drive outranks this half's chat: a pressing survival need (the eat/sleep thresholds),
 *  combat taking the settler (engaged, fleeing), a player order, or a family claim (a `marry` command or
 *  duty landing mid-chat). Company outranks none of them — the chat ends and the partner is freed too. */
function chatOutranked(world: World, e: Entity, s: { hunger: Fixed; fatigue: Fixed }): boolean {
  return (
    s.hunger >= HUNGER_EAT_THRESHOLD ||
    s.fatigue >= FATIGUE_SLEEP_THRESHOLD ||
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, PlayerOrder) ||
    world.has(e, Wedding) ||
    world.has(e, FamilyDuty)
  );
}

/**
 * Apply this tick's talk/listen animation pulses to `e`: every `event <elapsed> 3 <delta>` of the clip it
 * is playing takes `delta/4000` off the company deficit ({@link SOCIAL_EVENT_UNITS_PER_BAR}) — the bar
 * visibly refills DURING the conversation, at the original's own event frames, instead of snapping at
 * completion. Clamped at 0.
 */
function applyChatPulse(
  world: World,
  ctx: SystemContext,
  e: Entity,
  s: SettlerIdentity & { enjoyment: Fixed },
): void {
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic === undefined) return;
  if (atomic.atomicId !== TALK_ATOMIC_ID && atomic.atomicId !== LISTEN_ATOMIC_ID) return;
  const name = chatAnimationName(ctx, s, atomic.atomicId);
  if (name === undefined) return;
  const anim = atomicAnimationByName(ctx.content, name);
  if (anim === undefined) return;
  let units = 0;
  for (const event of anim.events) {
    if (event.type === ATOMIC_EVENT_CHANNEL.LEISURE && event.at === atomic.elapsed) units += event.value ?? 0;
  }
  if (units <= 0) return;
  const delta = fx.div(fx.fromInt(units), fx.fromInt(SOCIAL_EVENT_UNITS_PER_BAR));
  s.enjoyment = s.enjoyment > delta ? fx.sub(s.enjoyment, delta) : fx.fromInt(0);
}

/** The clip's total channel-3 restore for this half's next `atomicId` round, in event units — 0 means the
 *  animation (or its events) is unreadable, and the round falls back to a completion reset like eat/sleep. */
function roundRefillUnits(ctx: SystemContext, s: SettlerIdentity, atomicId: number): number {
  const name = chatAnimationName(ctx, s, atomicId);
  return name === undefined ? 0 : atomicEventChannelDelta(ctx.content, name, ATOMIC_EVENT_CHANNEL.LEISURE);
}

/**
 * GossipSystem — drive every {@link Chat} pair one tick (walk to the partner, halt it, run the alternating
 * talk/listen rounds, pulse the company bars, end the chat once the seeker is satisfied). Runs with the
 * family pass's placement — after orders, before the AI planner — so its walks route the same tick and the
 * `Chat` fence is fresh when the planner reads it. Deliberately NOT gated on the {@link needsEnabled}
 * world rule: idle chatter is social flavor, not a need mechanic (with needs off the bar just sits at 0
 * and every round ends satisfied) — only the deficit-driven seek rung belongs to the needs system, and it
 * self-gates on a threshold the bar can't reach with needs off.
 */
export const gossipSystem: System = (world, ctx) => {
  for (const e of canonicalById(world.query(Chat))) {
    const c = world.tryGet(e, Chat);
    if (c === undefined) continue; // cancelled earlier this pass from the partner's side
    const mirrored = world.isAlive(c.partner) ? world.tryGet(c.partner, Chat) : undefined;
    if (mirrored === undefined || mirrored.partner !== e) {
      endChat(world, ctx.tick, e);
      continue;
    }
    if (!c.seeker) continue; // the pair is driven once, from its seeker
    drivePair(world, ctx, ctx.terrain, e, c.partner);
  }
};

function drivePair(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  a: Entity,
  b: Entity,
): void {
  const ca = world.get(a, Chat);
  const cb = world.get(b, Chat);
  const sa = world.tryGet(a, Settler);
  const sb = world.tryGet(b, Settler);
  if (sa === undefined || sb === undefined) {
    endChat(world, ctx.tick, a);
    return;
  }
  if (chatOutranked(world, a, sa) || chatOutranked(world, b, sb)) {
    endChat(world, ctx.tick, a);
    return;
  }
  if (ca.talking) {
    // Both halves run on one shared clock, so a legitimate round ends on both at once — one half still
    // talking while the other's clip is gone means something stole the partner mid-round (an order, a
    // duty): nobody talks into the air, the chat is off.
    if (chatAtomicRunning(world, a) !== chatAtomicRunning(world, b)) {
      endChat(world, ctx.tick, a);
      return;
    }
    applyChatPulse(world, ctx, a, sa);
    applyChatPulse(world, ctx, b, sb);
    if (world.has(a, CurrentAtomic) || world.has(b, CurrentAtomic)) return; // the round plays out
    // Round complete. A half whose clip carries no readable channel-3 events restored nothing mid-round —
    // reset it whole at completion instead, the eat/sleep completion precedent.
    if (roundRefillUnits(ctx, sa, ca.speaks ? TALK_ATOMIC_ID : LISTEN_ATOMIC_ID) === 0)
      sa.enjoyment = fx.fromInt(0);
    if (roundRefillUnits(ctx, sb, cb.speaks ? TALK_ATOMIC_ID : LISTEN_ATOMIC_ID) === 0)
      sb.enjoyment = fx.fromInt(0);
    // The pair parts once the seeker's need is met — but never before the partner has had its own
    // speaking turn (`!ca.speaks`: the just-finished round was the partner's), so every chat is at least
    // one full exchange and a needs-off world doesn't freeze one half into a permanent listener.
    if (!ca.speaks && sa.enjoyment < CHAT_SATISFIED_DEFICIT) {
      endChat(world, ctx.tick, a);
      return;
    }
    ca.talking = false;
    cb.talking = false;
    ca.speaks = !ca.speaks;
    cb.speaks = !cb.speaks;
    // Falls through: the next round starts this same tick (the pair is still adjacent).
  }
  if (world.has(a, CurrentAtomic) || world.has(b, CurrentAtomic)) return; // a grabbed half finishes its swing
  const pa = world.tryGet(a, Position);
  const pb = world.tryGet(b, Position);
  if (pa === undefined || pb === undefined) {
    endChat(world, ctx.tick, a);
    return;
  }
  const na = nodeOfPosition(pa.x, pa.y);
  const nb = nodeOfPosition(pb.x, pb.y);
  if (nodesAdjacent(na, nb)) {
    // Standing together: run one talk/listen round on a shared clock (the longer of the two bound clips,
    // the wedding-kiss precedent) — each atomic targets the partner, so the render faces them at each other.
    clearNavState(world, a);
    clearNavState(world, b);
    const talker = ca.speaks ? a : b;
    const listener = ca.speaks ? b : a;
    const st = talker === a ? sa : sb;
    const sl = talker === a ? sb : sa;
    const duration = Math.max(chatDuration(ctx, st, TALK_ATOMIC_ID), chatDuration(ctx, sl, LISTEN_ATOMIC_ID));
    startAtomic(world, talker, TALK_ATOMIC_ID, { kind: 'idle' }, duration, listener);
    startAtomic(world, listener, LISTEN_ATOMIC_ID, { kind: 'idle' }, duration, talker);
    ca.talking = true;
    cb.talking = true;
    return;
  }
  // Apart: the seeker walks, the sought half halts and waits (it was grabbed mid-errand). A failed route
  // means the partner is unreachable — the chat is off.
  if (world.tryGet(a, PathRequest)?.failed === true || world.tryGet(b, PathRequest)?.failed === true) {
    clearNavState(world, a);
    clearNavState(world, b);
    endChat(world, ctx.tick, a);
    return;
  }
  if (terrain === undefined) return; // mapless fixture: no walking — the pair talks only if adjacent
  if (isTravelling(world, b)) clearNavState(world, b);
  if (!isTravelling(world, a)) {
    world.add(a, MoveGoal, { cell: terrain.nodeAtClamped(nb.hx, nb.hy) });
  }
}
