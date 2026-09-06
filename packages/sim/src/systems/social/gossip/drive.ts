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
import type { Fixed } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition, nodesAdjacent } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { System, SystemContext } from '../../context.js';
import { NEED_DRIVE_THRESHOLD } from '../../lifecycle/needs/index.js';
import { atomicClipName, atomicDurationForName } from '../../readviews/animations.js';
import { approachPartner, driveMirroredPairs, startPairedAtomics } from '../../rendezvous.js';

/** The paired talk/listen atomic ids - `logicdefines.inc` `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_TALK = 14` /
 *  `LISTEN = 15`, bound per tribe in `tribetypes.ini` (`setatomic 5/6 14 "..._talk"`, `... 15 "..._listen"`). */
export const TALK_ATOMIC_ID = 14;
export const LISTEN_ATOMIC_ID = 15;

/** Ticks after a chat ends before either half chats again, the {@link ChatCooldown} breather that lets the
 *  freed settlers' work rungs reclaim them. Authored value, ~3 s at the 12 Hz tick. */
export const CHAT_COOLDOWN_TICKS = 40;

/** A chat atomic's duration (ticks). The readable `setatomic` talk/listen rows exist only for the woman and
 *  civilist jobs, so every other trade's chat resolves through {@link atomicClipName}'s civilist fallback. */
function chatDuration(ctx: SystemContext, s: SettlerIdentity, atomicId: number): number {
  return atomicDurationForName(ctx.content, atomicClipName(ctx.content, s, atomicId));
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
    s.hunger >= NEED_DRIVE_THRESHOLD ||
    s.fatigue >= NEED_DRIVE_THRESHOLD ||
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, PlayerOrder) ||
    world.has(e, Wedding) ||
    world.has(e, FamilyDuty) ||
    world.has(e, Sheltering) // the alarm: nobody stands around chatting through it
  );
}

/**
 * Drive every {@link Chat} pair one tick. Runs after orders and before the AI planner, so its walks route
 * the same tick and the `Chat` fence is fresh when the planner reads it. Pairing is deliberately not gated
 * on the `needsEnabled` world rule - idle chatter is social flavor - though what a round restores is, like
 * every other clip payout.
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
  const ca = world.mut(a, Chat);
  const cb = world.mut(b, Chat);
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
    if (world.has(a, CurrentAtomic) || world.has(b, CurrentAtomic)) return; // the round plays out
    // The pair parts once the seeker's need is met, but never before the partner has had its own speaking
    // turn, so every chat is at least one full exchange.
    if (!ca.speaks && sa.enjoyment < NEED_DRIVE_THRESHOLD) {
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
    ca.talking = true;
    cb.talking = true;
    return;
  }
  // Apart: the seeker walks, the sought half waits; an unreachable partner ends the chat.
  approachPartner(world, terrain, a, b, nb, () => endChat(world, ctx.tick, a));
}
