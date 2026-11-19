import type { ContentSet } from '@open-northland/data';
import {
  Carrying,
  Chat,
  ChatCooldown,
  type ChatKind,
  ChatSearchRest,
  CurrentAtomic,
  Engagement,
  FamilyDuty,
  Fleeing,
  IdleSince,
  inPastimeChat,
  LISTEN_ATOMIC_ID,
  LostWay,
  needsEnabled,
  ownerOf,
  PlayerOrder,
  Position,
  Resting,
  Settler,
  type SettlerIdentity,
  SettlerNeeds,
  TALK_ATOMIC_ID,
  Wedding,
} from '../../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import {
  hexDistanceBetween,
  nodeHxOfPosition,
  nodeHyOfPosition,
  type nodesAdjacent,
} from '../../../nav/halfcell.js';
import { walkLengthTo } from '../../../nav/range-search.js';
import type { SystemContext } from '../../context.js';
import { carriesNeeds, NEED_DRIVE_THRESHOLD, needLevel } from '../../lifecycle/needs/index.js';
import { NEED_RESERVE_UNITS, needBar } from '../../lifecycle/needs/scale.js';
import { isTravelling } from '../../movement/nav-state.js';
import { REFERENCE_STEP_TICKS } from '../../movement/walk-cost.js';
import { atomicDuration } from '../../readviews/animations.js';
import { isFighterJob } from '../../readviews/index.js';
import { IDLE_MEDIUM_ATOMIC_ID, IDLE_SHORT_ATOMIC_IDS } from '../../settlers/atomics/start.js';
import { walkLengthsFrom } from '../../signposts/index.js';
import { farthestSpan } from '../../spatial/walk-rank.js';
import { type GossipCandidates, NO_PARTNER } from './candidates.js';
import { endChat } from './drive.js';

/** How far in half-cell nodes a settler whose company bar has run empty walks for a partner, the cap of
 *  every company search. Authored value, about 12 cells. */
const CHAT_SEEK_RADIUS_NODES = 24;

/** How far a settler that has only just grown lonely walks, and then only to a partner the chat costs
 *  nothing. Authored value, about 4 cells. */
const CHAT_SEEK_FIRST_REACH_NODES = 8;

/** The company bar, in need units, under which a settler chats in passing and an idler skips its warm-up:
 *  half a bar. Authored value. */
export const CHAT_PASSING_UNITS = NEED_RESERVE_UNITS / 2;
const CHAT_PASSING_DEFICIT: Fixed = needBar(NEED_RESERVE_UNITS - CHAT_PASSING_UNITS);

/** Ticks a settler waits after a search for a passing chat found nobody, so one that plans every tick
 *  between two tasks does not search every tick. Authored value, two seconds. */
const CHAT_PASSING_RETRY_TICKS = 24;

/** How far in half-cell nodes a settler steps for a passing chat. Authored value, two cells. */
const CHAT_PASSING_REACH_NODES = 4;

/** Ticks of the seeker's work one node of its way costs: the walk there and the walk back.
 *  Approximation: the reference pace, not the seeker's own. */
const SEEK_TICKS_PER_NODE = 2 * REFERENCE_STEP_TICKS;

/** How many nodes away a seeker counts a partner on `(x, y)`, `dist` Manhattan nodes off. */
interface PartnerWay {
  /** The way there. */
  to(dist: number, x: number, y: number): number;
  /** No more than {@link to}, and cheap: a search drops a partner whose least way cannot beat the price
   *  it holds. */
  least(dist: number, x: number, y: number): number;
  /** The Manhattan distance past which no partner is within the seeker's reach: the search's clip. */
  readonly span: number;
}

