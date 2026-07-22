import {
  Chat,
  ChatCooldown,
  CurrentAtomic,
  Engagement,
  FamilyDuty,
  Fleeing,
  PlayerOrder,
  Position,
  Settler,
  type SettlerIdentity,
  Wedding,
} from '../../../components/index.js';
import { type Fixed, fx, ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition, nodesAdjacent } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { FATIGUE_SLEEP_THRESHOLD, HUNGER_EAT_THRESHOLD } from '../../agents/drives-needs.js';
import type { System, SystemContext } from '../../context.js';
import {
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  atomicAnimationName,
  atomicDurationForName,
  atomicEventChannelDelta,
} from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, atomicAnimationByName } from '../../readviews/index.js';
import { approachPartner, driveMirroredPairs, startPairedAtomics } from '../../rendezvous.js';

/**
 * The gossip DRIVE half — {@link gossipSystem} advances every standing {@link Chat} pair one tick (see
 * `index.ts` for the mechanic's source basis): walk the seeker to its partner, run the alternating
 * talk/listen rounds on a shared clock, pulse the company bars at the clips' authored event frames,
 * fire the voice cues, and end the chat once the seeker is satisfied or something outranks it.
 */

/** The paired talk/listen atomic ids — `logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_TALK = 14` /
 *  `LISTEN = 15`, bound per tribe in `tribetypes.ini` (`setatomic 5/6 14 "..._talk"`, `... 15 "..._listen"`). */
export const TALK_ATOMIC_ID = 14;
export const LISTEN_ATOMIC_ID = 15;

/**
 * A chat ENDS once the seeker's deficit falls below this bound, 10% of a full bar (design rule: the last
 * pulses land near 0, but the bar keeps rising a hair per tick mid-round, so an exact `=== 0` test would
 * never pass). Ending the chat hands the pair back to the planner between rounds — work can reclaim them;
 * a pair still idle simply strikes up the next chat.
 */
const CHAT_SATISFIED_DEFICIT: Fixed = fx.div(ONE, fx.fromInt(10));

/** How long (ticks) after a chat ends before either half chats again — the {@link ChatCooldown} breather
 *  that lets the freed settlers' own work rungs reclaim them (design value, ~3 s at the 12 Hz tick). */
export const CHAT_COOLDOWN_TICKS = 40;

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
 * Apply this tick's talk/listen animation frame to `e`: every `event <elapsed> 3 <delta>` of the clip it
 * is playing takes `delta/4000` off the company deficit ({@link SOCIAL_EVENT_UNITS_PER_BAR}) — the bar
 * visibly refills DURING the conversation, at the original's own event frames, instead of snapping at
 * completion (clamped at 0) — and every `event <elapsed> 34 <id>` fires the clip's authored voice cue as
 * a {@link SimEvent} `chatVoice` (the talker's opening line at frame 0, the listener's mid-clip response).
 * Observable frames are `0..duration-1` only: the AtomicSystem removes a finished clip in the tick it
 * reaches `duration`, before the next gossip pass, so an event authored AT the clip's length would never
 * fire (every current clip authors strictly below it; the completion fallback covers a zero-pulse round).
 */
function applyChatFrame(
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
    if (event.at !== atomic.elapsed) continue;
    if (event.type === ATOMIC_EVENT_CHANNEL.LEISURE) units += event.value ?? 0;
    if (event.type === ATOMIC_EVENT_TYPE_PLAY_SOUND_FX && event.value !== undefined) {
      ctx.events.emit({ kind: 'chatVoice', entity: e, soundType: event.value });
    }
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
  driveMirroredPairs(
    world,
    Chat,
    (_e, _partner, c) => c.seeker, // driven once, from its seeker (the half whose company need started it)
    (e) => endChat(world, ctx.tick, e),
    (a, b) => drivePair(world, ctx, ctx.terrain, a, b),
  );
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
    applyChatFrame(world, ctx, a, sa);
    applyChatFrame(world, ctx, b, sb);
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
    // Standing together: run one talk/listen round on a shared clock, the longer of the two bound clips.
    const talker = ca.speaks ? a : b;
    const listener = ca.speaks ? b : a;
    const st = talker === a ? sa : sb;
    const sl = talker === a ? sb : sa;
    const duration = Math.max(chatDuration(ctx, st, TALK_ATOMIC_ID), chatDuration(ctx, sl, LISTEN_ATOMIC_ID));
    startPairedAtomics(world, talker, TALK_ATOMIC_ID, listener, LISTEN_ATOMIC_ID, duration);
    // Frame 0 plays now (the AtomicSystem's first step already advances `elapsed` to 1 before the next
    // gossip pass), so the talk clip's authored frame-0 voice cue must fire here or never.
    applyChatFrame(world, ctx, a, sa);
    applyChatFrame(world, ctx, b, sb);
    ca.talking = true;
    cb.talking = true;
    return;
  }
  // Apart: the seeker (`a`) walks, the sought half halts and waits (it was grabbed mid-errand); an
  // unreachable partner ends the chat.
  approachPartner(world, terrain, a, b, nb, () => endChat(world, ctx.tick, a));
}
