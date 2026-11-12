import {
  Age,
  ASSISTANT_RECRUIT_INTENTS,
  AssistantChildOrder,
  AssistantCounters,
  type AssistantCounterValues,
  AssistantRecruit,
  type AssistantRecruitIntent,
  AssistantWeaponVetoes,
  assistantCountersEntity,
  ChildOrder,
  Equipment,
  EquipOrder,
  Female,
  hasMissionBehaviour,
  JobAssignment,
  Marriage,
  MISSION_BEHAVIOUR,
  ownerOf,
  Position,
  playerGoodList,
  Residence,
  Rider,
  Settler,
  TrainingOrder,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { mapAiSoldierClaims } from '../ai-shared/military/ownership.js';
import { ownedBuildings, ownedSettlers } from '../ai-shared/seat-roster.js';
import { towerPostFor } from '../conflict/tower-post.js';
import type { System, SystemContext } from '../context.js';
import { childOrderBlocker } from '../family/children/index.js';
import { isMarried } from '../family/eligibility.js';
import { isCivilianTrade } from '../lifecycle/ageclass.js';
import { mayBearChild } from '../orders/family.js';
import { mayChangeTrade } from '../orders/guards.js';
import { mayDrillAt, mayWalkToDrill, startDrill } from '../orders/training.js';
import { hasUnclaimedSeat } from '../orders/training-seats.js';
import { baseSoldierJobType, isBarracks, isSoldierJob } from '../readviews/index.js';
import { anotherSystemOwns } from '../settlers/action-owner.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import type { INTENT_WEAPON_CLASS } from '../settlers/atomics/effects/goods/weapon-class.js';
import { BARRACKS_DRILL_TICKS } from '../settlers/drives/training.js';
import { armingGoodPreference, reachableStock } from '../settlers/planner/recruit-arming.js';
import { FetchableStock, interactionCell } from '../settlers/targets/index.js';
import { goodsSearchLimitAt } from '../signposts/reach.js';
import { hexNodeDistance } from '../spatial/metric.js';
import { entityNode } from '../spatial/nodes.js';
import { foundFamilies } from './families.js';

/**
 * The assistant's production dispatcher: turns the assistant window's `AssistantCounters` into standing child
 * orders, barracks drills and bare soldiers booked for arming. Each dispatch books itself with a marker, and
 * a counter pays only when the product exists, so a recruit lost mid-pipeline re-dispatches instead of
 * silently draining the queue. The same beat founds families (`./families.ts`). Runs before the FamilySystem and the planner, so a fresh child order and a
 * fresh drill both start moving the same tick. Approximation: the counters window is a project
 * reconstruction, and the pacing and dispatch policies are authored, with each order passing the player
 * command's own gates.
 */

/** Decision beat: dispatching is a queue top-up, not a reflex, so one beat a second keeps the scan cost off
 *  the per-tick path. Approximation: nothing decodable to match. */
export const ASSISTANT_DECISION_PERIOD_TICKS = TICKS_PER_SECOND;

/** Drill orders and arming bookings issued per player per beat, the trickle brake: an infinite counter
 *  empties the village into the barracks over minutes, not in one tick. Authored balance. */
const TRAIN_DISPATCHES_PER_DECISION = 2;

export const assistantSystem: System = (world, ctx) => {
  if (ctx.tick % ASSISTANT_DECISION_PERIOD_TICKS !== 0) return;
  // The sweep runs even with every counter back at default: bookings outlive the last carrier (a
  // reset with orders in flight), and a stale one would sit in hashed state until the next write.
  sweepStaleBookings(world, ctx);
  releaseUnaskedArming(world);
  foundFamilies(world, ctx, Math.floor(ctx.tick / ASSISTANT_DECISION_PERIOD_TICKS));
  const carriers = world.canonicalQuery(AssistantCounters);
  if (carriers.length === 0) return; // an idle world pays a few empty queries per beat
  const scans = beatScans(world);
  const seen = new Set<number>();
  for (const carrier of carriers) {
    const { player, counters } = world.get(carrier, AssistantCounters);
    if (seen.has(player)) continue; // lowest-id carrier wins (the rules-singleton convention)
    seen.add(player);
    dispatchBirths(world, ctx, player, counters, scans);
    dispatchTraining(world, ctx, player, counters, scans);
  }
};

/** The beat's per-seat lists, each one seat's in ascending id. `mothers` is one scan built on first ask
 *  and shared across the carriers, which is safe since dispatching adds orders and bookings, never people,
 *  marriages or owners; `people` and `buildings` read the seat rosters. */
interface BeatScans {
  readonly mothers: (player: number) => readonly Entity[];
  readonly people: (player: number) => readonly Entity[];
  readonly buildings: (player: number) => readonly Entity[];
}

function beatScans(world: World): BeatScans {
  let mothers: Map<number, Entity[]> | null = null;
  return {
    mothers: (player) => {
      if (mothers === null) {
        mothers = new Map();
        const wives = world.canonicalQuery(Female, Marriage, Residence);
        for (let i = 0; i < wives.length; i++) {
          const woman = wives[i] as Entity;
          const owner = ownerOf(world, woman);
          if (owner === undefined) continue;
          const held = mothers.get(owner);
          if (held === undefined) mothers.set(owner, [woman]);
          else held.push(woman);
        }
      }
      return mothers.get(player) ?? [];
    },
    people: (player) => ownedSettlers(world, player),
    buildings: (player) => ownedBuildings(world, player),
  };
}

/**
 * Drop bookings whose underlying order vanished or waits on the player, so they stop holding an in-flight
 * slot and the queue re-dispatches. A recruit still drilling, or already enlisted as a soldier, keeps its
 * booking.
 */
function sweepStaleBookings(world: World, ctx: SystemContext): void {
  // Copies, not sorts: removal here is order-independent; the copy only guards the live iteration.
  for (const e of [...world.query(AssistantChildOrder)]) {
    if (!world.has(e, ChildOrder)) {
      world.remove(e, AssistantChildOrder);
      continue;
    }
    const spouse = world.tryGet(e, Marriage)?.spouse;
    if (spouse === undefined || !world.isAlive(spouse)) continue; // the family pass drops a widow's order
    if (childOrderBlocker(world, ctx, e, spouse) === undefined) continue;
    world.remove(e, ChildOrder);
    world.remove(e, AssistantChildOrder);
  }
  for (const e of [...world.query(AssistantRecruit)]) {
    if (world.has(e, TrainingOrder)) continue;
    if (!isSoldierJob(ctx.content, world.get(e, Settler).jobType)) world.remove(e, AssistantRecruit);
  }
}

/**
 * Release the class bookings past their counter that still wait for a weapon out of drill, the newest
 * first, so lowering a counter calls off the arming it no longer asks for and the man stays where he is. One
 * already on his errand finishes it, and a drilling recruit keeps his booking until he leaves the barracks.
 */
function releaseUnaskedArming(world: World): void {
  const unarmed = new Map<number, Map<AssistantRecruitIntent, Entity[]>>();
  for (const e of world.canonicalQuery(AssistantRecruit)) {
    const booking = world.get(e, AssistantRecruit);
    const player = ownerOf(world, e);
    if (booking.armed || booking.intent === 'trainSoldiers' || player === undefined) continue;
    let byIntent = unarmed.get(player);
    if (byIntent === undefined) {
      byIntent = new Map();
      unarmed.set(player, byIntent);
    }
    const men = byIntent.get(booking.intent) ?? [];
    men.push(e);
    byIntent.set(booking.intent, men);
  }
  for (const [player, byIntent] of unarmed) {
    const carrier = assistantCountersEntity(world, player);
    for (const [intent, men] of byIntent) {
      const counter = carrier === null ? null : world.get(carrier, AssistantCounters).counters[intent];
      if (counter?.infinite === true) continue;
      let excess = men.length - (counter?.value ?? 0);
      for (let i = men.length - 1; i >= 0 && excess > 0; i--) {
        const e = men[i];
        if (e === undefined || world.has(e, TrainingOrder) || world.has(e, EquipOrder)) continue;
        world.remove(e, AssistantRecruit);
        excess -= 1;
      }
    }
  }
}

/**
 * Top the standing child orders up to the two birth counters: every eligible mother without an order gets
 * one, daughters first while `extraWomen`'s remainder lasts, then sons. In-flight assistant orders count
 * against the remainder, so a counter of N never books more than N wombs at once.
 */
function dispatchBirths(
  world: World,
  ctx: SystemContext,
  player: number,
  counters: AssistantCounterValues,
  scans: BeatScans,
): void {
  let girlsWanted = counters.extraWomen.value;
  let boysWanted = counters.extraMen.infinite ? Number.POSITIVE_INFINITY : counters.extraMen.value;
  for (const e of world.query(AssistantChildOrder)) {
    if (ownerOf(world, e) !== player) continue;
    if (world.get(e, AssistantChildOrder).sex === 'female') girlsWanted -= 1;
    else boysWanted -= 1;
  }
  if (girlsWanted <= 0 && boysWanted <= 0) return;
  for (const woman of scans.mothers(player)) {
    if (girlsWanted <= 0 && boysWanted <= 0) return;
    if (world.has(woman, ChildOrder)) continue; // her own or an earlier booking - one at a time
    if (!mayBearChild(world, woman)) continue;
    if (childOrderBlocker(world, ctx, woman, world.get(woman, Marriage).spouse) !== undefined) continue;
    const sex = girlsWanted > 0 ? 'female' : 'male';
    world.add(woman, ChildOrder, { child: sex });
    world.add(woman, AssistantChildOrder, { sex });
    if (sex === 'female') girlsWanted -= 1;
    else boysWanted -= 1;
  }
}

/**
 * Book men for the four `train*` counters. Original behavior: every thirty seconds an armed class's counter
 * sends up to six of the player's bare-handed Viking soldiers, chosen at random, for the strongest weapon of
 * the class within his reach, with armour when he wears none, and each unit of the counter also drafts a
 * civilian as `trainSoldiers` does. Departures: every tribe's bare soldiers are armed with their own
 * tribe's weapons, a counter acts only while a barracks stands to gather the armed at, (owner's ruling)
 * while a bare soldier waits, armed now or not, the counter drafts no man in his place, and (owner's
 * request) no recruit waits bare for a weapon the village lacks: a class drafts a civilian only for a
 * weapon in store, and a drilled recruit whose weapon is out moves to an order that can arm him. Authored
 * rules: "free" is an unmarried, trade-less civilist with no workplace that no
 * other drive owns, so nobody is pulled off a job or out of a household, and intents take turns through a
 * beat-rotated round robin, so an infinite counter cannot starve a finite one.
 */
function dispatchTraining(
  world: World,
  ctx: SystemContext,
  player: number,
  counters: AssistantCounterValues,
  scans: BeatScans,
): void {
  const remaining = new Map<AssistantRecruitIntent, number>();
  for (const intent of ASSISTANT_RECRUIT_INTENTS) {
    const counter = counters[intent];
    const target = counter.infinite ? Number.POSITIVE_INFINITY : counter.value;
    if (target > 0) remaining.set(intent, target);
  }
  if (remaining.size === 0) return;
  // The class recruits still waiting for a weapon, drilled or bare: the stock they will take is spoken for.
  const unarmed = new Map<AssistantRecruitIntent, number>();
  for (const e of world.query(AssistantRecruit)) {
    if (ownerOf(world, e) !== player) continue;
    const booking = world.get(e, AssistantRecruit);
    if (booking.armed) continue; // its counter is already paid; only the armor leg remains
    unarmed.set(booking.intent, (unarmed.get(booking.intent) ?? 0) + 1);
    const left = remaining.get(booking.intent);
    if (left !== undefined) remaining.set(booking.intent, left - 1);
  }
  const wanted = ASSISTANT_RECRUIT_INTENTS.filter((intent) => (remaining.get(intent) ?? 0) > 0);
  if (wanted.length === 0) return;
  const houses = ownedBarracks(world, ctx, player, scans);
  if (houses.length === 0) return;

  const beat: TrainingBeat = {
    player,
    wanted,
    remaining,
    unarmed,
    vetoed: playerGoodList(world, AssistantWeaponVetoes, player),
    // Beat-rotated starting intent: fairness without stored state.
    turn: Math.floor(ctx.tick / ASSISTANT_DECISION_PERIOD_TICKS) % wanted.length,
    doorUnits: new Map(),
  };
  const terrain = ctx.terrain;
  if (terrain !== undefined) rebookStrandedRecruits(world, ctx, terrain, beat);
  let budget = TRAIN_DISPATCHES_PER_DECISION;
  // Listed first by a loop that holds no closure, so the seat's every settler costs no allocation here;
  // arming one soldier changes no other's answer.
  const people = scans.people(player);
  const bare: Entity[] = [];
  for (let i = 0; i < people.length; i++) {
    const e = people[i] as Entity;
    if (isBareSoldier(world, ctx, e, player)) bare.push(e);
  }
  for (const e of bare) {
    const { tribe } = world.get(e, Settler);
    const classes = wantedInTurn(wanted, remaining, beat.turn).filter(
      (intent): intent is ClassIntent =>
        intent !== 'trainSoldiers' &&
        armingGoodPreference(ctx.content, tribe, intent, beat.vetoed).length > 0,
    );
    const held = classes[0];
    if (held === undefined) continue;
    beat.turn += 1;
    const free = budget > 0 && !world.has(e, EquipOrder) && !anotherSystemOwns(world, e);
    const at = standingNode(world, e);
    // The first class in turn whose weapon he can fetch now; failing every one, he holds the turn's.
    const taken =
      free && terrain !== undefined && at !== undefined
        ? classes.find((intent) => weaponInReach(world, ctx, terrain, beat, at, tribe, intent, false))
        : undefined;
    const intent = taken ?? held;
    // Taken or not this beat, he holds a slot: no man is drafted while a bare soldier waits for it.
    remaining.set(intent, (remaining.get(intent) ?? 1) - 1);
    if (taken === undefined || terrain === undefined) continue;
    const house = gatheringBarracks(world, ctx, terrain, e, houses);
    if (house === undefined) continue;
    world.add(e, AssistantRecruit, { intent: taken, armed: false, barracks: house });
    unarmed.set(taken, (unarmed.get(taken) ?? 0) + 1);
    budget -= 1;
  }

  // Nothing to draft for: the scan below would be dropped at its first candidate.
  if (budget <= 0 || wantedInTurn(wanted, remaining, beat.turn).length === 0) return;
  for (const e of scans.people(player)) {
    if (!isFreeMan(world, e, player)) continue;
    if (budget <= 0) return;
    const inTurn = wantedInTurn(wanted, remaining, beat.turn);
    if (inTurn.length === 0) return;
    const draft = draftFor(world, ctx, beat, houses, e, inTurn);
    if (draft === null) continue;
    const { house, intent } = draft;
    // Every recruit serves the one standard drill; a class recruit leaves it wearing what gear the barracks
    // holds, and the arming pass fetches the rest.
    startDrill(world, ctx, e, house, BARRACKS_DRILL_TICKS);
    world.add(e, AssistantRecruit, { intent, armed: false, barracks: house });
    remaining.set(intent, (remaining.get(intent) ?? 1) - 1);
    unarmed.set(intent, (unarmed.get(intent) ?? 0) + 1);
    beat.turn += 1;
    budget -= 1;
  }
}

/** One seat's training beat: each intent's headroom and unpaid bookings, kept current as the beat books. */
interface TrainingBeat {
  readonly player: number;
  /** The intents whose counters had headroom at the beat's start, in counter order. */
  readonly wanted: readonly AssistantRecruitIntent[];
  readonly remaining: Map<AssistantRecruitIntent, number>;
  readonly unarmed: Map<AssistantRecruitIntent, number>;
  readonly vetoed: readonly number[];
  /** The round robin's position over `wanted`. */
  turn: number;
  /** The class weapons in reach of a barracks door, by `house/tribe/intent`: drafting moves no stock. */
  readonly doorUnits: Map<string, number>;
}

/**
 * Hand each class recruit out of drill whose class's weapon is gone or out of his reach to the first other
 * class in turn with headroom whose weapon he can fetch, so a sword shortage idles no man a bow order could
 * arm (owner's request). His own class keeps him while its stock covers him past its other unpaid bookings
 * and lies in his reach; with no class to take him he waits for his own. One on his errand already holds a
 * unit and keeps his class.
 */
function rebookStrandedRecruits(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  beat: TrainingBeat,
): void {
  const recruits = world.canonicalQuery(AssistantRecruit);
  for (let i = 0; i < recruits.length; i++) {
    const e = recruits[i] as Entity;
    if (ownerOf(world, e) !== beat.player) continue;
    const { intent: own, armed } = world.get(e, AssistantRecruit);
    if (armed || own === 'trainSoldiers') continue;
    if (world.has(e, TrainingOrder) || world.has(e, EquipOrder)) continue;
    const at = standingNode(world, e);
    if (at === undefined) continue;
    const { tribe } = world.get(e, Settler);
    if (weaponInReach(world, ctx, terrain, beat, at, tribe, own, true)) continue;
    const taker = wantedInTurn(beat.wanted, beat.remaining, beat.turn).find(
      (intent): intent is ClassIntent =>
        intent !== 'trainSoldiers' &&
        intent !== own &&
        weaponInReach(world, ctx, terrain, beat, at, tribe, intent, false),
    );
    if (taker === undefined) continue;
    world.mut(e, AssistantRecruit).intent = taker;
    beat.unarmed.set(own, (beat.unarmed.get(own) ?? 1) - 1);
    beat.unarmed.set(taker, (beat.unarmed.get(taker) ?? 0) + 1);
    beat.remaining.set(own, (beat.remaining.get(own) ?? 0) + 1);
    beat.remaining.set(taker, (beat.remaining.get(taker) ?? 1) - 1);
    beat.turn += 1;
  }
}

/** Where a man is drafted and the counter he serves. */
interface Draft {
  readonly house: Entity;
  readonly intent: AssistantRecruitIntent;
}

/**
 * Where and for what `e` is drafted: the first of `inTurn` that arms no weapon or whose weapon the side's
 * stock holds for him, at the first barracks he may drill at whose door reaches that weapon; null while
 * none fits, so the village drafts nobody to wait bare for a weapon it lacks.
 */
function draftFor(
  world: World,
  ctx: SystemContext,
  beat: TrainingBeat,
  houses: readonly Entity[],
  e: Entity,
  inTurn: readonly AssistantRecruitIntent[],
): Draft | null {
  const { tribe } = world.get(e, Settler);
  const terrain = ctx.terrain;
  let drillable: readonly Entity[] | undefined;
  for (const intent of inTurn) {
    if (intent === 'trainSoldiers') {
      drillable ??= drillableHouses(world, ctx, e, houses);
      const house = drillable[0];
      if (house !== undefined) return { house, intent };
      continue;
    }
    // Without a map no arming errand runs.
    if (terrain === undefined || !classStockCovers(world, ctx, beat, tribe, intent, false)) continue;
    drillable ??= drillableHouses(world, ctx, e, houses);
    const house = drillable.find((h) => doorReaches(world, ctx, terrain, beat, h, tribe, intent));
    if (house !== undefined) return { house, intent };
  }
  return null;
}

/** The barracks `e` may drill at, those with a seat to spare first, so a full one does not queue men
 *  another could take now. */
function drillableHouses(
  world: World,
  ctx: SystemContext,
  e: Entity,
  houses: readonly Entity[],
): readonly Entity[] {
  const spare: Entity[] = [];
  const full: Entity[] = [];
  for (const house of houses) {
    if (!mayDrillAt(world, ctx, e, house)) continue;
    if (hasUnclaimedSeat(world, ctx, house)) spare.push(house);
    else full.push(house);
  }
  return spare.concat(full);
}

/** Whether `house`'s door reaches a weapon of `intent`'s class for a `tribe` recruit past the class's unpaid
 *  bookings, its count read once per beat. */
function doorReaches(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  beat: TrainingBeat,
  house: Entity,
  tribe: number,
  intent: ClassIntent,
): boolean {
  const key = `${house}/${tribe}/${intent}`;
  let units = beat.doorUnits.get(key);
  if (units === undefined) {
    const door = interactionCell(world, ctx, terrain, house);
    units = classUnitsInReach(
      world,
      ctx,
      terrain,
      beat,
      { hx: terrain.xOf(door), hy: terrain.yOf(door) },
      tribe,
      intent,
    );
    beat.doorUnits.set(key, units);
  }
  return units > unpaidAhead(beat, intent, false);
}

/**
 * The barracks a bare soldier the counter arms gathers at, as a drafted recruit does at the one he drilled
 * at: the nearest by door he may walk to, the lower id breaking a tie, else the first standing. The outing
 * makes its door his post, so a far one would station him across the map.
 */
function gatheringBarracks(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  houses: readonly Entity[],
): Entity | undefined {
  const here = entityNode(world, terrain, e);
  let nearest: Entity | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const house of houses) {
    if (!mayWalkToDrill(world, ctx, e, house)) continue;
    const distance = hexNodeDistance(terrain, here, interactionCell(world, ctx, terrain, house, here));
    if (distance < nearestDistance) {
      nearest = house;
      nearestDistance = distance;
    }
  }
  return nearest ?? houses[0];
}

