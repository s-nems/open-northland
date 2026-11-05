import type { BuildingType } from '@open-northland/data';
import {
  Building,
  type ColonyStall,
  playerPlacementTribes,
  StalledPlacements,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { DeepReadonly } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import { seatColonies } from '../../ai-shared/home-roster.js';
import {
  type BuildLineId,
  type BuildOrderEntry,
  DEFAULT_BUILD_ORDER,
  stepKey,
} from '../build-order/entries.js';
import { seatBuildOrder, seatHasSide } from '../build-order/seat-order.js';
import { computerProfileOf } from '../difficulty.js';
import { minutesToTicks } from '../game-phase.js';
import type { ColonyEnv, ColonyView } from './env.js';
import { homeSpare, homeSupply } from './home-supply.js';
import { landHolds } from './land.js';
import { colonyBuildings, colonyOrigin } from './roster.js';
import { workshopSpot } from './spot.js';

/**
 * The workshops home may hand over: the chains that turn raw goods into what its army wants. Owner ruling: a
 * colony is a resource outpost, but when the home island lacks room it may grow production. Food stays home;
 * so do the pottery and the mason hut, whose goods home sends; a tower, barracks, school, grass or shore
 * building serves the ground it stands on.
 */
const OVERFLOW_BUILDING_IDS: ReadonlySet<string> = new Set([
  'work_smithy_00',
  'work_smithy_01',
  'work_armory_00',
  'work_armory_01',
  'work_sewery_00',
  'work_sewery_01',
]);

/** How long a step stands held for ground before home gives it up (authored: the clearing posts' and the
 *  ground plan's fair chance). The clock starts at the first sight of the hold with a colony planned, not
 *  at its landing, so a colony that lands late takes the step in its first running minute. */
const HELD_FOR_GROUND_TICKS = minutesToTicks(10);

const NO_TIERS: ReadonlySet<number> = new Set();

/** Whether `building` is one a colony raises for home. */
export function isOverflowBuilding(building: string): boolean {
  return OVERFLOW_BUILDING_IDS.has(building);
}

function stepOf(env: ColonyEnv, stall: DeepReadonly<ColonyStall>): BuildOrderEntry | undefined {
  const { world, ctx, seat } = env;
  const order = seatBuildOrder(world, ctx, seat, DEFAULT_BUILD_ORDER, computerProfileOf(world, seat));
  return order.lines.find((line) => line.id === stall.line)?.steps[stall.step];
}

/** What home can spare of a good, read once per review however many stalls ask. */
type HomeSpareRead = () => (good: number) => number;

/** Whether every input of one of `type`'s recipes has a source: a deposit in the colony's reach or home's
 *  surplus. */
function inputsSourced(
  env: ColonyEnv,
  origin: HalfCellNode,
  type: BuildingType,
  homeSpareNow: HomeSpareRead,
): boolean {
  const spare = homeSpareNow();
  const sourced = (good: number): boolean => spare(good) > 0 || landHolds(env, origin, good);
  return type.recipes.length === 0 || type.recipes.some((r) => r.inputs.every((i) => sourced(i.goodType)));
}

/** The building `entry` hands over, or undefined while it stays home's or the colony cannot take it. */
function handedType(
  env: ColonyEnv,
  colony: ColonyView,
  entry: BuildOrderEntry | undefined,
  homeSpareNow: HomeSpareRead,
): BuildingType | undefined {
  if (entry?.kind !== 'place' || entry.role !== undefined || entry.ground !== undefined) return undefined;
  if (!OVERFLOW_BUILDING_IDS.has(entry.building)) return undefined;
  const index = contentIndex(env.ctx.content);
  const typeId = index.buildingTypeBySlug.get(entry.building);
  const type = typeId === undefined ? undefined : index.buildings.get(typeId);
  const origin = colonyOrigin(env, colony, colonyBuildings(env));
  const tribe = playerPlacementTribes(env.world, env.seat)?.[0];
  if (type === undefined || origin === null || tribe === undefined) return undefined;
  if (!inputsSourced(env, origin, type, homeSpareNow)) return undefined;
  return workshopSpot(env, colony.land, type, tribe, origin) === null ? undefined : type;
}

/** Whether another of the seat's colonies already took `stall`, this same review: its row moves home on only
 *  at the next decision. */
function takenBySibling(env: ColonyEnv, stall: DeepReadonly<ColonyStall>): boolean {
  return seatColonies(env.world, env.seat).some(
    (other) =>
      other !== env.colony && other.overflow.some((o) => o.line === stall.line && o.step === stall.step),
  );
}

/** Hand the longest-held step that qualifies to the colony, one at a time so its bills do not outrun its
 *  trader, ahead of the homes still to raise. Owner ruling: no home goes with it; homes serve population
 *  growth. */
function handOver(env: ColonyEnv, colony: ColonyView): void {
  const { ctx } = env;
  if (colony.builds.some((b) => !b.placed && OVERFLOW_BUILDING_IDS.has(b.building))) return;
  let spare: ((good: number) => number) | undefined;
  const homeSpareNow: HomeSpareRead = () => (spare ??= homeSpare(env, homeSupply(env)));
  for (const stall of colony.stalls) {
    if (ctx.tick - stall.since < HELD_FOR_GROUND_TICKS || takenBySibling(env, stall)) continue;
    const type = handedType(env, colony, stepOf(env, stall), homeSpareNow);
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
 *  the hand-overs, so home's step stands open again. A workshop the colony lifted a tier still stands for
 *  it, as home's own steps count their upgraded buildings. */
function dropLost(env: ColonyEnv, colony: ColonyView): void {
  if (colony.overflow.length === 0) return;
  const index = contentIndex(env.ctx.content);
  const chainOf = (typeId: number | undefined): ReadonlySet<number> => {
    const type = typeId === undefined ? undefined : index.buildings.get(typeId);
    return type === undefined ? NO_TIERS : tiersAtOrAbove(index, type);
  };
  const standing = colonyBuildings(env).map((e) => env.world.get(e, Building).buildingType);
  // The highest tier handed over picks first, each the lowest building standing on its chain, so a lower
  // hand-over is not left without the building a higher one needed.
  const handed = colony.overflow
    .map(({ building }) => ({ building, tiers: chainOf(index.buildingTypeBySlug.get(building)) }))
    .sort((a, b) => a.tiers.size - b.tiers.size);
  const lost: string[] = [];
  for (const { building, tiers } of handed) {
    if (colony.builds.some((b) => !b.placed && b.building === building)) continue;
    // The lowest tier spans the most of its chain; ties go to the first standing.
    let pick = -1;
    let span = 0;
    standing.forEach((type, i) => {
      const above = chainOf(type).size;
      if (tiers.has(type) && above > span) {
        pick = i;
        span = above;
      }
    });
    if (pick >= 0) standing.splice(pick, 1);
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
  if (!seatHasSide(env.world, env.seat, 'noRoom')) return;
  dropLost(env, colony);
  noteStalls(env, colony);
  if (colony.phase === 'running') handOver(env, colony);
}