/**
 * The {@link PartnerWay} of a seeker on `(hx, hy)` that walks at most `reach` nodes: the steps of the walk
 * to the partner, so one across a wall or a river is as far away as the walk round it, and one no walk of
 * `reach` steps gets to is out of reach. The walk is searched on the first ask, no walk is shorter than
 * the hex distance, and a walk of `reach` steps spans more Manhattan nodes than `reach`, so the search is
 * clipped at that span and a partner is turned away by its price. A seeker on a node no walk starts from counts the straight distance.
 */
function partnerWay(world: World, ctx: SystemContext, hx: number, hy: number, reach: number): PartnerWay {
  const { terrain } = ctx;
  // A fixture without terrain counts the straight distance.
  if (terrain === undefined) return { to: (dist) => dist, least: (dist) => dist, span: reach };
  let lengths: ReturnType<typeof walkLengthsFrom> | undefined;
  return {
    to: (dist, x, y) => {
      if (lengths === undefined) lengths = walkLengthsFrom(world, ctx.content, terrain, hx, hy, reach);
      return lengths === null ? dist : walkLengthTo(lengths, x, y);
    },
    least: (_dist, x, y) => hexDistanceBetween(hx, hy, x, y),
    span: farthestSpan(reach),
  };
}

/** Partner searches start at ring 1: a candidate stacked on the seeker's own node is skipped, since a pair
 *  chatting from one node stands inside each other. */
const CHAT_PARTNER_MIN_DIST_NODES = 1;

/** The idle-chat search covers exactly the adjacent lattice nodes: {@link nodesAdjacent} is Chebyshev 1, so
 *  Manhattan ring 2 is needed to reach the diagonals and the accept filter drops the (2,0) points. */
const CHAT_IDLE_MAX_RING = 2;

/** The Chebyshev reach of {@link nodesAdjacent}, inlined in the idle search to skip its node objects. */
const ADJACENT_NODES = 1;

/** How far in half-cell nodes an idle settler may wander to a distant partner once its
 *  {@link CHAT_IDLE_WALK_MEAN_WAIT_TICKS} roll fires. Authored value, about 6 cells. */
const CHAT_IDLE_WALK_RADIUS_NODES = 12;

/** Mean ticks an idle settler stands before deciding to wander to a distant partner, a seeded roll per
 *  call scaled to the caller's cadence so idle chatter never herds standing crowds into one heap.
 *  Authored value, ~20 s at the 12 Hz tick. */
const CHAT_IDLE_WALK_MEAN_WAIT_TICKS = 240;

/** Original behavior: an idle settler's first four idle rounds play a random short clip and the next five
 *  the medium one; only from its tenth round on may it chat, and any task besides idling or chatting
 *  restarts the count. Approximation: the original also walks an idler back to its place of work before it
 *  counts; this counts wherever it stands. */
const IDLE_SHORT_ROUNDS = 4;
const IDLE_MEDIUM_ROUNDS = 5;

/**
 * Ticks a settler stands idle before its first idle chat: the expected length of the idle rounds the
 * original plays first, from the settler's own clips. Approximation: the original counts rounds of the
 * clips it plays; this waits out their mean length.
 */
export function idleChatWarmupTicks(content: ContentSet, settler: SettlerIdentity): number {
  let short = 0;
  for (const id of IDLE_SHORT_ATOMIC_IDS) short += atomicDuration(content, settler, id);
  return (
    Math.floor((IDLE_SHORT_ROUNDS * short) / IDLE_SHORT_ATOMIC_IDS.length) +
    IDLE_MEDIUM_ROUNDS * atomicDuration(content, settler, IDLE_MEDIUM_ATOMIC_ID)
  );
}

/** Whether `e` has stood idle long enough to chat; its first try starts the count. */
function idleLongEnough(world: World, ctx: SystemContext, e: Entity, settler: SettlerIdentity): boolean {
  const idle = world.tryGet(e, IdleSince);
  if (idle === undefined) {
    world.add(e, IdleSince, { since: ctx.tick });
    return false;
  }
  return ctx.tick - idle.since >= idleChatWarmupTicks(ctx.content, settler);
}

