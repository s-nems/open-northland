import {
  Chat,
  ChatCooldown,
  CurrentAtomic,
  chatAtomicRunning,
  clearNeedOrder,
  Engagement,
  FamilyDuty,
  Fleeing,
  LISTEN_ATOMIC_ID,
  PathRequest,
  PlayerOrder,
  Position,
  removeCurrentAtomic,
  Settler,
  SettlerNeeds,
  Sheltering,
  TALK_ATOMIC_ID,
  Wedding,
} from '../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { System, SystemContext } from '../../context.js';
import { carriesNeeds, NEED_DRIVE_THRESHOLD, needLevel } from '../../lifecycle/needs/index.js';
import { nextBandTick } from '../../lifecycle/needs/levels.js';
import { stopAtNextNode } from '../../movement/nav-state.js';
import { atomicDuration } from '../../readviews/animations.js';
import {
  approachPartner,
  driveMirroredPairs,
  haltBeside,
  standsBeside,
  startPairedAtomics,
} from '../../rendezvous.js';

/** Ticks after a chat ends before either half chats again, the {@link ChatCooldown} breather that lets the
 *  freed settlers' work rungs reclaim them. Authored value, ~3 s at the 12 Hz tick. */
export const CHAT_COOLDOWN_TICKS = 40;

/** Remove a chat from both halves, interrupting any talk/listen atomic in flight (the clips are
 *  `interruptable 1` in the data), and stamp the {@link ChatCooldown} breather on both. */
export function endChat(world: World, tick: number, e: Entity): void {
  const c = world.tryGet(e, Chat);
  if (c !== undefined && world.isAlive(c.partner)) {
    world.remove(c.partner, Chat);
    interruptChatAtomic(world, c.partner);
    world.add(c.partner, ChatCooldown, { until: tick + CHAT_COOLDOWN_TICKS });
    clearNeedOrder(world, c.partner, 'enjoyment');
  }
  world.remove(e, Chat);
  clearNeedOrder(world, e, 'enjoyment'); // a chat is what a player "talk" order asked for
  interruptChatAtomic(world, e);
  world.add(e, ChatCooldown, { until: tick + CHAT_COOLDOWN_TICKS });
}

function interruptChatAtomic(world: World, e: Entity): void {
  if (chatAtomicRunning(world, e)) removeCurrentAtomic(world, e);
}

/** Whether a higher drive outranks this half's chat. Company outranks none of them, so the chat ends and
 *  the partner is freed too. */
