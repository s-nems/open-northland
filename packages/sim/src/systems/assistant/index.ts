import {
  Age,
  ASSISTANT_RECRUIT_INTENTS,
  AssistantChildOrder,
  AssistantCounters,
  type AssistantCounterValues,
  AssistantRecruit,
  type AssistantRecruitIntent,
  Building,
  ChildOrder,
  Equipment,
  EquipOrder,
  Female,
  JobAssignment,
  Marriage,
  ownerOf,
  Person,
  Residence,
  Settler,
  TrainingOrder,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { isMarried } from '../family/eligibility.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';
import { mayBearChild } from '../orders/family.js';
import { mayDrillAt, startDrill } from '../orders/training.js';
import { isBarracks, isSoldierJob } from '../readviews/index.js';
import { anotherSystemOwns } from '../settlers/action-owner.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { BARRACKS_DRILL_TICKS } from '../settlers/drives/training.js';
import { canonicalById } from '../spatial/nodes.js';

/**
 * The assistant's production dispatcher: turns the chest window's `AssistantCounters` into standing child
 * orders and barracks drills. Each dispatch books itself with a marker, and a counter pays only when the
 * product exists, so a recruit lost mid-pipeline re-dispatches instead of silently draining the queue. Runs
 * before the FamilySystem and the planner, so a fresh child order and a fresh drill both start moving the
 * same tick. Approximation: the counters window is a project reconstruction, and the pacing and dispatch
 * policies are authored, with each order passing the player command's own gates.
 */

/** Decision beat: dispatching is a queue top-up, not a reflex, so one beat a second keeps the scan cost off
 *  the per-tick path. Approximation: nothing decodable to match. */
export const ASSISTANT_DECISION_PERIOD_TICKS = TICKS_PER_SECOND;

/** Drill orders issued per player per beat, the trickle brake: an infinite counter empties the village into
 *  the barracks over minutes, not in one tick. Authored balance. */
export const TRAIN_DISPATCHES_PER_DECISION = 2;

export const assistantSystem: System = (world, ctx) => {
  if (ctx.tick % ASSISTANT_DECISION_PERIOD_TICKS !== 0) return;
  // The sweep runs even with every counter back at default: bookings outlive the last carrier (a
  // reset with orders in flight), and a stale one would sit in hashed state until the next write.
  sweepStaleBookings(world, ctx);
  const carriers = canonicalById(world.query(AssistantCounters));
  if (carriers.length === 0) return; // idle worlds pay three empty queries per beat
  const scans = beatScans(world);
  const seen = new Set<number>();
  for (const carrier of carriers) {
    const { player, counters } = world.get(carrier, AssistantCounters);
    if (seen.has(player)) continue; // lowest-id carrier wins (the rules-singleton convention)
    seen.add(player);
    dispatchBirths(world, player, counters, scans);
    dispatchTraining(world, ctx, player, counters, scans);
  }
};

/** The beat's canonical scans, built lazily and shared across the carriers. Sharing is safe: dispatching
 *  adds orders and bookings, never people or buildings, so the first seat's snapshot still holds for the
 *  last. */
interface BeatScans {
  readonly mothers: () => readonly Entity[];
  readonly people: () => readonly Entity[];
  readonly buildings: () => readonly Entity[];
}

function beatScans(world: World): BeatScans {
  let mothers: Entity[] | null = null;
  let people: Entity[] | null = null;
  let buildings: Entity[] | null = null;
  return {
    mothers: () => (mothers ??= canonicalById(world.query(Female, Marriage, Residence))),
    people: () => (people ??= canonicalById(world.query(Person))),
    buildings: () => (buildings ??= canonicalById(world.query(Building))),
  };
}

/**
 * Drop bookings whose underlying order vanished, so they stop holding an in-flight slot and the queue
 * re-dispatches. A recruit still drilling, or already enlisted as a soldier, keeps its booking.
 */
function sweepStaleBookings(world: World, ctx: SystemContext): void {
  // Copies, not sorts: removal here is order-independent; the copy only guards the live iteration.
  for (const e of [...world.query(AssistantChildOrder)]) {
    if (!world.has(e, ChildOrder)) world.remove(e, AssistantChildOrder);
  }
  for (const e of [...world.query(AssistantRecruit)]) {
    if (world.has(e, TrainingOrder)) continue;
    if (!isSoldierJob(ctx.content, world.get(e, Settler).jobType)) world.remove(e, AssistantRecruit);
  }
}

/**
 * Top the standing child orders up to the two birth counters: every eligible mother without an order gets
 * one, daughters first while `extraWomen`'s remainder lasts, then sons. In-flight assistant orders count
 * against the remainder, so a counter of N never books more than N wombs at once.
 */
function dispatchBirths(
  world: World,
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
  for (const woman of scans.mothers()) {
    if (girlsWanted <= 0 && boysWanted <= 0) return;
    if (ownerOf(world, woman) !== player) continue;
    if (world.has(woman, ChildOrder)) continue; // her own or an earlier booking - one at a time
    if (!mayBearChild(world, woman)) continue;
    const sex = girlsWanted > 0 ? 'female' : 'male';
    world.add(woman, ChildOrder, { child: sex });
    world.add(woman, AssistantChildOrder, { sex });
    if (sex === 'female') girlsWanted -= 1;
    else boysWanted -= 1;
  }
}

/**
 * Send free men to drill for the four `train*` counters. Authored rule: "free" is a trade-less civilist
 * with no workplace that no other drive owns, so nobody is pulled off a job. Unmarried men drill first,
 * since a soldier never marries, and intents take turns through a beat-rotated round robin, so an infinite
 * counter cannot starve a finite one.
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
  for (const e of world.query(AssistantRecruit)) {
    if (ownerOf(world, e) !== player) continue;
    const booking = world.get(e, AssistantRecruit);
    if (booking.armed) continue; // its counter is already paid; only the armor leg remains
    const left = remaining.get(booking.intent);
    if (left !== undefined) remaining.set(booking.intent, left - 1);
  }
  const wanted = ASSISTANT_RECRUIT_INTENTS.filter((intent) => (remaining.get(intent) ?? 0) > 0);
  if (wanted.length === 0) return;
  const houses = ownedBarracks(world, ctx, player, scans);
  if (houses.length === 0) return;

  const free = scans.people().filter((e) => isFreeMan(world, e, player));
  const candidates = [
    ...free.filter((e) => !isMarried(world, e)),
    ...free.filter((e) => isMarried(world, e)),
  ];
  let budget = TRAIN_DISPATCHES_PER_DECISION;
  // Beat-rotated starting intent: fairness without stored state.
  let turn = Math.floor(ctx.tick / ASSISTANT_DECISION_PERIOD_TICKS) % wanted.length;
  for (const e of candidates) {
    if (budget <= 0) return;
    const intent = nextWantedIntent(wanted, remaining, turn);
    if (intent === null) return;
    const house = houses.find((h) => mayDrillAt(world, ctx, e, h));
    if (house === undefined) continue;
    // Every recruit serves the one standard drill and exits unarmed; the arming pass dresses the class
    // recruits later.
    startDrill(world, e, house, BARRACKS_DRILL_TICKS);
    world.add(e, AssistantRecruit, { intent, armed: false });
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
  for (let i = 0; i < wanted.length; i++) {
    const intent = wanted[(turn + i) % wanted.length];
    if (intent !== undefined && (remaining.get(intent) ?? 0) > 0) return intent;
  }
  return null;
}

/** `player`'s standing barracks, ascending entity id (the deterministic house preference). */
function ownedBarracks(world: World, ctx: SystemContext, player: number, scans: BeatScans): Entity[] {
  return scans.buildings().filter((e) => ownerOf(world, e) === player && isBarracks(world, ctx, e));
}

/** The trade shapes the training dispatcher may draft. Shared with the AI's garrison sizing, so the target
 *  it publishes counts exactly the men this dispatcher would take. */
export function draftableTrade(jobType: number | null): boolean {
  return jobType === CIVILIST_JOB || jobType === null;
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