/** Whether `e` is still inside its post-chat breather at `tick`. Expired stamps sit until the next chat
 *  overwrites them, so reading is pure. */
function chatCooldownActive(world: World, tick: number, e: Entity): boolean {
  const cd = world.tryGet(e, ChatCooldown);
  return cd !== undefined && cd.until > tick;
}

/** Whether `e` may be pulled into a chat right now: unclaimed, hands free, out of its post-chat breather,
 *  and not needing food or sleep more than company, since a survival need would cancel the chat at once. */
function mayJoinChat(world: World, tick: number, e: Entity): boolean {
  if (chatCooldownActive(world, tick, e) || world.has(e, Chat) || world.has(e, CurrentAtomic)) return false;
  return freeForChat(world, tick, e);
}

/** Whether a pastime chatter may be pulled into a company chat: its idle talk yields to another settler's
 *  need for company, as it yields to work. One still walking over to its partner is left to arrive. */
function mayLeavePastimeChat(world: World, tick: number, e: Entity): boolean {
  return inPastimeChat(world, e) && !isTravelling(world, e) && freeForChat(world, tick, e);
}

/** The holds a chat partner must be free of, whatever it is doing with its time. */
function freeForChat(world: World, tick: number, e: Entity): boolean {
  if (
    world.has(e, Wedding) ||
    world.has(e, FamilyDuty) ||
    world.has(e, Engagement) ||
    world.has(e, Fleeing) ||
    world.has(e, PlayerOrder) ||
    world.has(e, Resting) ||
    world.has(e, Carrying)
  ) {
    return false;
  }
  const s = world.get(e, SettlerNeeds);
  return (
    needLevel(s, 'hunger', tick) < NEED_DRIVE_THRESHOLD &&
    needLevel(s, 'fatigue', tick) < NEED_DRIVE_THRESHOLD
  );
}

/** Turn a pastime chat into one that holds both halves. */
function holdChat(world: World, e: Entity): void {
  const chat = world.get(e, Chat);
  if (chat.kind === 'company') return;
  world.mut(e, Chat).kind = 'company';
  const mirrored = world.tryMut(chat.partner, Chat);
  if (mirrored !== undefined) mirrored.kind = 'company';
}

/** Stamp the mirrored {@link Chat} pair - the seeker (who walks, and whose refill ends the chat) speaks
 *  the first round. */
function startChat(world: World, seeker: Entity, partner: Entity, kind: ChatKind): void {
  world.add(seeker, Chat, { partner, seeker: true, talking: false, speaks: true, kind });
  world.add(partner, Chat, { partner: seeker, seeker: false, talking: false, speaks: false, kind });
}

/** The idle rung's partner predicate: a same-owner settler standing free and not walking anywhere. */
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
 * The working settler's company rung. Short of company it chats in passing ({@link passingPartner}). At or
 * above {@link NEED_DRIVE_THRESHOLD} it leaves its work and claims
 * the same-owner settler whose chat costs the settlement least, the lonelier it is the further and the
 * busier. Authored rule: the original takes an idle settler in a fixed range. Only partners are
 * gated on {@link Carrying}: a grabbed half needs its hands free, a desperate seeker chats with its load
 * still in hand.
 */
