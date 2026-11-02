import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import {
  Building,
  Carrying,
  type ColonyStall,
  ComputerColony,
  playerPlacementTribes,
  Settler,
  StalledPlacements,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly, Entity } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { homeBuildings } from '../../ai-shared/home-roster.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import { isAllocatableMan, SpareForce } from '../../ai-shared/workforce/pool.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';
import { isCarrierJob } from '../../stores/index.js';
import {
  type BuildLineId,
  type BuildOrderEntry,
  DEFAULT_BUILD_ORDER,
  stepKey,
} from '../build-order/entries.js';
import { seatBuildOrder, seatHasSide } from '../build-order/seat-order.js';
import { computerProfileOf } from '../difficulty.js';
import { minutesToTicks } from '../game-phase.js';
import { Schooling } from '../technology/schooling.js';
import { fullCrew } from '../workforce/staffing-rows.js';
import { colonyOrigin } from './founding.js';
import { homeSpare, homeSupply } from './line.js';
import { homeMaySpare, sparePartyMen } from './people.js';
import { atWorkshop } from './posts.js';
import { landHolds } from './provision.js';
import { colonyBuildings, workshopSpot } from './spot.js';
import type { ColonyEnv, ColonyView } from './voyage.js';

/**
 * The workshops home may hand over: the chains that turn raw goods into what its army and sites want. Owner
 * ruling: a colony is a resource outpost, but when the home island lacks room it may grow production. Food
 * stays home; a tower, barracks, school, grass or shore building serves the ground it stands on.
 */
const OVERFLOW_BUILDING_IDS: ReadonlySet<string> = new Set([
  'work_smithy_00',
  'work_smithy_01',
  'work_armory_00',
  'work_armory_01',
  'work_mason_hut_00',
  'work_mason_hut_01',
  'work_pottery_00',
  'work_pottery_01',
  'work_pottery_02',
  'work_sewery_00',
  'work_sewery_01',
]);

/** How long a step stands held for ground before home gives it up (authored: the clearing posts' and the
 *  ground plan's fair chance). The clock starts at the first sight of the hold with a colony planned, not
 *  at its landing, so a colony that lands late takes the step in its first running minute. */
const HELD_FOR_GROUND_TICKS = minutesToTicks(10);

/** Whether `building` is one a colony raises for home. */
export function isOverflowBuilding(building: string): boolean {
  return OVERFLOW_BUILDING_IDS.has(building);
}

function workshopType(env: ColonyEnv, e: Entity): BuildingType | undefined {
  const type = contentIndex(env.ctx.content).buildings.get(env.world.get(e, Building).buildingType);
  return type?.kind === BUILDING_KIND.workplace ? type : undefined;
}

function stepOf(env: ColonyEnv, stall: DeepReadonly<ColonyStall>): BuildOrderEntry | undefined {
  const { world, ctx, seat } = env;
  const order = seatBuildOrder(world, ctx, seat, DEFAULT_BUILD_ORDER, computerProfileOf(world, seat));
  return order.lines.find((line) => line.id === stall.line)?.steps[stall.step];
}

/** Whether every input of one of `type`'s recipes has a source: a deposit in the colony's reach or home's
 *  surplus. */
function inputsSourced(env: ColonyEnv, origin: HalfCellNode, type: BuildingType): boolean {
  const spare = homeSpare(env, homeSupply(env));
  const sourced = (good: number): boolean => spare(good) > 0 || landHolds(env, origin, good);
  return type.recipes.length === 0 || type.recipes.some((r) => r.inputs.every((i) => sourced(i.goodType)));
}

/** The building `entry` hands over, or undefined while it stays home's or the colony cannot take it. */
function handedType(
  env: ColonyEnv,
  colony: ColonyView,
  entry: BuildOrderEntry | undefined,
): BuildingType | undefined {
  if (entry?.kind !== 'place' || entry.role !== undefined || entry.ground !== undefined) return undefined;
  if (!OVERFLOW_BUILDING_IDS.has(entry.building)) return undefined;
  const index = contentIndex(env.ctx.content);
  const typeId = index.buildingTypeBySlug.get(entry.building);
  const type = typeId === undefined ? undefined : index.buildings.get(typeId);
  const origin = colonyOrigin(env, colony, colonyBuildings(env));
  const tribe = playerPlacementTribes(env.world, env.seat)?.[0];
  if (type === undefined || origin === null || tribe === undefined) return undefined;
  if (!inputsSourced(env, origin, type)) return undefined;
  return workshopSpot(env, colony.land, type, tribe, origin) === null ? undefined : type;
}

/** Hand the longest-held step that qualifies to the colony, one at a time so its bills do not outrun its
 *  line, ahead of the homes still to raise. Owner ruling: no home goes with it; homes serve population growth
 *  and the crew sails on the line. */
function handOver(env: ColonyEnv, colony: ColonyView): void {
  const { ctx } = env;
  if (colony.builds.some((b) => !b.placed && OVERFLOW_BUILDING_IDS.has(b.building))) return;
  for (const stall of colony.stalls) {
    if (ctx.tick - stall.since < HELD_FOR_GROUND_TICKS) continue;
    const type = handedType(env, colony, stepOf(env, stall));
    if (type === undefined) continue;
    const live = env.edit();
    live.overflow.push({ line: stall.line, step: stall.step, building: type.id });
    const next = live.builds.findIndex((b) => !b.placed);
    live.builds.splice(next < 0 ? live.builds.length : next, 0, { building: type.id, placed: false });
    live.stalls = live.stalls.filter((s) => s.line !== stall.line || s.step !== stall.step);
    return;
  }
}

