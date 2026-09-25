import type { ContentSet } from '@open-northland/data';
import {
  AssistantRecruit,
  type AssistantRecruitIntent,
  AssistantWeaponVetoes,
  aiModuleRuns,
  Equipment,
  Female,
  ownerOf,
  playerGoodList,
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
import { INTENT_WEAPON_CLASS } from '../../settlers/atomics/effects/goods/weapon-class.js';
import { armableIntents, armingGoodPreference } from '../../settlers/planner/recruit-arming.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { assistantCounterCommand } from '../assistant-counters.js';
import { seatBarracksOf } from '../base.js';
import { fighterWeaponClass } from '../military/census.js';
import { ownedSettlers } from '../seat-roster.js';
import type { SpareForce } from './pool.js';

/** The army's armed classes; publication order breaks a draft tie, leaving the odd man in reach. */
const GARRISON_WEAPON_INTENTS = [
  'trainSword',
  'trainBow',
  'trainSpear',
] as const satisfies readonly AssistantRecruitIntent[];
type GarrisonWeaponIntent = (typeof GARRISON_WEAPON_INTENTS)[number];

/** The field army's weapon mix while a store can arm every class (authored): four archers to three
 *  swordsmen and three spearmen. Over fewer armable classes the field splits evenly, so a stalled weapon
 *  line leaves the rest half and half. The archers posted to towers leave the field for good and are not
 *  counted. */
const FULL_FIELD_SHARES: Readonly<Record<GarrisonWeaponIntent, number>> = {
  trainSword: 3,
  trainBow: 4,
  trainSpear: 3,
};

/** Every counter this rung owns: the armed classes plus `trainSoldiers`, the weaponless base class
 *  the drill enlists into - the fallback for a seat that can arm nobody. */
const GARRISON_INTENTS: readonly AssistantRecruitIntent[] = ['trainSoldiers', ...GARRISON_WEAPON_INTENTS];

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
  const vetoed = playerGoodList(world, AssistantWeaponVetoes, player);
  const pending = missingWeaponVetoes(world, ctx, player, vetoed);
  // The vetoes land a tick later, so this decision's draft already judges the arms without them.
  const wants = standingOrder(world, ctx, player, force, [...vetoed, ...pending]);
  const counters = GARRISON_INTENTS.flatMap((intent) => {
    const command = assistantCounterCommand(world, player, intent, wants.get(intent) ?? 0, false);
    return command === null ? [] : [command];
  });
  const vetoes = pending.map(
    (goodType): PlayerCommand => ({ kind: 'setAssistantWeaponVeto', player, goodType, vetoed: true }),
  );
  return [...vetoes, ...counters];
}

/**
 * The AI arms its recruits only with each class's best weapon (authored): short swords, wooden spears and
 * short bows would field weak men, and the short swords and wooden spears its own shops make are inputs
 * to amulets and iron spears. The {@link weakerWeaponGoods} goods not yet among the seat's `vetoed` ones.
 */
function missingWeaponVetoes(
  world: World,
  ctx: SystemContext,
  player: number,
  vetoed: readonly number[],
): readonly number[] {
  if (!aiModuleRuns(world, player, 'military')) return [];
  return weakerWeaponGoods(ctx.content).filter((good) => !vetoed.includes(good));
}

const weakerWeaponsByContent = new WeakMap<ContentSet, readonly number[]>();

/** The weapon goods, ascending, that some tribe's armed class ranks below its best and none ranks best. */
function weakerWeaponGoods(content: ContentSet): readonly number[] {
  const known = weakerWeaponsByContent.get(content);
  if (known !== undefined) return known;
  const best = new Set<number>();
  const weaker = new Set<number>();
  for (const tribe of new Set(
    content.weapons.flatMap((w) => (w.tribeType === undefined ? [] : [w.tribeType])),
  )) {
    for (const intent of GARRISON_WEAPON_INTENTS) {
      const [strongest, ...rest] = armingGoodPreference(content, tribe, intent, []);
      if (strongest !== undefined) best.add(strongest);
      for (const good of rest) weaker.add(good);
    }
  }
  const goods = [...weaker].filter((good) => !best.has(good)).sort((a, b) => a - b);
  weakerWeaponsByContent.set(content, goods);
  return goods;
}