/** The half-cell node `e` stands on, or undefined without a position. */
function standingNode(world: World, e: Entity): HalfCellNode | undefined {
  const p = world.tryGet(e, Position);
  return p === undefined ? undefined : nodeOfPosition(p.x, p.y);
}

/** The intents with headroom in round-robin order from `turn` over the beat's wanted list. */
function wantedInTurn(
  wanted: readonly AssistantRecruitIntent[],
  remaining: ReadonlyMap<AssistantRecruitIntent, number>,
  turn: number,
): AssistantRecruitIntent[] {
  const inTurn: AssistantRecruitIntent[] = [];
  for (let i = 0; i < wanted.length; i++) {
    const intent = wanted[(turn + i) % wanted.length];
    if (intent !== undefined && (remaining.get(intent) ?? 0) > 0) inTurn.push(intent);
  }
  return inTurn;
}

/** A counter that arms its men: every training intent but the plain soldiers'. */
type ClassIntent = keyof typeof INTENT_WEAPON_CLASS;

/** `player`'s standing barracks, ascending entity id (the deterministic house preference). */
function ownedBarracks(world: World, ctx: SystemContext, player: number, scans: BeatScans): Entity[] {
  return scans.buildings(player).filter((e) => isBarracks(world, ctx, e));
}

/**
 * Whether `e` is `player`'s bare-handed soldier an armed class's counter arms before drafting anyone: the
 * unarmed base trade with no weapon worn and no booking, out of the vehicles. Authored: the tower, script
 * and trade-lock exclusions, off the towers, held by no map script and with a trade the arming may change.
 * Shared with the AI's garrison sizing, so its counters count the men this dispatcher holds slots for.
 */