export function planGossipSeek(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  hx: number,
  hy: number,
  candidates: GossipCandidates,
  /** A player "talk" order, which seeks a partner whatever the company bar reads. */
  ordered = false,
  /** Whether a battle nearby holds this settler where it stands (`conflict/battle-alert.ts`). Asked after
   *  the cheap bars above, so a settlement at peace never pays for the answer. */
  holdsGround?: () => boolean,
): boolean {
  const deficit = needLevel(world.get(e, SettlerNeeds), 'enjoyment', ctx.tick);
  const lonely = ordered || deficit >= NEED_DRIVE_THRESHOLD;
  if (!lonely && deficit < CHAT_PASSING_DEFICIT) return false;
  // With needs off no chat refills a bar, so only a player's order starts one.
  if (!ordered && !needsEnabled(world)) return false;
  // A carrier walks on with its load, and an idler's chat is the idle rung's, which yields to work.
  if (!lonely && (world.has(e, Carrying) || world.has(e, IdleSince))) return false;
  if (settler.jobType === null || isFighterJob(ctx.content, settler.jobType)) return false;
  // A bar that does not move, such as one a script froze, is one no chat could ever satisfy.
  if (!carriesNeeds(world, ctx.content, e)) return false;
  if (holdsGround?.() === true) return false;
  // Already in company: the chat it stands in becomes the one it sought, held against work like any
  // company-need chat, rather than a second pair that would orphan the first.
  if (world.has(e, Chat)) {
    if (!lonely) return false;
    holdChat(world, e);
    return true;
  }
  if (chatCooldownActive(world, ctx.tick, e)) return false;
  // Only owned settlers gossip, so unowned golden fixtures stay byte-identical, and partners must share
  // the owner.
  const owner = ownerOf(world, e);
  if (owner === undefined) return false;
  return lonely
    ? seekPartner(world, ctx, e, settler, owner, hx, hy, candidates, ordered)
    : passingPartner(world, ctx, e, owner, hx, hy, candidates);
}

/** Whether `e` is short enough of company to chat in passing. */
function wantsCompany(world: World, ctx: SystemContext, e: Entity): boolean {
  return (
    needsEnabled(world) &&
    needLevel(world.get(e, SettlerNeeds), 'enjoyment', ctx.tick) >= CHAT_PASSING_DEFICIT &&
    carriesNeeds(world, ctx.content, e)
  );
}

/**
 * The passing chat, an authored rule the original lacks: between two tasks a settler short of company
 * takes one round with a settler within {@link CHAT_PASSING_REACH_NODES} who stands idle or is short of
 * company too, so the round is wasted on neither and the bar seldom falls far enough to cost a walk.
 */
function passingPartner(
  world: World,
  ctx: SystemContext,
  e: Entity,
  owner: number,
  hx: number,
  hy: number,
  candidates: GossipCandidates,
): boolean {
  const { tick } = ctx;
  const rest = world.tryGet(e, ChatSearchRest);
  if (rest !== undefined && rest.until > tick) return false;
  const way = partnerWay(world, ctx, hx, hy, CHAT_PASSING_REACH_NODES);
  const priceOf = (cand: Entity, dist: number, toBeat: number, x: number, y: number): number => {
    if (way.least(dist, x, y) > toBeat || cand === e || ownerOf(world, cand) !== owner) return NO_PARTNER;
    if (!mayJoinChat(world, tick, cand)) return NO_PARTNER;
    const idle = world.has(cand, IdleSince) && !isTravelling(world, cand);
    return idle || wantsCompany(world, ctx, cand) ? way.to(dist, x, y) : NO_PARTNER;
  };
  const found = candidates
    .ensure()
    .cheapest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, way.span, CHAT_PASSING_REACH_NODES, priceOf);
  if (found === null) {
    world.add(e, ChatSearchRest, { until: tick + CHAT_PASSING_RETRY_TICKS });
    return false;
  }
  startChat(world, e, found, 'passing');
  return true;
}

/** Ticks of work a company chat takes from each half: its two rounds, the seeker's speaking turn and the
 *  partner's, each as long as the longer of the talker's and the listener's clips. */
function companyChatTicks(content: ContentSet, seeker: SettlerIdentity, partner: SettlerIdentity): number {
  return (
    Math.max(
      atomicDuration(content, seeker, TALK_ATOMIC_ID),
      atomicDuration(content, partner, LISTEN_ATOMIC_ID),
    ) +
    Math.max(
      atomicDuration(content, partner, TALK_ATOMIC_ID),
      atomicDuration(content, seeker, LISTEN_ATOMIC_ID),
    )
  );
}