/**
 * The wanted value per counter: its own unpaid bookings ({@link bookedByIntent}) plus a share of the men
 * the seat may still draft, so the headroom the dispatcher sees (`counter - bookings`) sums to exactly that
 * number. Each man goes to the armable class furthest below its field share ({@link fieldedByIntent},
 * {@link FULL_FIELD_SHARES}), the earlier class on a tie; a seat that can arm none of them falls back to
 * `trainSoldiers`.
 */
function standingOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
  vetoed: readonly number[],
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
  const drafting = draftingClasses(world, ctx, player, barracks, next, vetoed);
  const fielded = fieldedByIntent(world, ctx, player, booked);
  const full = GARRISON_WEAPON_INTENTS.every((intent) => drafting.includes(intent));
  const shares = drafting.map((intent) => (full && isWeaponIntent(intent) ? FULL_FIELD_SHARES[intent] : 1));
  const standing = drafting.map((intent) => fielded.get(intent) ?? 0);
  // standing / share compared by cross-multiplication, so the pick stays in integers.
  const behind = (i: number, j: number): boolean =>
    (standing[i] ?? 0) * (shares[j] ?? 1) < (standing[j] ?? 0) * (shares[i] ?? 1);
  for (let drafted = 0; drafted < allowance; drafted++) {
    let rank = 0;
    for (let i = 1; i < drafting.length; i++) if (behind(i, rank)) rank = i;
    const intent = drafting[rank];
    if (intent === undefined) break;
    standing[rank] = (standing[rank] ?? 0) + 1;
    wants.set(intent, (wants.get(intent) ?? 0) + 1);
  }
  return wants;
}

function isWeaponIntent(intent: AssistantRecruitIntent): intent is GarrisonWeaponIntent {
  return (GARRISON_WEAPON_INTENTS as readonly AssistantRecruitIntent[]).includes(intent);
}

/**
 * The seat's field army per armed class: its fighters outside the towers, by the class of the weapon they
 * fight with, plus each class's unpaid bookings. A booked man still waiting for his weapon counts only as
 * the booking, and a fighter of another class or none counts for no class.
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
  const fielded = new Map<AssistantRecruitIntent, number>();
  for (const intent of GARRISON_WEAPON_INTENTS) fielded.set(intent, booked.get(intent) ?? 0);
  for (const e of field) {
    const weaponClass = fighterWeaponClass(world, ctx, e);
    const intent = GARRISON_WEAPON_INTENTS.find((i) => INTENT_WEAPON_CLASS[i] === weaponClass);
    if (intent !== undefined) fielded.set(intent, (fielded.get(intent) ?? 0) + 1);
  }
  return fielded;
}

/**
 * The counters this decision's allowance is split over: the armed classes the seat can arm a recruit
 * for, else `trainSoldiers`. Judged for `next`'s tribe and from the barracks door, because the arming
 * pass shops against the recruit's weapon rows from where he stands when it first looks at him.
 */
function draftingClasses(
  world: World,
  ctx: SystemContext,
  player: number,
  barracks: Entity,
  next: Entity,
  vetoed: readonly number[],
): readonly AssistantRecruitIntent[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return GARRISON_WEAPON_INTENTS; // mapless sim: no network to walk
  const tribe = world.get(next, Settler).tribe;
  const door = interactionCell(world, ctx, terrain, barracks);
  const reach = networkLimitAt(world, terrain, player, terrain.xOf(door), terrain.yOf(door));
  const armable = armableIntents(world, ctx, terrain, player, tribe, GARRISON_WEAPON_INTENTS, reach, vetoed);
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