export function isBareSoldier(world: World, ctx: SystemContext, e: Entity, player: number): boolean {
  if (ownerOf(world, e) !== player) return false;
  const { jobType } = world.get(e, Settler);
  if (jobType === null || jobType !== baseSoldierJobType(ctx.content)) return false;
  if ((world.tryGet(e, Equipment)?.weapon ?? null) !== null) return false;
  if (world.has(e, AssistantRecruit) || world.has(e, TrainingOrder) || world.has(e, Rider)) return false;
  if (
    !mayChangeTrade(world, ctx.content, e) ||
    hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)
  )
    return false;
  if (mapAiSoldierClaims(world, player).has(e)) return false;
  return towerPostFor(world, ctx, e, jobType) === null;
}

/** Whether a man of `tribe` standing `at` could be armed for `intent` now: the class's weapons inside his
 *  goods reach outnumber its unpaid bookings, less his own when he holds one of them (`booked`). He is
 *  taken, kept or drafted for a class only when its weapon is his to fetch. */
function weaponInReach(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  beat: TrainingBeat,
  at: HalfCellNode,
  tribe: number,
  intent: ClassIntent,
  booked: boolean,
): boolean {
  return (
    classStockCovers(world, ctx, beat, tribe, intent, booked) &&
    classUnitsInReach(world, ctx, terrain, beat, at, tribe, intent) > unpaidAhead(beat, intent, booked)
  );
}

