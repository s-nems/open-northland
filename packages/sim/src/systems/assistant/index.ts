import {
  Age,
  AssistantChildOrder,
  AssistantCounters,
  type AssistantCounterValues,
  AssistantRecruit,
  type AssistantRecruitIntent,
  Building,
  ChildOrder,
  CurrentAtomic,
  Equipment,
  EquipOrder,
  Female,
  JobAssignment,
  Marriage,
  ownerOf,
  Residence,
  Settler,
  TrainingOrder,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { CIVILIST_JOB } from '../lifecycle/ageclass.js';
import { mayBearChild } from '../orders/family.js';
import { mayDrillAt, startDrill } from '../orders/training.js';
import { isAnimalTribe, isBarracks, isSoldierJob } from '../readviews/index.js';
import { BARRACKS_DRILL_TICKS } from '../settlers/drives/training.js';
import { anotherSystemOwns } from '../settlers/planner/replan.js';
import { canonicalById } from '../spatial/nodes.js';

/**
 * The assistant's production dispatcher - turns the chest window's counters (`AssistantCounters`)
 * into standing orders: child orders on eligible mothers (daughters outrank sons while `extraWomen`
 * remains) and barracks drills on free men (the four `train*` kinds). Each dispatch books itself with
 * an `AssistantChildOrder`/`AssistantRecruit` marker; a counter pays only when the product exists
 * (the birth, the enlistment, the landed weapon), so a recruit lost mid-pipeline re-dispatches
 * instead of silently draining the queue.
 *
 * Runs before the FamilySystem and the planner, so a fresh child order and a fresh drill both start
 * moving the same tick. The counters window is a project reconstruction (see
 * `app/hud/tool-panel/extras-menu.ts`); this pacing and the dispatch policies are ours (named
 * approximation), with each order passing exactly the player command's own gates
 * (`mayBearChild`/`mayDrillAt`).
 */

/** Decision beat: dispatching is a queue top-up, not a reflex, so one beat a second keeps the scan
 *  cost off the per-tick path. Our pacing (nothing decodable to match). */
export const ASSISTANT_DECISION_PERIOD_TICKS = TICKS_PER_SECOND;

/** Drill orders issued per player per beat - the trickle brake (the grants pass's rationale): an
 *  infinite counter empties the village into the barracks over minutes, not in one tick. Our balance. */
export const TRAIN_DISPATCHES_PER_DECISION = 2;

const TRAIN_INTENTS = ['trainSoldiers', 'trainSword', 'trainSpear', 'trainBow'] as const;

export const assistantSystem: System = (world, ctx) => {
  if (ctx.tick % ASSISTANT_DECISION_PERIOD_TICKS !== 0) return;
  // The sweep runs even with every counter back at default: bookings outlive the last carrier (a
  // reset with orders in flight), and a stale one would sit in hashed state until the next write.
  sweepStaleBookings(world, ctx);
  const carriers = canonicalById(world.query(AssistantCounters));
  if (carriers.length === 0) return; // idle worlds pay three empty queries per beat
  const seen = new Set<number>();
  for (const carrier of carriers) {
    const { player, counters } = world.get(carrier, AssistantCounters);
    if (seen.has(player)) continue; // lowest-id carrier wins (the rules-singleton convention)
    seen.add(player);
    dispatchBirths(world, player, counters);
    dispatchTraining(world, ctx, player, counters);
  }
};

/**
 * Drop bookings whose underlying order vanished (a widowed order dropped, a drill abandoned, a
 * recruit re-traded), so they stop holding an in-flight slot and the queue re-dispatches. A recruit
 * still drilling, or already enlisted into the soldier band, keeps its booking.
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
 * Top the standing child orders up to the two birth counters: every eligible mother without an order
 * gets one, daughters first while `extraWomen`'s remainder lasts (its stated priority), sons after
 * (`extraMen`, which may be infinite). In-flight assistant orders count against the remainder, so a
 * counter of N never books more than N wombs at once.
 */
function dispatchBirths(world: World, player: number, counters: AssistantCounterValues): void {
  let girlsWanted = counters.extraWomen.value;
  let boysWanted = counters.extraMen.infinite ? Number.POSITIVE_INFINITY : counters.extraMen.value;
  for (const e of world.query(AssistantChildOrder)) {
    if (ownerOf(world, e) !== player) continue;
    if (world.get(e, AssistantChildOrder).sex === 'female') girlsWanted -= 1;
    else boysWanted -= 1;
  }
  if (girlsWanted <= 0 && boysWanted <= 0) return;
  for (const woman of canonicalById(world.query(Female, Marriage, Residence))) {
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
 * Send free men to drill for the four `train*` counters. "Free" is the user's rule (2026-07-31):
 * a trade-less civilist with no workplace, not owned by another drive - nobody is pulled off a job.
 * Intents take turns via a beat-rotated round robin, so an infinite counter cannot starve a finite
 * one; {@link TRAIN_DISPATCHES_PER_DECISION} paces the outflow.
 */
function dispatchTraining(
  world: World,
  ctx: SystemContext,
  player: number,
  counters: AssistantCounterValues,
): void {
  const remaining = new Map<AssistantRecruitIntent, number>();
  for (const intent of TRAIN_INTENTS) {
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
  const wanted = TRAIN_INTENTS.filter((intent) => (remaining.get(intent) ?? 0) > 0);
  if (wanted.length === 0) return;
  const houses = ownedBarracks(world, ctx, player);
  if (houses.length === 0) return;

  let budget = TRAIN_DISPATCHES_PER_DECISION;
  // Beat-rotated starting intent: fairness without stored state (deterministic in the tick).
  let turn = Math.floor(ctx.tick / ASSISTANT_DECISION_PERIOD_TICKS) % wanted.length;
  for (const e of canonicalById(world.query(Settler))) {
    if (budget <= 0) return;
    const intent = nextWantedIntent(wanted, remaining, turn);
    if (intent === null) return;
    if (!isFreeMan(world, ctx, e, player)) continue;
    const house = houses.find((h) => mayDrillAt(world, ctx, e, h));
    if (house === undefined) continue;
    // Every recruit serves the one standard drill (user rule 2026-08-01: the barracks always trains
    // 15 s and releases an unarmed soldier; arming is its own later step). The arming pass then
    // hands out the strongest reachable weapon of the intent's class.
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
function ownedBarracks(world: World, ctx: SystemContext, player: number): Entity[] {
  return canonicalById(world.query(Building)).filter(
    (e) => ownerOf(world, e) === player && isBarracks(world, ctx, e),
  );
}

/**
 * Whether the assistant may take `e` for a drill: `player`'s adult, trade-less man - a civilist or an
 * unemployed (`jobType: null`) settler, e.g. an admin-spawned townsperson - that no other drive owns
 * and no errand or gesture occupies. The command-level gates (`mayDrillAt`) re-check the rest per
 * house. The civilist trade implies "adult man"; the null shape does not, so women, children and
 * (owned) animals are excluded explicitly.
 */
function isFreeMan(world: World, ctx: SystemContext, e: Entity, player: number): boolean {
  if (ownerOf(world, e) !== player) return false;
  const settler = world.get(e, Settler);
  if (settler.jobType !== CIVILIST_JOB && settler.jobType !== null) return false;
  if (world.has(e, Female) || world.has(e, Age)) return false;
  if (isAnimalTribe(ctx.content, settler.tribe)) return false;
  if (world.has(e, JobAssignment) || world.has(e, TrainingOrder) || world.has(e, AssistantRecruit))
    return false;
  if (world.has(e, EquipOrder) || world.has(e, CurrentAtomic)) return false;
  if (anotherSystemOwns(world, e)) return false;
  // A man already wearing a weapon good (a manual civilian equip) is no arming candidate: the slot
  // this queue would fill is taken, and the class transform only fires when a SOLDIER takes one up.
  return (world.tryGet(e, Equipment)?.weapon ?? null) === null;
}
