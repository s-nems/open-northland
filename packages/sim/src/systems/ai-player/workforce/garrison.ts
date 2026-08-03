import {
  AssistantRecruit,
  type AssistantRecruitIntent,
  aiModuleRuns,
  Equipment,
  Female,
  ownerOf,
  Settler,
  TrainingOrder,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { draftableTrade } from '../../assistant/index.js';
import type { SystemContext } from '../../context.js';
import { isMarried, mayMarry } from '../../family/eligibility.js';
import { baseSoldierJobType, isSoldierJob } from '../../readviews/index.js';
import { armableIntents } from '../../settlers/planner/recruit-arming.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { seatBarracksOf } from '../base.js';
import { assistantCounterCommand, ownedSettlers } from '../shared.js';
import type { SpareForce } from './pool.js';

/** The army's weapon mix: equal shares over the three armed classes, but only over those a store can
 *  arm this decision, so the fielded mix tracks stock. Publication order breaks a draft that does not
 *  divide - the leftover men fight in reach. Authored balance, and blind to the tower posts, which
 *  take bow classes only (`military/defence/posts.ts`) and take them for good: a seat holding towers
 *  fields fewer archers than the share implies. */
const GARRISON_WEAPON_INTENTS = [
  'trainSword',
  'trainSpear',
  'trainBow',
] as const satisfies readonly AssistantRecruitIntent[];

/** Every counter this rung owns: the armed classes plus `trainSoldiers`, the weaponless base class
 *  the drill enlists into - the fallback for a seat that can arm nobody. */
const GARRISON_INTENTS: readonly AssistantRecruitIntent[] = ['trainSoldiers', ...GARRISON_WEAPON_INTENTS];

/**
 * The garrison sizing: the seat trains through the settlement assistant (user rule) - this rung keeps
 * the training counters at the number of men the settlement can spare, and the dispatcher
 * (`systems/assistant/`) drafts, walks and drills them; the arming pass
 * (`settlers/planner/recruit-arming.ts`) then dresses each class recruit. The more free civilians,
 * the larger the standing order; the AI hand-picks no recruit. A disabled `military` toggle publishes
 * zero, so the assistant stops with the module; only losing the base freezes the standing counters (the
 * whole workforce ladder stops deciding upstream).
 *
 * The army has no size cap (user rule: as many soldiers as the settlement can raise). Its real bound is
 * the breeding engine that grows the next recruits: a fighter neither marries nor fathers children, and
 * the conversion is one-way, so the allowance counts only UNMARRIED spare men, capped by the bachelor
 * surplus beyond the seat's waiting brides ({@link bachelorSurplus}). The dispatcher drafts unmarried men
 * first, so a want sized to the free bachelors never reaches a husband.
 *
 * Runs last in the workforce ladder, so the allowance sees only the draft-shaped men left unclaimed by
 * every post, reserve and flag. Outflow pacing is the assistant's trickle brake.
 */
export function trainGarrison(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
): Command[] {
  const wants = standingOrder(world, ctx, player, force);
  return GARRISON_INTENTS.flatMap((intent) => {
    const command = assistantCounterCommand(world, player, intent, wants.get(intent) ?? 0, false);
    return command === null ? [] : [command];
  });
}

/**
 * The wanted value per counter: each keeps its own unpaid bookings ({@link bookedByIntent}) plus an
 * even share of the men the seat may still draft, so the headroom the dispatcher sees
 * (`counter - bookings`, `systems/assistant/`) sums to exactly that number.
 *
 * Shares go only to the classes the seat can arm right now ({@link armableIntents}), the earlier
 * classes taking the remainder. A seat that can arm none of them shares out onto `trainSoldiers`
 * instead: a recruit who fights with his fists is the last resort, never the plan.
 *
 * Empty (every counter withdrawn to zero) when the seat may not or cannot raise an army at all: the
 * `military` toggle is off, the content names no soldier class, or it owns no barracks to drill in.
 */
function standingOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
): Map<AssistantRecruitIntent, number> {
  const wants = new Map<AssistantRecruitIntent, number>();
  if (!aiModuleRuns(world, player, 'military')) return wants;
  if (baseSoldierJobType(ctx.content) === null) return wants;
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks === null) return wants;

  const booked = bookedByIntent(world, ctx, player);
  for (const intent of GARRISON_INTENTS) wants.set(intent, booked.get(intent) ?? 0);

  const draftable = draftableSpare(world, force);
  const allowance = Math.min(draftable.length, Math.max(0, bachelorSurplus(world, ctx, player)));
  const next = draftable[0];
  if (allowance === 0 || next === undefined) return wants; // nobody to draft: the classes need no probe
  const drafting = draftingClasses(world, ctx, player, barracks, next);
  for (const [rank, intent] of drafting.entries()) {
    const share = Math.floor(allowance / drafting.length) + (rank < allowance % drafting.length ? 1 : 0);
    wants.set(intent, (wants.get(intent) ?? 0) + share);
  }
  return wants;
}

