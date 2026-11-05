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
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { mapAiSoldierClaims } from '../ai-shared/military/ownership.js';
import { ownedBuildings, ownedSettlers } from '../ai-shared/seat-roster.js';
import { towerPostFor } from '../conflict/tower-post.js';
import type { System, SystemContext } from '../context.js';
import { childOrderBlocker } from '../family/children/index.js';
import { isMarried } from '../family/eligibility.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';
import { mayBearChild } from '../orders/family.js';
import { mayChangeTrade } from '../orders/guards.js';
import { mayDrillAt, mayWalkToDrill, startDrill } from '../orders/training.js';
import { hasUnclaimedSeat } from '../orders/training-seats.js';
import { baseSoldierJobType, isBarracks, isSoldierJob } from '../readviews/index.js';
import { anotherSystemOwns } from '../settlers/action-owner.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import type { INTENT_WEAPON_CLASS } from '../settlers/atomics/effects/goods/weapon-class.js';
import { BARRACKS_DRILL_TICKS } from '../settlers/drives/training.js';
import { armableIntents, armingGoodPreference } from '../settlers/planner/recruit-arming.js';
import { FetchableStock } from '../settlers/targets/index.js';
import { goodsSearchLimitAt } from '../signposts/reach.js';

/**
 * The assistant's production dispatcher: turns the assistant window's `AssistantCounters` into standing child
 * orders, barracks drills and bare soldiers booked for arming. Each dispatch books itself with a marker, and
 * a counter pays only when the product exists, so a recruit lost mid-pipeline re-dispatches instead of
 * silently draining the queue. Runs before the FamilySystem and the planner, so a fresh child order and a
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
  const carriers = world.canonicalQuery(AssistantCounters);
  if (carriers.length === 0) return; // idle worlds pay three empty queries per beat
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
        for (const woman of world.canonicalQuery(Female, Marriage, Residence)) {
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
 * tribe's weapons, a counter acts only while a barracks stands to gather the armed at, and (owner's ruling)
 * while a bare soldier waits, armed now or not, the counter drafts no man in his place. Authored rule:
 * "free" is a trade-less civilist with no workplace that no other drive owns, so nobody is pulled off a
 * job. Unmarried men drill first, since a soldier never marries, and intents take turns through a
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

  let budget = TRAIN_DISPATCHES_PER_DECISION;
  // Beat-rotated starting intent: fairness without stored state.
  let turn = Math.floor(ctx.tick / ASSISTANT_DECISION_PERIOD_TICKS) % wanted.length;
  const vetoed = playerGoodList(world, AssistantWeaponVetoes, player);
  const terrain = ctx.terrain;
  for (const e of scans.people(player)) {
    if (!isBareSoldier(world, ctx, e, player)) continue;
    const { tribe } = world.get(e, Settler);
    const classes = wantedInTurn(wanted, remaining, turn).filter(
      (intent): intent is ClassIntent =>
        intent !== 'trainSoldiers' && armingGoodPreference(ctx.content, tribe, intent, vetoed).length > 0,
    );
    const held = classes[0];
    if (held === undefined) continue;
    turn += 1;
    const free = budget > 0 && !world.has(e, EquipOrder) && !anotherSystemOwns(world, e);
    // The first class in turn whose weapon he can fetch now; failing every one, he holds the turn's.
    const taken =
      free && terrain !== undefined
        ? classes.find((intent) =>
            weaponInReach(world, ctx, terrain, e, player, intent, vetoed, unarmed.get(intent) ?? 0),
          )
        : undefined;
    const intent = taken ?? held;
    // Taken or not this beat, he holds a slot: no man is drafted while a bare soldier waits for it.
    remaining.set(intent, (remaining.get(intent) ?? 1) - 1);
    if (taken === undefined) continue;
    // The barracks the armed soldier gathers at, as a drafted recruit does at the one he drilled at.
    const house = houses.find((h) => mayWalkToDrill(world, ctx, e, h)) ?? houses[0];
    if (house === undefined) continue;
    world.add(e, AssistantRecruit, { intent: taken, armed: false, barracks: house });
    unarmed.set(taken, (unarmed.get(taken) ?? 0) + 1);
    budget -= 1;
  }

  const free = scans.people(player).filter((e) => isFreeMan(world, e, player));
  const candidates = [
    ...free.filter((e) => !isMarried(world, e)),
    ...free.filter((e) => isMarried(world, e)),
  ];
  for (const e of candidates) {
    if (budget <= 0) return;
    const intent = nextWantedIntent(wanted, remaining, turn);
    if (intent === null) return;
    // A barracks with a seat to spare first, so a full one does not queue men another could take now.
    const house =
      houses.find((h) => hasUnclaimedSeat(world, ctx, h) && mayDrillAt(world, ctx, e, h)) ??
      houses.find((h) => mayDrillAt(world, ctx, e, h));
    if (house === undefined) continue;
    // Every recruit serves the one standard drill; a class recruit leaves it wearing what gear the barracks
    // holds, and the arming pass fetches the rest.
    startDrill(world, ctx, e, house, BARRACKS_DRILL_TICKS);
    world.add(e, AssistantRecruit, { intent, armed: false, barracks: house });
    remaining.set(intent, (remaining.get(intent) ?? 1) - 1);
    turn += 1;
    budget -= 1;
  }
}

/** The next intent with headroom, round robin from `turn` over the beat's wanted list. */
function nextWantedIntent(
  wanted: readonly AssistantRecruitIntent[],
  remaining: ReadonlyMap<AssistantRecruitIntent, number>,
  turn: number,
): AssistantRecruitIntent | null {
  return wantedInTurn(wanted, remaining, turn)[0] ?? null;
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

/** The trade shapes the training dispatcher may draft. Shared with the AI's garrison sizing, so the target
 *  it publishes counts exactly the men this dispatcher would take. */
export function draftableTrade(jobType: number | null): boolean {
  return jobType === CIVILIST_JOB || jobType === null;
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

/**
 * Whether a weapon of `intent`'s class lies within `e`'s goods reach, and the side's stock of the class
 * holds a unit past the `booked` recruits already waiting for one, so a bare soldier is taken only for a
 * weapon he can fetch and stays in the field otherwise.
 */
function weaponInReach(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  player: number,
  intent: ClassIntent,
  vetoed: readonly number[],
  booked: number,
): boolean {
  const p = world.tryGet(e, Position);
  if (p === undefined) return false;
  const { tribe } = world.get(e, Settler);
  const stock = FetchableStock.of(world, ctx);
  let units = 0;
  for (const good of armingGoodPreference(ctx.content, tribe, intent, vetoed)) {
    units += stock.lendableUnits(player, good);
  }
  if (units <= booked) return false;
  const n = nodeOfPosition(p.x, p.y);
  const reach = goodsSearchLimitAt(world, ctx.content, terrain, player, n.hx, n.hy);
  return armableIntents(world, ctx, terrain, player, tribe, [intent], reach, vetoed).length > 0;
}

/**
 * Whether the assistant may take `e` for a drill: `player`'s adult, trade-less man that no other drive owns
 * and no errand occupies; `mayDrillAt` re-checks the rest per house. The civilist trade implies "adult
 * man", the `jobType: null` shape does not, so women and children are excluded explicitly.
 */
function isFreeMan(world: World, e: Entity, player: number): boolean {
  if (ownerOf(world, e) !== player) return false;
  if (!draftableTrade(world.get(e, Settler).jobType)) return false;
  if (world.has(e, Female) || world.has(e, Age)) return false;
  if (world.has(e, JobAssignment) || world.has(e, TrainingOrder) || world.has(e, AssistantRecruit))
    return false;
  if (world.has(e, EquipOrder) || atomicHoldsSettler(world, e)) return false;
  if (anotherSystemOwns(world, e)) return false;
  // A man already wearing a weapon good is no arming candidate: the slot this queue would fill is taken,
  // and the class transform only fires when a soldier takes one up.
  return (world.tryGet(e, Equipment)?.weapon ?? null) === null;
}