/** How pressing a seeker's need is, from nothing at the drive threshold to {@link ONE} on an empty bar. A
 *  player's order is as pressing as it gets. */
function seekUrgency(deficit: Fixed, ordered: boolean): Fixed {
  if (ordered || deficit >= ONE) return ONE;
  if (deficit <= NEED_DRIVE_THRESHOLD) return ZERO;
  return fx.div(fx.sub(deficit, NEED_DRIVE_THRESHOLD), fx.sub(ONE, NEED_DRIVE_THRESHOLD));
}

/** The most ticks of lost work a seeker accepts for its chat, growing with its urgency from the walk to
 *  {@link CHAT_SEEK_FIRST_REACH_NODES} to the walk to {@link CHAT_SEEK_RADIUS_NODES}. */
function seekBudgetTicks(urgency: Fixed): number {
  const least = CHAT_SEEK_FIRST_REACH_NODES * SEEK_TICKS_PER_NODE;
  const most = CHAT_SEEK_RADIUS_NODES * SEEK_TICKS_PER_NODE;
  return least + fx.toInt(fx.mulInt(urgency, most - least));
}

/** The ticks of a chat a working partner loses for nothing: the share of them its own bar does not need,
 *  none for one as lonely as a seeker and all for one with a full bar, less the share the seeker's urgency
 *  excuses. On an empty bar any partner in reach will do. */
function wastedChatTicks(
  world: World,
  tick: number,
  partner: Entity,
  chatTicks: number,
  urgency: Fixed,
): number {
  const deficit = needLevel(world.get(partner, SettlerNeeds), 'enjoyment', tick);
  if (deficit >= NEED_DRIVE_THRESHOLD) return 0;
  const spare = deficit <= ZERO ? ONE : fx.div(fx.sub(NEED_DRIVE_THRESHOLD, deficit), NEED_DRIVE_THRESHOLD);
  if (spare <= urgency) return 0;
  return fx.toInt(fx.mulInt(fx.sub(spare, urgency), chatTicks));
}

/**
 * {@link planGossipSeek}'s search and claim. Every partner is priced in ticks of lost work: the seeker's
 * walk there and back by its {@link PartnerWay}, plus what the chat takes from a working partner for nothing. An idler or a pastime
 * chatter loses nothing. The cheapest partner inside the seeker's {@link seekBudgetTicks} is claimed, so a
 * lonely worker nearby beats a busy one with a full bar, and distance is weighed against both.
 * Approximation: only a settler the idle rung has counted ({@link IdleSince}) is an idler, so one a script
 * or an earlier rung parks is priced as at work.
 */
function seekPartner(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  owner: number,
  hx: number,
  hy: number,
  candidates: GossipCandidates,
  ordered: boolean,
): boolean {
  const { tick } = ctx;
  const urgency = seekUrgency(needLevel(world.get(e, SettlerNeeds), 'enjoyment', tick), ordered);
  const budget = seekBudgetTicks(urgency);
  const reach = Math.floor(budget / SEEK_TICKS_PER_NODE);
  const way = partnerWay(world, ctx, hx, hy, reach);
  const priceOf = (cand: Entity, dist: number, toBeat: number, x: number, y: number): number => {
    if (way.least(dist, x, y) * SEEK_TICKS_PER_NODE > toBeat) return NO_PARTNER;
    if (cand === e || ownerOf(world, cand) !== owner) return NO_PARTNER;
    if (world.has(cand, Chat)) {
      return mayLeavePastimeChat(world, tick, cand) ? way.to(dist, x, y) * SEEK_TICKS_PER_NODE : NO_PARTNER;
    }
    if (!mayJoinChat(world, tick, cand)) return NO_PARTNER;
    const walk = way.to(dist, x, y) * SEEK_TICKS_PER_NODE;
    // An idler a lower id has just sent off keeps its idle count until the walk is issued.
    if (world.has(cand, IdleSince) && !isTravelling(world, cand)) return walk;
    const chatTicks = companyChatTicks(ctx.content, settler, world.get(cand, Settler));
    return walk + wastedChatTicks(world, tick, cand, chatTicks, urgency);
  };
  const found = candidates.ensure().cheapest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, way.span, budget, priceOf);
  if (found === null) return false;
  if (world.has(found, Chat)) {
    // Its old partner goes into the breather; it goes straight into company.
    endChat(world, tick, found);
    world.remove(found, ChatCooldown);
  }
  startChat(world, e, found, 'company');
  return true;
}

