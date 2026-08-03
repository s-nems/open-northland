import {
  AssistantRecruit,
  type AssistantRecruitIntent,
  aiModuleRuns,
  Building,
  Equipment,
  Female,
  ownerOf,
  ownersCompatible,
  Settler,
  Stockpile,
  TrainingOrder,
  UnderConstruction,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { draftableTrade } from '../../assistant/index.js';
import type { SystemContext } from '../../context.js';
import { isMarried, mayMarry } from '../../family/eligibility.js';
import { baseSoldierJobType, isSoldierJob } from '../../readviews/index.js';
import { armingGoodPreference } from '../../settlers/planner/recruit-arming.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { type NavigationLimit, networkLimitAt } from '../../signposts/index.js';
import { entityNode } from '../../spatial/nodes.js';
import { mayFetchGoodFrom } from '../../stores/index.js';
import { seatBarracksOf } from '../base.js';
import { assistantCounterCommand, ownedSettlers } from '../shared.js';
import type { SpareForce } from './pool.js';

/** The army's weapon mix, in publication order: half swordsmen, half archers (user rule). Swords
 *  lead, so the odd man of an odd draft fights in reach. Spears are left out - the seat fields two
 *  classes, not three. */
const GARRISON_WEAPON_INTENTS = [
  'trainSword',
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
 * The army has no size cap (user rule: as many soldiers as the settlement can raise). Its real bound
 * is the breeding engine that grows the next recruits: a fighter neither marries nor fathers
 * children, and the conversion is one-way, so the draft allowance counts only UNMARRIED spare men,
 * capped by the bachelor surplus beyond the seat's waiting brides ({@link bachelorSurplus}). The
 * dispatcher drafts unmarried men first, so a want sized to the free bachelors never reaches a
 * husband - the old hand-pick's family-line guarantee, kept through the counters.
 *
 * Runs last in the workforce ladder: the allowance counts only the draft-shaped men (the dispatcher's
 * own {@link draftableTrade} rule) left unclaimed by every post, reserve and flag. Outflow pacing is
 * the assistant's trickle brake, no longer one man per decision.
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
 * even share of {@link draftAllowance}, so the headroom the dispatcher sees (`counter - bookings`,
 * `systems/assistant/`) sums to exactly the men the seat may still spare. Publishing a pooled total
 * instead lets a class-skewed booking set open phantom slots and drafts husbands.
 *
 * Shares go only to the classes the seat can arm RIGHT NOW ({@link canArm}), the earlier class taking
 * the remainder. A seat that can arm none of them shares out onto `trainSoldiers` instead - a recruit
 * who fights with his fists is the last resort, never the plan (user rule).
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
  const tribe = world.get(barracks, Building).tribe;
  const reach = drillFloorReach(world, ctx, barracks);
  const armable = GARRISON_WEAPON_INTENTS.filter((intent) =>
    canArm(world, ctx, player, tribe, intent, reach),
  );
  const drafting: readonly AssistantRecruitIntent[] = armable.length > 0 ? armable : ['trainSoldiers'];
  const allowance = draftAllowance(world, ctx, player, force);
  for (const [rank, intent] of drafting.entries()) {
    const share = Math.floor(allowance / drafting.length) + (rank < allowance % drafting.length ? 1 : 0);
    wants.set(intent, (wants.get(intent) ?? 0) + share);
  }
  return wants;
}

/** How many NEW men the seat may still draft: its spare free bachelors, capped by the bachelor
 *  surplus. Men already booked are not counted here - each of their counters carries them. */
function draftAllowance(world: World, ctx: SystemContext, player: number, force: SpareForce): number {
  const surplus = Math.max(0, bachelorSurplus(world, ctx, player));
  const free = force.remaining().filter((e) => {
    if (!draftableTrade(world.get(e, Settler).jobType) || isMarried(world, e)) return false;
    // A man wearing a weapon good (a manual civilian equip) is persistently undraftable - counting
    // him would leave the published want standing unfillable.
    return (world.tryGet(e, Equipment)?.weapon ?? null) === null;
  }).length;
  return Math.min(free, surplus);
}

/**
 * How far a recruit fresh off the drill can shop: the signpost network around the barracks door, where
 * he stands when the arming pass first looks at him (`settlers/planner/recruit-arming.ts` gates the same
 * way). Null when navigation is unconfined - then every store counts. Mapless sims have no network at all.
 */
function drillFloorReach(world: World, ctx: SystemContext, barracks: Entity): NavigationLimit | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null;
  const door = interactionCell(world, ctx, terrain, barracks);
  return networkLimitAt(world, terrain, ownerOf(world, barracks) ?? 0, terrain.xOf(door), terrain.yOf(door));
}

/**
 * Whether the seat could arm an `intent` recruit: some store within his {@link drillFloorReach} holds a
 * weapon good the arming pass would shop for ({@link armingGoodPreference}). Existence only - which
 * recruit walks there is the pass's problem - but the reach must match, or the seat publishes a class
 * whose recruits enlist and then stand around bare-handed forever. Ownership follows that pass's own
 * rule ({@link ownersCompatible}), so a neutral ground heap of swords counts like a stocked warehouse.
 */
function canArm(
  world: World,
  ctx: SystemContext,
  player: number,
  tribe: number,
  intent: (typeof GARRISON_WEAPON_INTENTS)[number],
  reach: NavigationLimit | null,
): boolean {
  const goods = armingGoodPreference(ctx.content, tribe, intent);
  if (goods.length === 0) return false; // the tribe's data binds no such class
  for (const store of world.query(Stockpile)) {
    if (!ownersCompatible(player, ownerOf(world, store))) continue;
    if (world.has(store, UnderConstruction)) continue; // a site is a sink, never a source to strip
    if (reach !== null && !storeInReach(world, ctx, store, reach)) continue;
    const { amounts } = world.get(store, Stockpile);
    for (const good of goods) {
      if ((amounts.get(good) ?? 0) > 0 && mayFetchGoodFrom(world, ctx, store, good)) return true;
    }
  }
  return false;
}

/** Whether a store's approach node lies inside `reach` - a building by its door, a ground pile by its
 *  own node, the same cells the arming pass's store search offers. */
function storeInReach(world: World, ctx: SystemContext, store: Entity, reach: NavigationLimit): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return true;
  const at = world.has(store, Building)
    ? interactionCell(world, ctx, terrain, store)
    : entityNode(world, terrain, store);
  return reach.allowsNode(at);
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