/**
 * The counters this decision's allowance is split over: the armed classes the seat can arm a recruit for,
 * else `trainSoldiers`. Judged for `next`'s tribe - one of the men it may draft - because the arming pass
 * shops against the RECRUIT's weapon rows, not the barracks'; and from the barracks door, where he stands
 * when that pass first looks at him.
 */
function draftingClasses(
  world: World,
  ctx: SystemContext,
  player: number,
  barracks: Entity,
  next: Entity,
): readonly AssistantRecruitIntent[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return GARRISON_WEAPON_INTENTS; // mapless sim: no network to walk
  const tribe = world.get(next, Settler).tribe;
  const door = interactionCell(world, ctx, terrain, barracks);
  const reach = networkLimitAt(world, terrain, player, terrain.xOf(door), terrain.yOf(door));
  const armable = armableIntents(world, ctx, terrain, player, tribe, GARRISON_WEAPON_INTENTS, reach);
  return armable.length > 0 ? armable : ['trainSoldiers'];
}

/** The spare men the dispatcher could still draft, in its own draft order. Men already booked are not
 *  here - each of their counters carries them. */
function draftableSpare(world: World, force: SpareForce): Entity[] {
  return force.remaining().filter((e) => {
    if (!draftableTrade(world.get(e, Settler).jobType) || isMarried(world, e)) return false;
    // A man wearing a weapon good (a manual civilian equip) is persistently undraftable - counting
    // him would leave the published want standing unfillable.
    return (world.tryGet(e, Equipment)?.weapon ?? null) === null;
  });
}

/** The seat's marriageable men beyond its marriageable women, the men the family plan will never
 *  need as husbands. {@link mayMarry} decides both sides (it already rejects a recruit committed to
 *  a drill) but judges a settler alone, so the count must come from {@link ownedSettlers}: claimed
 *  livestock is an owned `Settler` with no `Female` and reads as a marriageable bachelor, and each
 *  head would license one more draft out of the men the brides are waiting for. */
function bachelorSurplus(world: World, ctx: SystemContext, player: number): number {
  let surplus = 0;
  for (const e of ownedSettlers(world, player)) {
    if (!mayMarry(world, ctx.content, e)) continue;
    surplus += world.has(e, Female) ? -1 : 1;
  }
  return surplus;
}

/** The seat's in-flight bookings per counter, still unpaid (`armed` marks the payment for a class
 *  recruit; a plain drill pays at enlistment and drops the mark there). A booking whose drill was
 *  abandoned - no order left and no soldier trade taken, so the assistant sweep will drop it - is
 *  excluded: its man is back in the spare pool, and counting both sides would publish one recruit
 *  past the bachelor cap. Kinds this rung does not publish belong to the hand that set them. */
function bookedByIntent(
  world: World,
  ctx: SystemContext,
  player: number,
): Map<AssistantRecruitIntent, number> {
  const booked = new Map<AssistantRecruitIntent, number>();
  for (const e of world.query(AssistantRecruit)) {
    if (ownerOf(world, e) !== player) continue;
    const booking = world.get(e, AssistantRecruit);
    if (booking.armed || !GARRISON_INTENTS.includes(booking.intent)) continue;
    if (!world.has(e, TrainingOrder) && !isSoldierJob(ctx.content, world.get(e, Settler).jobType)) continue;
    booked.set(booking.intent, (booked.get(booking.intent) ?? 0) + 1);
  }
  return booked;
}