function chatOutranked(world: World, tick: number, e: Entity): boolean {
  const s = world.get(e, SettlerNeeds);
  return (
    needLevel(s, 'hunger', tick) >= NEED_DRIVE_THRESHOLD ||
    needLevel(s, 'fatigue', tick) >= NEED_DRIVE_THRESHOLD ||
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
  const rounds = runningRoundsOf(world);
  rounds.catchUp();
  driveMirroredPairs(
    world,
    Chat,
    // Driven once, from the half whose company need started it, unless its round is still playing out.
    (e, _partner, c) => c.seeker && !rounds.playing(e, ctx.tick),
    (e) => endChat(world, ctx.tick, e),
    (a, b) => {
      if (drivePair(world, ctx, ctx.terrain, a, b) === 'roundPlaying') rounds.hold(world, a, b, ctx.tick);
    },
  );
};

/** Stores whose membership a playing round's checks read on either half. */
const ROUND_MEMBERSHIP = [
  Chat,
  Settler,
  CurrentAtomic,
  Engagement,
  Fleeing,
  PlayerOrder,
  Wedding,
  FamilyDuty,
  Sheltering,
];
/** Stores whose in-place writes a playing round's checks read: the pair link, the clip, the bars. */
const ROUND_VALUES = [Chat, CurrentAtomic, SettlerNeeds];

/**
 * The pairs whose talk/listen round was playing out at their last pass, held until a store their checks
 * read changes on either half or a hunger or fatigue bar can next cross a band. Until then a pass would
 * read the same stores and again let the round play out, so it skips them.
 */
class RunningRounds {
  /** Per seeker id, the tick its pair is next driven; 0 when not held. */
  private until = new Float64Array(0);
  /** Per half id, the other half of a held pair. */
  private partners = new Int32Array(0);
  private readonly feed: ChangeFeed;
  private readonly release = (e: Entity): void => {
    if (e >= this.until.length) return;
    this.until[e] = 0;
    const partner = this.partners[e] ?? 0;
    if (partner < this.until.length) this.until[partner] = 0;
  };

  constructor(world: World) {
    this.feed = world.watchChanges(ROUND_MEMBERSHIP, ROUND_VALUES);
  }

  catchUp(): void {
    if (this.feed.pending && this.feed.drain(this.release)) this.until.fill(0);
  }

  playing(seeker: Entity, tick: number): boolean {
    return tick < (this.until[seeker] ?? 0);
  }

  hold(world: World, seeker: Entity, partner: Entity, tick: number): void {
    const next = tick + 1;
    const due = Math.min(
      nextBandTick(world.get(seeker, SettlerNeeds), next),
      nextBandTick(world.get(partner, SettlerNeeds), next),
    );
    if (due <= next) return;
    if (Math.max(seeker, partner) >= this.until.length) this.grow(world, Math.max(seeker, partner));
    this.until[seeker] = due;
    this.partners[seeker] = partner;
    this.partners[partner] = seeker;
  }

  private grow(world: World, e: number): void {
    const size = Math.max(world.nextEntityId, e + 1, 2 * this.until.length);
    const until = new Float64Array(size);
    until.set(this.until);
    const partners = new Int32Array(size);
    partners.set(this.partners);
    this.until = until;
    this.partners = partners;
  }
}

const runningRounds = new WeakMap<World, RunningRounds>();

function runningRoundsOf(world: World): RunningRounds {
  let rounds = runningRounds.get(world);
  if (rounds === undefined) {
    rounds = new RunningRounds(world);
    runningRounds.set(world, rounds);
  }
  return rounds;
}

function drivePair(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  a: Entity,
  b: Entity,
): 'roundPlaying' | undefined {
  // Read first: a pair mid-walk or mid-round changes nothing, and a write would mark both as touched.
  const ca = world.get(a, Chat);
  const sa = world.tryGet(a, Settler);
  const sb = world.tryGet(b, Settler);
  if (sa === undefined || sb === undefined) {
    endChat(world, ctx.tick, a);
    return;
  }
  if (chatOutranked(world, ctx.tick, a) || chatOutranked(world, ctx.tick, b)) {
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
    if (world.has(a, CurrentAtomic) || world.has(b, CurrentAtomic)) return 'roundPlaying';
    // The pair parts once the seeker's need is met, or can no longer be (a script froze its bars), but
    // never before the partner has had its own speaking turn, so every chat is at least one full exchange.
    // A passing chat is the one round.
    if (
      ca.kind === 'passing' ||
      (!ca.speaks &&
        (needLevel(world.get(a, SettlerNeeds), 'enjoyment', ctx.tick) < NEED_DRIVE_THRESHOLD ||
          !carriesNeeds(world, ctx.content, a)))
    ) {
      endChat(world, ctx.tick, a);
      return;
    }
    for (const half of [world.mut(a, Chat), world.mut(b, Chat)]) {
      half.talking = false;
      half.speaks = !half.speaks;
    }
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
  if (world.tryGet(a, PathRequest)?.failed === true || world.tryGet(b, PathRequest)?.failed === true) {
    approachPartner(world, ctx, a, b, nb, () => endChat(world, ctx.tick, a));
    return;
  }
  if (terrain !== undefined && stopAtNextNode(world, b)) return;
  if (standsBeside(na, nb)) {
    if (terrain !== undefined && haltBeside(world, terrain, a)) return;
    // Standing together: run one talk/listen round on a shared clock, the longer of the two bound clips.
    const talker = ca.speaks ? a : b;
    const listener = ca.speaks ? b : a;
    const st = talker === a ? sa : sb;
    const sl = talker === a ? sb : sa;
    const duration = Math.max(
      atomicDuration(ctx.content, st, TALK_ATOMIC_ID),
      atomicDuration(ctx.content, sl, LISTEN_ATOMIC_ID),
    );
    startPairedAtomics(world, talker, TALK_ATOMIC_ID, listener, LISTEN_ATOMIC_ID, duration);
    world.mut(a, Chat).talking = true;
    world.mut(b, Chat).talking = true;
    return;
  }
  // Apart or on one node: the seeker walks beside the sought half, which waits; an unreachable partner
  // ends the chat.
  approachPartner(world, ctx, a, b, nb, () => endChat(world, ctx.tick, a));
}
