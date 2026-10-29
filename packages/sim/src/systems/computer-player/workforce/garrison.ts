import type { ContentSet } from '@open-northland/data';
import {
  AssistantRecruit,
  type AssistantRecruitIntent,
  AssistantWeaponVetoes,
  Building,
  Carrying,
  computerModuleRuns,
  Equipment,
  Female,
  ownerOf,
  playerGoodList,
  Settler,
  seatPeaceEndTick,
  TrainingOrder,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { fighterStrength, fighterWeaponClass } from '../../ai-shared/military/census.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SpareForce } from '../../ai-shared/workforce/pool.js';
import { draftableTrade, isBareSoldier } from '../../assistant/index.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { isMarried, mayMarry } from '../../family/eligibility.js';
import { CIVILIST_JOB } from '../../lifecycle/ageclass.js';
import { baseSoldierJobType, isFighterJob, isSoldierJob } from '../../readviews/index.js';
import { INTENT_WEAPON_CLASS } from '../../settlers/atomics/effects/goods/weapon-class.js';
import { armableIntents, armingGoodPreference } from '../../settlers/planner/recruit-arming.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { seatStockOf } from '../../stores/index.js';
import { assistantCounterCommand } from '../assistant-counters.js';
import { seatBarracksOf } from '../base.js';
import { type ComputerProfile, type Share, shareOf } from '../difficulty.js';
import { ownArmyPoints, strongestBelievedEnemy } from '../military/enemy-strength.js';
import { WAVE_MIN_SOLDIERS } from '../military/muster.js';
import { WAVE_GATHER_TICKS } from '../military/plan.js';
import { militaryOrdersOf } from '../strategy/military.js';
import { COLLECTED_GOOD_IDS } from './collectors/index.js';
import { productsOf } from './craft.js';
import type { SeatSupply } from './supply.js';

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
 *  the drill enlists into - the fallback for a seat that can arm nobody and has no weapon shop yet. */
const GARRISON_INTENTS: readonly AssistantRecruitIntent[] = ['trainSoldiers', ...GARRISON_WEAPON_INTENTS];

/** The army floor's smallest size (authored): twice the smallest wave the campaign sends, so one band
 *  can march while another still holds the door. */
export const ARMY_FLOOR_MIN = 2 * WAVE_MIN_SOLDIERS;

/** How long before the seat's peace ends the army floor starts drafting (authored): one wave gather
 *  window, so the first band stands at the door when the peace runs out. */
export const ARMY_FLOOR_LEAD_TICKS = WAVE_GATHER_TICKS;

/** This decision's arming judgement, shared by the army floor and the draft so both read one answer. */
export interface GarrisonArms {
  /** The weapon veto changes the seat still needs ({@link weaponVetoChanges}); the draft publishes them. */
  readonly vetoChanges: readonly WeaponVetoChange[];
  /** The classes a draft splits over ({@link draftingClasses}), judged once, for the first man asked about. */
  classesFor(barracks: Entity, next: Entity): readonly AssistantRecruitIntent[];
  /** The seat's {@link bachelorSurplus}, counted once for the floor and the draft. */
  surplus(): number;
  /** The seat's {@link armyOnHand}, counted once for the floor and the draft. */
  onHand(): number;
}

export function garrisonArms(
  world: World,
  ctx: SystemContext,
  player: number,
  profile: ComputerProfile,
): GarrisonArms {
  const vetoed = playerGoodList(world, AssistantWeaponVetoes, player);
  const vetoChanges = weaponVetoChanges(world, ctx, player, vetoed, profile);
  // The changes land a tick later, so this decision's draft already judges the arms as they will stand.
  const judged = [
    ...vetoed.filter((good) => !vetoChanges.some((c) => c.goodType === good && !c.vetoed)),
    ...vetoChanges.filter((c) => c.vetoed).map((c) => c.goodType),
  ];
  let classes: readonly AssistantRecruitIntent[] | undefined;
  let surplus: number | undefined;
  let onHand: number | undefined;
  return {
    vetoChanges,
    classesFor: (barracks, next) => {
      classes ??= draftingClasses(world, ctx, player, barracks, next, judged);
      return classes;
    },
    surplus: () => {
      surplus ??= bachelorSurplus(world, ctx, player);
      return surplus;
    },
    onHand: () => {
      onHand ??= armyOnHand(world, ctx, player);
      return onHand;
    },
  };
}

/** The part of the builder reserve the army floor never reclaims (authored): a third, so the seat's
 *  sites keep a crew while the spare men past it drill. On magiczny_las the reserve held every spare man,
 *  one to seven builders against a cap of twelve, for the first hour and no seat drafted anyone; with a
 *  third kept every seat drafted between game minutes 36 and 57, with half one seat never did. */
export const ARMY_FLOOR_BUILDER_CORE: Share = { num: 1, den: 3 };

/** The builder reserve's men past its core ({@link ARMY_FLOOR_BUILDER_CORE}) of `cap`, the last claimed
 *  first: the fresh men it was about to turn builders ahead of the builders it kept. */
export function upperReserve(reserved: readonly Entity[], cap: number): readonly Entity[] {
  return reserved.slice(shareOf(cap, ARMY_FLOOR_BUILDER_CORE)).reverse();
}

/** The builders past the reserve's core the army floor may reclaim, and the builder trade they hold, and
 *  the gatherers it may call to arms ({@link calledGatherers}). */
export interface ReclaimableReserve {
  readonly men: readonly Entity[];
  readonly builderJob: number | null;
  readonly gatherers?: readonly Entity[];
}

/** The army floor's claim: the men it drafts, and the commands turning a reclaimed builder back into a
 *  civilian the drill takes. */
export interface ArmyFloorClaim {
  readonly men: readonly Entity[];
  readonly commands: readonly PlayerCommand[];
}

const NO_CLAIM: ArmyFloorClaim = { men: [], commands: [] };

/**
 * The army floor: once the seat's peace is within {@link ARMY_FLOOR_LEAD_TICKS} of its end ({@link
 * seatPeaceEndTick}, the start when there is none), the seat keeps its profile's share of the fighters its
 * strongest enemy fields ({@link enemyInOwnMen}), scaled by its military plan and posture
 * (`strategy/military.ts`), never fewer than {@link ARMY_FLOOR_MIN} and never past a cap it drafts to. Its
 * fighters and the recruits already in drill count toward it, so only the missing men are claimed out of
 * `force`, which the ladder calls after the target-tier posts and ahead of the surplus ones: a seat staffs
 * what it built, and the trades that could absorb every man still leave an army. While the draft can arm a
 * class, the floor also reclaims the builder reserve past its core (`reserve`): the reserve takes every
 * spare man of a small seat, which would otherwise never drill. Capped by the {@link bachelorSurplus} and
 * by the men draftable at all, and nobody is claimed while the draft has no class to put him in.
 * Returns the claimed men for {@link trainGarrison} to publish and the reclaimed builders' retrades.
 */
export function claimArmyFloor(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
  arms: GarrisonArms,
  profile: ComputerProfile,
  reserve: ReclaimableReserve = { men: [], builderJob: null },
): ArmyFloorClaim {
  const barracks = drillFloorOf(world, ctx, player);
  if (barracks === null) return NO_CLAIM;
  if (ctx.tick < seatPeaceEndTick(world, player) - ARMY_FLOOR_LEAD_TICKS) return NO_CLAIM;
  // The seat's own roster settles the draftable count before the enemies' rosters are walked.
  const surplus = arms.surplus();
  if (surplus <= 0) return NO_CLAIM;
  const orders = militaryOrdersOf(world, player);
  const floor = Math.max(
    ARMY_FLOOR_MIN,
    shareOf(shareOf(enemyInOwnMen(world, ctx, player), profile.army.floorShare), orders.floorShare),
  );
  const missing = draftCeiling(profile, orders.draftCapShare, floor) - arms.onHand();
  const claim = Math.min(missing, surplus);
  if (claim <= 0) return NO_CLAIM;
  // A man the floor retrades waits until he sets his load down, since the trade change would drop it.
  const unloaded = (e: Entity): boolean => isDraftable(world, e) || !world.has(e, Carrying);
  const reclaimable = [
    ...reserve.men.filter((e) => isReclaimable(world, e, reserve.builderJob)),
    ...(reserve.gatherers ?? []).filter((e) => isUnarmedBachelor(world, e)),
  ].filter(unloaded);
  const next = force.remaining().find((e) => isDraftable(world, e)) ?? reclaimable[0];
  if (next === undefined) return NO_CLAIM;
  const classes = arms.classesFor(barracks, next);
  if (classes.length === 0) return NO_CLAIM;
  const men: Entity[] = [];
  while (men.length < claim) {
    const recruit = force.take((e) => isDraftable(world, e));
    if (recruit === null) break;
    men.push(recruit);
  }
  if (!classes.some(isWeaponIntent)) return { men, commands: [] };
  const commands: PlayerCommand[] = [];
  for (const e of reclaimable) {
    if (men.length >= claim) break;
    men.push(e);
    if (!isDraftable(world, e)) commands.push({ kind: 'setJob', entity: e, jobType: CIVILIST_JOB });
  }
  return { men, commands };
}

/**
 * The gatherers the army floor may call to arms while the seat prepares against a forecast attack within
 * its lead (`callsGatherers`, {@link militaryOrdersOf}): holders of a good whose stock lies at or above its
 * comfort line ({@link SeatSupply.lines}), the least practised first, never an apprentice and never a
 * building good's last gatherer ({@link COLLECTED_GOOD_IDS}). Owner ruling: on mroczny_las every man of a
 * seat held a post and its army grew by two to five before the first scripted wave. A soldier never turns
 * back, so the posts are refilled by the seat's next civilians once the call ends with the threat.
 * `collectorsByGood` lists each good's holders most practised first, as the workforce classifies them.
 */
export function calledGatherers(
  world: World,
  ctx: SystemContext,
  player: number,
  collectorsByGood: ReadonlyMap<number, readonly Entity[]>,
  supply: SeatSupply,
  apprentices: ReadonlySet<Entity>,
): readonly Entity[] {
  if (!militaryOrdersOf(world, player).callsGatherers) return [];
  const called: Entity[] = [];
  for (const [goodType, holders] of [...collectorsByGood].sort(([a], [b]) => a - b)) {
    const lines = supply.lines(goodType);
    const surplus = supply.surplus(goodType);
    if (lines === undefined || surplus === undefined || surplus < lines.comfort) continue;
    const kept = buildingGoods(ctx.content).has(goodType) ? 1 : 0;
    const callable = holders.filter((e) => !apprentices.has(e) && isUnarmedBachelor(world, e));
    const spared = Math.min(callable.length, holders.length - kept);
    called.push(...callable.slice(callable.length - spared).reverse());
  }
  return called;
}

const buildingGoodsByContent = new WeakMap<ContentSet, ReadonlySet<number>>();

function buildingGoods(content: ContentSet): ReadonlySet<number> {
  const known = buildingGoodsByContent.get(content);
  if (known !== undefined) return known;
  const goods = new Set<number>();
  for (const id of COLLECTED_GOOD_IDS) {
    const good = goodTypeByContentId(content, id);
    if (good !== undefined) goods.add(good.typeId);
  }
  buildingGoodsByContent.set(content, goods);
  return goods;
}

/**
 * The garrison sizing: this rung only holds the assistant's training counters at the number of men the
 * settlement can spare, and the dispatcher (`systems/assistant/`) drafts, walks and drills them. Only a
 * lower difficulty caps the army ({@link ComputerProfile.army}); otherwise its real bound is breeding: a fighter
 * neither marries nor fathers children and the conversion is one-way, so the allowance counts only
 * unmarried spare men beyond the seat's waiting brides ({@link bachelorSurplus}). Runs last in the
 * workforce ladder, so it sees the men the army floor claimed (`floorMen`, {@link claimArmyFloor}) and
 * the men left unclaimed by every post, reserve and flag.
 */
export function trainGarrison(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
  floorMen: readonly Entity[],
  arms: GarrisonArms,
  profile: ComputerProfile,
): PlayerCommand[] {
  const wants = standingOrder(
    world,
    ctx,
    player,
    [...floorMen, ...draftableSpare(world, force)],
    arms,
    profile,
  );
  const counters = GARRISON_INTENTS.flatMap((intent) => {
    const command = assistantCounterCommand(world, player, intent, wants.get(intent) ?? 0, false);
    return command === null ? [] : [command];
  });
  const vetoes = arms.vetoChanges.map(
    ({ goodType, vetoed }): PlayerCommand => ({ kind: 'setAssistantWeaponVeto', player, goodType, vetoed }),
  );
  return [...vetoes, ...counters];
}

/** The seat's barracks when it may drill at all: the military module runs, the content has a soldier
 *  trade, and a barracks stands, since the drill is the seat's only route to a soldier. */
function drillFloorOf(world: World, ctx: SystemContext, player: number): Entity | null {
  if (!computerModuleRuns(world, player, 'military')) return null;
  if (baseSoldierJobType(ctx.content) === null) return null;
  return seatBarracksOf(world, ctx, player);
}

/** The most fighters `profile`'s seat drafts toward: `wanted`, or where it drafts to its army cap, the
 *  `capShare` of that cap its plan drafts to. */
function draftCeiling(profile: ComputerProfile, capShare: Share, wanted: number): number {
  return profile.army.draftToCap ? Math.min(wanted, shareOf(profile.army.cap, capShare)) : wanted;
}

/** The strongest believed enemy's army ({@link strongestBelievedEnemy}) in men of the seat's own average
 *  points, so a better-armed seat needs fewer; his head count while the seat has no army or knows no
 *  points. */
function enemyInOwnMen(world: World, ctx: SystemContext, player: number): number {
  const enemy = strongestBelievedEnemy(world, ctx, player);
  if (enemy.points === null) return enemy.men;
  const own = ownArmyPoints(world, ctx, player);
  if (own.men === 0 || own.points === 0) return enemy.men;
  return Math.ceil((enemy.points * own.men) / own.points);
}

/** The seat's army as the floor counts it: its live fighters ({@link fighterStrength}) plus the booked
 *  recruits still in drill, who are no fighters yet. */
function armyOnHand(world: World, ctx: SystemContext, player: number): number {
  const drilling = unpaidBookings(world, ctx, player).filter(
    (e) => !isFighterJob(ctx.content, world.get(e, Settler).jobType),
  );
  return fighterStrength(world, ctx, player) + drilling.length;
}

/** One weapon good to veto or to release on the seat. */
export interface WeaponVetoChange {
  readonly goodType: number;
  readonly vetoed: boolean;
}

/** How many of a class's best weapons beyond its recruits waiting for one the seat holds before it vetoes
 *  the class's weaker ones (authored): a few in hand, so the next draft finds them. On magiczny_las a
 *  veto at the first long sword was lifted again as soon as a recruit took it, up to ten veto commands a
 *  seat in 83 game minutes. */
export const WEAPON_VETO_STOCK_MARGIN = 3;

/** Below this stock of a class's best weapon a standing veto on its weaker ones is lifted (authored): the
 *  last one gone, so the class is armed with what the seat has rather than not at all. */
export const WEAPON_VETO_LIFT_STOCK = 1;

/**
 * The AI arms its recruits only with each class's best weapon (authored): short swords, wooden spears and
 * short bows would field weak men, and the short swords and wooden spears its own shops make are inputs
 * to amulets and iron spears. A weaker good ({@link weakerWeaponGoods}) is vetoed once the seat holds
 * enough of a best weapon it ranks below ({@link seatStockOf}) to arm that class's waiting recruits and
 * {@link WEAPON_VETO_STOCK_MARGIN} more, and the veto is lifted only when no best weapon above it is left
 * ({@link WEAPON_VETO_LIFT_STOCK}), so the veto does not flip with every weapon forged and taken. A seat
 * whose smiths have yet to forge the long sword arms with the short one meanwhile (owner ruling: the smith
 * opens on the short sword, the long sword comes later). The changes from the seat's `vetoed` goods; none
 * while the military module is off, and an easy seat ({@link ComputerProfile.weakerWeapons}) wants no veto.
 */
function weaponVetoChanges(
  world: World,
  ctx: SystemContext,
  player: number,
  vetoed: readonly number[],
  profile: ComputerProfile,
): readonly WeaponVetoChange[] {
  if (!computerModuleRuns(world, player, 'military')) return [];
  const marks = profile.weakerWeapons ? null : bestWeaponMarks(world, ctx, player);
  const changes: WeaponVetoChange[] = [];
  for (const goodType of weakerWeaponGoods(ctx.content)) {
    const held = vetoed.includes(goodType);
    const want = marks === null ? false : held ? !marks.lift.has(goodType) : marks.veto.has(goodType);
    if (want !== held) changes.push({ goodType, vetoed: want });
  }
  return changes;
}

/** The weaker weapon goods some armed class may veto now ({@link WEAPON_VETO_STOCK_MARGIN}), and those every
 *  class ranking them below its best has run out of ({@link WEAPON_VETO_LIFT_STOCK}). */
interface BestWeaponMarks {
  readonly veto: ReadonlySet<number>;
  readonly lift: ReadonlySet<number>;
}

function bestWeaponMarks(world: World, ctx: SystemContext, player: number): BestWeaponMarks {
  const weaker = new Set(weakerWeaponGoods(ctx.content));
  const stock = seatStockOf(world, player);
  const waiting = bookedByIntent(world, ctx, player);
  const veto = new Set<number>();
  const kept = new Set<number>();
  for (const tribe of weaponTribes(ctx.content)) {
    for (const intent of GARRISON_WEAPON_INTENTS) {
      const [strongest, ...rest] = armingGoodPreference(ctx.content, tribe, intent, []);
      if (strongest === undefined) continue;
      const units = stock.units(strongest);
      const covers = units >= (waiting.get(intent) ?? 0) + WEAPON_VETO_STOCK_MARGIN;
      for (const good of rest) {
        if (!weaker.has(good)) continue;
        if (covers) veto.add(good);
        if (units >= WEAPON_VETO_LIFT_STOCK) kept.add(good);
      }
    }
  }
  return { veto, lift: new Set([...weaker].filter((good) => !kept.has(good))) };
}

const weakerWeaponsByContent = new WeakMap<ContentSet, readonly number[]>();

/** The weapon goods, ascending, that some tribe's armed class ranks below its best and none ranks best. */
function weakerWeaponGoods(content: ContentSet): readonly number[] {
  const known = weakerWeaponsByContent.get(content);
  if (known !== undefined) return known;
  const best = new Set<number>();
  const weaker = new Set<number>();
  for (const tribe of weaponTribes(content)) {
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
 * The wanted value per counter: its own unpaid bookings ({@link bookedByIntent}) plus a share of the seat's
 * bare-handed soldiers, whom the dispatcher arms before it drafts anyone ({@link isBareSoldier}), and of
 * the `draftable` men (the army floor's first, then the spare), so the headroom the dispatcher sees
 * (`counter - bookings`) sums to exactly that number. Each man goes to the armable class furthest below
 * its field share ({@link fieldedByIntent}, {@link FULL_FIELD_SHARES}), the earlier class on a tie. A seat
 * that can arm none of them leaves its bare soldiers as they stand and drafts by {@link draftingClasses}'
 * fallback: `trainSoldiers`, or nobody.
 */
function standingOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  draftable: readonly Entity[],
  arms: GarrisonArms,
  profile: ComputerProfile,
): Map<AssistantRecruitIntent, number> {
  const wants = new Map<AssistantRecruitIntent, number>();
  const barracks = drillFloorOf(world, ctx, player);
  if (barracks === null) return wants;

  const booked = bookedByIntent(world, ctx, player);
  for (const intent of GARRISON_INTENTS) wants.set(intent, booked.get(intent) ?? 0);

  const bare = ownedSettlers(world, player).filter((e) => isBareSoldier(world, ctx, e, player));
  const { draftCapShare } = militaryOrdersOf(world, player);
  const headroom = draftCeiling(profile, draftCapShare, Number.POSITIVE_INFINITY) - arms.onHand();
  const allowance = Math.max(0, Math.min(draftable.length, arms.surplus(), headroom));
  const judged = bare[0] ?? (allowance > 0 ? draftable[0] : undefined);
  if (judged === undefined) return wants; // nobody to arm or draft: the classes need no probe
  const classes = arms.classesFor(barracks, judged);
  if (classes.length === 0) return wants;
  const fielded = fieldedByIntent(world, ctx, player, booked);
  shareOut(bare.length, classes.filter(isWeaponIntent), fielded, wants);
  shareOut(allowance, classes, fielded, wants);
  return wants;
}

/** Add `count` men to `wants`, each to the class of `classes` furthest below its field share in `fielded`,
 *  which counts him there. Full shares apply only over all three armed classes. */
function shareOut(
  count: number,
  classes: readonly AssistantRecruitIntent[],
  fielded: Map<AssistantRecruitIntent, number>,
  wants: Map<AssistantRecruitIntent, number>,
): void {
  if (count === 0 || classes.length === 0) return;
  const full = GARRISON_WEAPON_INTENTS.every((intent) => classes.includes(intent));
  const shares = classes.map((intent) => (full && isWeaponIntent(intent) ? FULL_FIELD_SHARES[intent] : 1));
  const standing = classes.map((intent) => fielded.get(intent) ?? 0);
  // standing / share compared by cross-multiplication, so the pick stays in integers.
  const behind = (i: number, j: number): boolean =>
    (standing[i] ?? 0) * (shares[j] ?? 1) < (standing[j] ?? 0) * (shares[i] ?? 1);
  for (let added = 0; added < count; added++) {
    let rank = 0;
    for (let i = 1; i < classes.length; i++) if (behind(i, rank)) rank = i;
    const intent = classes[rank];
    if (intent === undefined) break;
    standing[rank] = (standing[rank] ?? 0) + 1;
    fielded.set(intent, standing[rank] ?? 0);
    wants.set(intent, (wants.get(intent) ?? 0) + 1);
  }
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
 * for. When it can arm none, `trainSoldiers` while no weapon shop stands, since fists are the only army
 * such a seat can have, and nothing once one does: the men wait for the arms it makes. Judged for
 * `next`'s tribe and from the barracks door, because the arming pass shops against the recruit's weapon
 * rows from where he stands when it first looks at him.
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
  if (armable.length > 0) return armable;
  return weaponShopStands(world, ctx, player) ? [] : ['trainSoldiers'];
}

/** Whether a finished building of the seat makes a good that arms a garrison class. */
function weaponShopStands(world: World, ctx: SystemContext, player: number): boolean {
  const shops = weaponShopTypes(ctx);
  return ownedBuildings(world, player).some(
    (e) => shops.has(world.get(e, Building).buildingType) && isBuilt(world, e),
  );
}

const weaponShopsByContent = new WeakMap<ContentSet, ReadonlySet<number>>();

/** The building types whose products ({@link productsOf}) include a good some tribe arms a garrison class
 *  with ({@link armingGoodPreference}). */
function weaponShopTypes(ctx: SystemContext): ReadonlySet<number> {
  const known = weaponShopsByContent.get(ctx.content);
  if (known !== undefined) return known;
  const weapons = new Set<number>();
  for (const tribe of weaponTribes(ctx.content)) {
    for (const intent of GARRISON_WEAPON_INTENTS) {
      for (const good of armingGoodPreference(ctx.content, tribe, intent, [])) weapons.add(good);
    }
  }
  const shops = new Set(
    ctx.content.buildings
      .filter((type) => productsOf(ctx, type).some((good) => weapons.has(good)))
      .map((type) => type.typeId),
  );
  weaponShopsByContent.set(ctx.content, shops);
  return shops;
}

/** The tribes some weapon row names. */
function weaponTribes(content: ContentSet): ReadonlySet<number> {
  return new Set(content.weapons.flatMap((w) => (w.tribeType === undefined ? [] : [w.tribeType])));
}

/** The spare men the dispatcher could still draft, in its own draft order. Men already booked are not
 *  here - each of their counters carries them. */
function draftableSpare(world: World, force: SpareForce): Entity[] {
  return force.remaining().filter((e) => isDraftable(world, e));
}

/** A reserved man the floor may draft: one {@link isDraftable} already, or an unmarried, unarmed builder the
 *  floor turns back into a civilian first. */
function isReclaimable(world: World, e: Entity, builderJob: number | null): boolean {
  if (isDraftable(world, e)) return true;
  return builderJob !== null && world.get(e, Settler).jobType === builderJob && isUnarmedBachelor(world, e);
}

/** An unmarried man wearing no weapon good: one the drill takes once his trade is a civilian's. */
function isUnarmedBachelor(world: World, e: Entity): boolean {
  return !isMarried(world, e) && (world.tryGet(e, Equipment)?.weapon ?? null) === null;
}

function isDraftable(world: World, e: Entity): boolean {
  if (!draftableTrade(world.get(e, Settler).jobType) || isMarried(world, e)) return false;
  // A man wearing a weapon good (a manual civilian equip) is persistently undraftable - counting
  // him would leave the published want standing unfillable.
  return (world.tryGet(e, Equipment)?.weapon ?? null) === null;
}

/** The seat's marriageable men beyond its marriageable women, the men the family plan will never need
 *  as husbands. */
function bachelorSurplus(world: World, ctx: SystemContext, player: number): number {
  let surplus = 0;
  for (const e of ownedSettlers(world, player)) {
    if (!mayMarry(world, ctx.content, e)) continue;
    surplus += world.has(e, Female) ? -1 : 1;
  }
  return surplus;
}

/** The seat's in-flight bookings per counter, still unpaid ({@link unpaidBookings}). */
function bookedByIntent(
  world: World,
  ctx: SystemContext,
  player: number,
): Map<AssistantRecruitIntent, number> {
  const booked = new Map<AssistantRecruitIntent, number>();
  for (const e of unpaidBookings(world, ctx, player)) {
    const { intent } = world.get(e, AssistantRecruit);
    booked.set(intent, (booked.get(intent) ?? 0) + 1);
  }
  return booked;
}

/** The seat's recruits booked on a garrison counter and still unpaid (`armed` marks the payment for a
 *  class recruit). A booking whose drill was abandoned is excluded: its man is back in the spare pool, and
 *  counting both sides would publish one recruit past the bachelor cap. */
function unpaidBookings(world: World, ctx: SystemContext, player: number): Entity[] {
  const recruits: Entity[] = [];
  for (const e of world.query(AssistantRecruit)) {
    if (ownerOf(world, e) !== player) continue;
    const booking = world.get(e, AssistantRecruit);
    if (booking.armed || !GARRISON_INTENTS.includes(booking.intent)) continue;
    if (!world.has(e, TrainingOrder) && !isSoldierJob(ctx.content, world.get(e, Settler).jobType)) continue;
    recruits.push(e);
  }
  return recruits;
}