/** The class's unpaid bookings this beat, less the asking man's own when he holds one of them (`booked`). */
function unpaidAhead(beat: TrainingBeat, intent: ClassIntent, booked: boolean): number {
  return (beat.unarmed.get(intent) ?? 0) - (booked ? 1 : 0);
}

/** Whether the side's stock of `intent`'s class anywhere outnumbers {@link unpaidAhead}: the cheap bound
 *  checked before the count inside a reach. */
function classStockCovers(
  world: World,
  ctx: SystemContext,
  beat: TrainingBeat,
  tribe: number,
  intent: ClassIntent,
  booked: boolean,
): boolean {
  const stock = FetchableStock.of(world, ctx);
  let units = 0;
  for (const good of armingGoodPreference(ctx.content, tribe, intent, beat.vetoed)) {
    units += stock.lendableUnits(beat.player, good);
  }
  return units > unpaidAhead(beat, intent, booked);
}

/** The units of `intent`'s class weapons a `tribe` recruit standing `at` may fetch: the side's and nobody's
 *  stores inside the goods reach there ({@link reachableStock}). */
function classUnitsInReach(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  beat: TrainingBeat,
  at: HalfCellNode,
  tribe: number,
  intent: ClassIntent,
): number {
  const reach = goodsSearchLimitAt(world, ctx.content, terrain, beat.player, at.hx, at.hy);
  const stock = reachableStock(world, ctx, terrain, beat.player, reach);
  let units = 0;
  for (const good of armingGoodPreference(ctx.content, tribe, intent, beat.vetoed)) {
    units += stock.units(good);
  }
  return units;
}

/**
 * Whether the assistant may take `e` for a drill: `player`'s adult, unmarried, trade-less man that no
 * other drive owns and no errand occupies; `mayDrillAt` re-checks the rest
 * per house. The civilist trade implies "adult man", the `jobType: null` shape does not, so women and
 * children are excluded explicitly.
 */
function isFreeMan(world: World, e: Entity, player: number): boolean {
  if (ownerOf(world, e) !== player) return false;
  if (!isCivilianTrade(world.get(e, Settler).jobType)) return false;
  if (world.has(e, Female) || world.has(e, Age) || isMarried(world, e)) return false;
  if (world.has(e, JobAssignment) || world.has(e, TrainingOrder) || world.has(e, AssistantRecruit))
    return false;
  if (world.has(e, EquipOrder) || atomicHoldsSettler(world, e)) return false;
  if (anotherSystemOwns(world, e)) return false;
  // A man already wearing a weapon good is no arming candidate: the slot this queue would fill is taken,
  // and the class transform only fires when a soldier takes one up.
  return (world.tryGet(e, Equipment)?.weapon ?? null) === null;
}