/** Keep the record of the steps holding their lines for ground: a step that moved goes, a new one starts its
 *  clock. Only a change writes. */
function noteStalls(env: ColonyEnv, colony: ColonyView): void {
  const { world, ctx, carrier } = env;
  const holding = world.tryGet(carrier, StalledPlacements)?.holding;
  const stands = (s: { readonly line: BuildLineId; readonly step: number }): boolean =>
    holding?.get(s.line) === stepKey(s.line, s.step);
  const fresh = [...(holding ?? [])]
    .map(([line, key]) => ({ line, step: Number(key.slice(line.length + 1)) }))
    .filter((held) => !colony.stalls.some((s) => s.line === held.line && s.step === held.step));
  if (fresh.length === 0 && colony.stalls.every(stands)) return;
  const live = env.edit();
  live.stalls = live.stalls.filter(stands);
  for (const held of fresh) live.stalls.push({ ...held, since: ctx.tick });
}

/** Take back what no building stands for: a refused placement or a razed workshop goes off the builds and
 *  the hand-overs, so home's step stands open again. */
function dropLost(env: ColonyEnv, colony: ColonyView): void {
  if (colony.overflow.length === 0) return;
  const index = contentIndex(env.ctx.content);
  const standing = new Map<string, number>();
  for (const e of colonyBuildings(env)) {
    const id = index.buildings.get(env.world.get(e, Building).buildingType)?.id;
    if (id !== undefined) standing.set(id, (standing.get(id) ?? 0) + 1);
  }
  const lost: string[] = [];
  for (const { building } of colony.overflow) {
    if (colony.builds.some((b) => !b.placed && b.building === building)) continue;
    const left = standing.get(building) ?? 0;
    if (left > 0) standing.set(building, left - 1);
    else lost.push(building);
  }
  if (lost.length === 0) return;
  const live = env.edit();
  for (const building of lost) {
    live.overflow.splice(
      live.overflow.findIndex((o) => o.building === building),
      1,
    );
    const row = live.builds.findIndex((b) => b.placed && b.building === building);
    if (row >= 0) live.builds.splice(row, 1);
  }
}

/** The minute's review on a seat with no room at home: read the holds, and with the colony running hand one
 *  over. Home owns what, the colony owns where: only a row in its builds, no line or priority of its own. */
export function reviewOverflow(env: ColonyEnv, colony: ColonyView): void {
  const { world, seat, carrier } = env;
  if (!seatHasSide(world, seat, 'noRoom')) return;
  dropLost(env, colony);
  noteStalls(env, world.get(carrier, ComputerColony));
  const settled = world.get(carrier, ComputerColony);
  if (settled.phase === 'running') handOver(env, settled);
}

interface CraftSeat {
  readonly building: Entity;
  readonly job: number;
}

/** The craftsmen's seats the colony's standing workshops lack; a carrier any man can be, a gatherer's seat
 *  stays open. */
function openCraftSeats(env: ColonyEnv, buildings: readonly Entity[]): CraftSeat[] {
  const { world, ctx, seat } = env;
  const index = contentIndex(ctx.content);
  const seats: CraftSeat[] = [];
  for (const building of buildings) {
    const type = workshopType(env, building);
    if (type === undefined || !isBuilt(world, building)) continue;
    const staff = assignedWorkers(world, building);
    for (const { jobType: job, count } of type.workers) {
      if (isCarrierJob(ctx, job) || index.harvestJobs.has(job)) continue;
      const held = staff.filter((e) => world.get(e, Settler).jobType === job).length;
      const want = Math.min(count, fullCrew(world, ctx, seat, type));
      for (let i = held; i < want; i++) seats.push({ building, job });
    }
  }
  return seats;
}

/** A man free to take `job`: no load to drop, and the trade earned. */
function fitsTrade(env: ColonyEnv, job: number): (e: Entity) => boolean {
  const { world, ctx } = env;
  return (e) => !world.has(e, Carrying) && settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', job);
}

/** Who a line's home stop owes the colony: the spare men of the trades no colonist among `people` has earned,
 *  in at most `seats`, and the lessons that make the next such man where home's school teaches the trade.
 *  A workshop none of them reaches simply waits: home's line has moved on. */
export function tradesmenFor(
  env: ColonyEnv,
  people: readonly Entity[],
  home: number,
  seats: number,
): { readonly sailing: readonly Entity[]; readonly lessons: readonly PlayerCommand[] } {
  const { world, ctx, seat } = env;
  const here = new SpareForce(people.filter((e) => isAllocatableMan(world, ctx, e) && !atWorkshop(env, e)));
  const short = openCraftSeats(env, colonyBuildings(env)).filter(
    (post) => here.take(fitsTrade(env, post.job)) === null,
  );
  const sailing: Entity[] = [];
  const lessons: PlayerCommand[] = [];
  if (short.length === 0 || !homeMaySpare(world, ctx, seat)) return { sailing, lessons };
  const force = new SpareForce(sparePartyMen(world, ctx, seat, home));
  const schooling = new Schooling(world, ctx, seat, homeBuildings(world, ctx, seat));
  for (const post of short) {
    const man = sailing.length < seats ? force.take(fitsTrade(env, post.job)) : null;
    if (man !== null) {
      sailing.push(man);
      continue;
    }
    const lesson = schooling.enrol(post.job, post.building, force);
    if (lesson.kind === 'learn') lessons.push(lesson.command);
  }
  return { sailing, lessons };
}