/**
 * The idle-settler chat rung at the bottom of the drive ladder: a settler that has stood idle for
 * {@link idleChatWarmupTicks} chats even on a full company bar, since the original's settlements visibly
 * chatter. An adjacent partner is chatted up in place at once, while a partner within
 * {@link CHAT_IDLE_WALK_RADIUS_NODES} is only walked to once the {@link CHAT_IDLE_WALK_MEAN_WAIT_TICKS}
 * roll fires, so idlers stand around between chats. Approximation: the original's idle talk is one clip
 * that yields to the next command once it ends; this chat yields to work at once.
 */
export function planGossipIdle(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  hx: number,
  hy: number,
  candidates: GossipCandidates,
  /** Ticks between this caller's calls for one settler, so the walk roll keeps its mean wait in ticks. */
  callPeriodTicks: number,
  /** As {@link planGossipSeek}'s, and asked as late. */
  holdsGround?: () => boolean,
): boolean {
  if (settler.jobType === null || isFighterJob(ctx.content, settler.jobType)) return false;
  if (world.has(e, Chat) || chatCooldownActive(world, ctx.tick, e)) return false;
  if (holdsGround?.() === true) return false;
  // The owner gate sits before the wander roll below, so unowned fixtures consume no RNG and stay
  // byte-identical.
  const owner = ownerOf(world, e);
  if (owner === undefined) return false;
  // One short of company has no patience for the warm-up. The count still starts on its first try.
  if (!idleLongEnough(world, ctx, e, settler) && !wantsCompany(world, ctx, e)) return false;
  const idle = idlePartnerFilter(world, ctx.tick, e, owner);
  // Adjacency first: it reads only the position, while `idle` reads several stores.
  const idleBeside = (cand: Entity): boolean => {
    const p = world.tryGet(cand, Position);
    return (
      p !== undefined &&
      Math.abs(nodeHxOfPosition(p.x, p.y) - hx) <= ADJACENT_NODES &&
      Math.abs(nodeHyOfPosition(p.x, p.y) - hy) <= ADJACENT_NODES &&
      idle(cand)
    );
  };
  const buckets = candidates.ensure();
  const beside = buckets.nearest(hx, hy, CHAT_PARTNER_MIN_DIST_NODES, CHAT_IDLE_MAX_RING, idleBeside);
  if (beside !== null) {
    startChat(world, e, beside, 'pastime');
    return true;
  }
  // A lost settler keeps its stand, where its note sends the player, so it walks to no partner.
  if (world.has(e, LostWay)) return false;
  if (ctx.rng.int(Math.max(1, Math.floor(CHAT_IDLE_WALK_MEAN_WAIT_TICKS / callPeriodTicks))) !== 0) {
    return false;
  }
  const way = partnerWay(world, ctx, hx, hy, CHAT_IDLE_WALK_RADIUS_NODES);
  const distant = buckets.cheapest(
    hx,
    hy,
    CHAT_PARTNER_MIN_DIST_NODES,
    way.span,
    CHAT_IDLE_WALK_RADIUS_NODES,
    (cand, dist, toBeat, x, y) =>
      way.least(dist, x, y) > toBeat || !idle(cand) ? NO_PARTNER : way.to(dist, x, y),
  );
  if (distant === null) return false;
  startChat(world, e, distant, 'pastime');
  return true;
}
