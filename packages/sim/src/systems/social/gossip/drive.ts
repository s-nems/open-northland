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
  Sheltering,
  Wedding,
} from '../../../components/index.js';
import { type Fixed, fx, ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition, nodesAdjacent } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { System, SystemContext } from '../../context.js';
import { CIVILIST_JOB } from '../../lifecycle/ageclass.js';
import {
  ATOMIC_EVENT_TYPE_PLAY_SOUND_FX,
  atomicAnimationName,
  atomicDurationForName,
  atomicEventChannelDelta,
} from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL, atomicAnimationByName } from '../../readviews/index.js';
import { approachPartner, driveMirroredPairs, startPairedAtomics } from '../../rendezvous.js';
import { FATIGUE_SLEEP_THRESHOLD, HUNGER_EAT_THRESHOLD } from '../../settlers/drives/needs.js';

/**
 * The gossip drive half: {@link gossipSystem} advances every standing {@link Chat} pair one tick.
 * `index.ts` carries the mechanic's source basis.
 */

/** The paired talk/listen atomic ids - `logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_TALK = 14` /
 *  `LISTEN = 15`, bound per tribe in `tribetypes.ini` (`setatomic 5/6 14 "..._talk"`, `... 15 "..._listen"`). */
export const TALK_ATOMIC_ID = 14;
export const LISTEN_ATOMIC_ID = 15;

/**
 * A chat ends once the seeker's deficit falls below this bound, 10% of a full bar. Authored: the bar keeps
 * rising a hair per tick mid-round, so an exact `=== 0` test would never pass.
 */
const CHAT_SATISFIED_DEFICIT: Fixed = fx.div(ONE, fx.fromInt(10));

/** Ticks after a chat ends before either half chats again, the {@link ChatCooldown} breather that lets the
 *  freed settlers' work rungs reclaim them. Authored value, ~3 s at the 12 Hz tick. */
export const CHAT_COOLDOWN_TICKS = 40;

/**
 * The original's social-event scale: +4000 channel units restore one full bar. Basis: the eat animation's
 * one `event 30 2 +4000` maps to the sim's full hunger reset, and the talk animation's five
 * `event <at> 3 +800` pulses total the same 4000. Approximation: the engine's bar scale is not readable.
 */
const SOCIAL_EVENT_UNITS_PER_BAR = 4000;

/** Resolve the animation name a settler's tribe binds to a chat atomic, falling back to the tribe's
 *  {@link CIVILIST_JOB} binding: the readable `setatomic` talk/listen rows exist only for the woman and
 *  civilist jobs, so every trade's chat resolves through the civilist's `baseatomics 6` inheritance. */
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
 *  `interruptable 1` in the data), and stamp the {@link ChatCooldown} breather on both. */
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

/** Whether a higher drive outranks this half's chat. Company outranks none of them, so the chat ends and
 *  the partner is freed too. */
function chatOutranked(world: World, e: Entity, s: { hunger: Fixed; fatigue: Fixed }): boolean {
  return (
    s.hunger >= HUNGER_EAT_THRESHOLD ||
    s.fatigue >= FATIGUE_SLEEP_THRESHOLD ||
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, PlayerOrder) ||
    world.has(e, Wedding) ||
    world.has(e, FamilyDuty) ||
    world.has(e, Sheltering) // the alarm: nobody stands around chatting through it
  );
}

/**
 * Apply this tick's talk/listen animation frame to `e`: each `event <elapsed> 3 <delta>` takes
 * `delta/4000` ({@link SOCIAL_EVENT_UNITS_PER_BAR}) off the company deficit, clamped at 0, and each
 * `event <elapsed> 34 <id>` emits the clip's authored voice cue. Observable frames are `0..duration-1`:
 * the AtomicSystem removes a finished clip before the next gossip pass, so an event authored at the clip's
 * length would never fire.
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

/** The clip's total channel-3 restore for this half's next `atomicId` round, in event units; 0 means the
 *  animation is unreadable and the round falls back to a completion reset like eat/sleep. */
function roundRefillUnits(ctx: SystemContext, s: SettlerIdentity, atomicId: number): number {
  const name = chatAnimationName(ctx, s, atomicId);
  return name === undefined ? 0 : atomicEventChannelDelta(ctx.content, name, ATOMIC_EVENT_CHANNEL.LEISURE);
}

/**
 * Drive every {@link Chat} pair one tick. Runs after orders and before the AI planner, so its walks route
 * the same tick and the `Chat` fence is fresh when the planner reads it. Deliberately not gated on the
 * `needsEnabled` world rule: idle chatter is social flavor, not a need mechanic.
 */
export const gossipSystem: System = (world, ctx) => {
  driveMirroredPairs(
    world,
    Chat,
    (_e, _partner, c) => c.seeker, // driven once, from the half whose company need started it
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
    // Both halves run on one shared clock, so a legitimate round ends on both at once; one half still
    // talking means something stole the partner mid-round.
    if (chatAtomicRunning(world, a) !== chatAtomicRunning(world, b)) {
      endChat(world, ctx.tick, a);
      return;
    }
    applyChatFrame(world, ctx, a, sa);
    applyChatFrame(world, ctx, b, sb);
    if (world.has(a, CurrentAtomic) || world.has(b, CurrentAtomic)) return; // the round plays out
    // A half whose clip carries no readable channel-3 events restored nothing mid-round, so it resets
    // whole at completion, the eat/sleep precedent.
    if (roundRefillUnits(ctx, sa, ca.speaks ? TALK_ATOMIC_ID : LISTEN_ATOMIC_ID) === 0)
      sa.enjoyment = fx.fromInt(0);
    if (roundRefillUnits(ctx, sb, cb.speaks ? TALK_ATOMIC_ID : LISTEN_ATOMIC_ID) === 0)
      sb.enjoyment = fx.fromInt(0);
    // The pair parts once the seeker's need is met, but never before the partner has had its own speaking
    // turn, so every chat is at least one full exchange.
    if (!ca.speaks && sa.enjoyment < CHAT_SATISFIED_DEFICIT) {
      endChat(world, ctx.tick, a);
      return;
    }
    ca.talking = false;
    cb.talking = false;
    ca.speaks = !ca.speaks;
    cb.speaks = !cb.speaks;
    // Falls through: the next round starts this same tick.
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
    // Frame 0 plays now, since the AtomicSystem advances `elapsed` to 1 before the next gossip pass, so
    // the clip's authored frame-0 voice cue must fire here or never.
    applyChatFrame(world, ctx, a, sa);
    applyChatFrame(world, ctx, b, sb);
    ca.talking = true;
    cb.talking = true;
    return;
  }
  // Apart: the seeker walks, the sought half waits; an unreachable partner ends the chat.
  approachPartner(world, terrain, a, b, nb, () => endChat(world, ctx.tick, a));
}
