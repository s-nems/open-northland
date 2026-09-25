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
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { draftableTrade } from '../../assistant/index.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { isMarried, mayMarry } from '../../family/eligibility.js';
import { baseSoldierJobType, isFighterJob, isSoldierJob } from '../../readviews/index.js';
import { armableIntents } from '../../settlers/planner/recruit-arming.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { assistantCounterCommand } from '../assistant-counters.js';
import { seatBarracksOf } from '../base.js';
import { weaponMix } from '../military/census.js';
import { ownedSettlers } from '../seat-roster.js';
import type { SpareForce } from './pool.js';

/** The army's weapon mix (authored): as many swordsmen as archers in the field, but only over the classes
 *  a store can arm this decision, so the fielded mix tracks stock. The archers posted to towers leave the
 *  field for good and are not counted. Publication order breaks a tie, leaving the odd man in reach. */
const GARRISON_WEAPON_INTENTS = [
  'trainSword',
  'trainBow',
] as const satisfies readonly AssistantRecruitIntent[];

/** The main class that fights at range; every other one fills the melee side of the field mix. */
const RANGED_INTENT: AssistantRecruitIntent = 'trainBow';

/** The classes drafted only while neither main class can be armed: the seat's own smiths make no
 *  spears, so these arm the men from whatever the map handed it. */
const GARRISON_FALLBACK_INTENTS = ['trainSpear'] as const satisfies readonly AssistantRecruitIntent[];

/** Every counter this rung owns: the armed classes plus `trainSoldiers`, the weaponless base class
 *  the drill enlists into - the fallback for a seat that can arm nobody. */
const GARRISON_INTENTS: readonly AssistantRecruitIntent[] = [
  'trainSoldiers',
  ...GARRISON_WEAPON_INTENTS,
  ...GARRISON_FALLBACK_INTENTS,
];

/**
 * The garrison sizing: this rung only holds the assistant's training counters at the number of men the
 * settlement can spare, and the dispatcher (`systems/assistant/`) drafts, walks and drills them. The
 * army has no size cap (authored), so its real bound is breeding: a fighter neither marries nor fathers
 * children and the conversion is one-way, so the allowance counts only unmarried spare men beyond the
 * seat's waiting brides ({@link bachelorSurplus}). Runs last in the workforce ladder, so it sees only
 * the men left unclaimed by every post, reserve and flag.
 */
export function trainGarrison(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
): PlayerCommand[] {
  const wants = standingOrder(world, ctx, player, force);
  return GARRISON_INTENTS.flatMap((intent) => {
    const command = assistantCounterCommand(world, player, intent, wants.get(intent) ?? 0, false);
    return command === null ? [] : [command];
  });
}

/**
 * The wanted value per counter: its own unpaid bookings ({@link bookedByIntent}) plus a share of the men
 * the seat may still draft, so the headroom the dispatcher sees (`counter - bookings`) sums to exactly that
 * number. Each man goes to the armable class with the fewest in the field ({@link fieldedByIntent}), the
 * earlier class on a tie; a seat that can arm none of them falls back to `trainSoldiers`.
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
  const fielded = fieldedByIntent(world, ctx, player, booked);
  const standing = drafting.map((intent) => fielded.get(intent) ?? 0);
  for (let drafted = 0; drafted < allowance; drafted++) {
    let rank = 0;
    for (let i = 1; i < drafting.length; i++) if ((standing[i] ?? 0) < (standing[rank] ?? 0)) rank = i;
    const intent = drafting[rank];
    if (intent === undefined) break;
    standing[rank] = (standing[rank] ?? 0) + 1;
    wants.set(intent, (wants.get(intent) ?? 0) + 1);
  }
  return wants;
}

/**
 * The seat's field army per main class: its fighters outside the towers, by the weapon they fight with,
 * plus each class's unpaid bookings. A booked man still waiting for his weapon counts only as the booking.
 */
function fieldedByIntent(
  world: World,
  ctx: SystemContext,
  player: number,
  booked: ReadonlyMap<AssistantRecruitIntent, number>,
): Map<AssistantRecruitIntent, number> {
  const field: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null || !isFighterJob(ctx.content, jobType)) continue;
    if (towerPostFor(world, ctx, e, jobType) !== null) continue;
    if (world.tryGet(e, AssistantRecruit)?.armed === false) continue;
    field.push(e);
  }
  const mix = weaponMix(world, ctx, field);
  const fielded = new Map<AssistantRecruitIntent, number>();
  for (const intent of GARRISON_WEAPON_INTENTS) {
    const armed = intent === RANGED_INTENT ? mix.ranged : mix.melee;
    fielded.set(intent, armed + (booked.get(intent) ?? 0));
  }
  return fielded;
}

/**
 * The counters this decision's allowance is split over: the main classes the seat can arm a recruit
 * for, else the fallback classes it can, else `trainSoldiers`. Judged for `next`'s tribe and from the barracks door, because the arming
 * pass shops against the recruit's weapon rows from where he stands when it first looks at him.
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
  for (const classes of [GARRISON_WEAPON_INTENTS, GARRISON_FALLBACK_INTENTS]) {
    const armable = armableIntents(world, ctx, terrain, player, tribe, classes, reach);
    if (armable.length > 0) return armable;
  }
  return ['trainSoldiers'];
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

/** The seat's marriageable men beyond its marriageable women, the men the family plan will never need
 *  as husbands. Counted over {@link ownedSettlers} because claimed livestock is an owned `Settler` with
 *  no `Female` that {@link mayMarry} alone reads as a bachelor, licensing one more draft each. */
function bachelorSurplus(world: World, ctx: SystemContext, player: number): number {
  let surplus = 0;
  for (const e of ownedSettlers(world, player)) {
    if (!mayMarry(world, ctx.content, e)) continue;
    surplus += world.has(e, Female) ? -1 : 1;
  }
  return surplus;
}

/** The seat's in-flight bookings per counter, still unpaid (`armed` marks the payment for a class
 *  recruit). A booking whose drill was abandoned is excluded: its man is back in the spare pool, and
 *  counting both sides would publish one recruit past the bachelor cap. */
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
