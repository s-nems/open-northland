import { type BuildingType, type FootprintCell, footprintCellDx } from '@open-northland/data';
import {
  aiControlEntity,
  Building,
  type BuildLineId,
  GroundPlan,
  type GroundPlot,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { COMPUTER_DECISION_INTERVAL_TICKS } from '../../ai-shared/cadence.js';
import { buildingTypeByContentId, countedTiers } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import type { SystemContext } from '../../context.js';
import { ANCHOR_ONLY, buildingFootprintOf } from '../../footprint/geometry.js';
import { placementBlockerGrid } from '../../footprint/placement/blocker-grid.js';
import { placementProbe } from '../../footprint/placement/building.js';
import { minutesToTicks } from '../game-phase.js';
import { clearingPatch } from '../workforce/collectors/clearing-aim.js';
import {
  type BuildOrder,
  type BuildOrderEntry,
  overflowBuildReachNodes,
  STALLED_PLACEMENT_RETRY_DECISIONS,
} from './entries.js';
import { baseComponent, buildReach, placementPassesOver, placementSpot } from './placement.js';
import { plottedNodes, seatSpotAcceptor } from './plots.js';
import { type LineStatuses, upgradesInto } from './progress.js';
import { FIT_PER_HOME, freeHomeZones, ROOM_HOME_BUILDING } from './room.js';
import { NO_ROOM_HOMES, seatHasSide, seatTuning } from './seat-order.js';
import { baseWalkTest } from './spot-walk.js';

/** Owner ruling: on very little room a seat's homes go as low as this, and the more room the more homes. */
export const PLANNED_HOMES_FLOOR = 2;

/** How far a fit is counted: past what {@link NO_ROOM_HOMES} homes ask, more room changes nothing. */
const FIT_COUNTED = FIT_PER_HOME * NO_ROOM_HOMES;

/** The homes a seat keeps on `fit` home zones of room, {@link FIT_PER_HOME} each, from
 *  {@link PLANNED_HOMES_FLOOR} to {@link NO_ROOM_HOMES}: at the start of arabskie_wyspy_wolna_gra_mieszana the
 *  five seats fit 13, 2, 2, 13 and 6, which gives them 6, 2, 2, 6 and 3 homes. */
export function plannedHomes(fit: number): number {
  return Math.min(NO_ROOM_HOMES, Math.max(PLANNED_HOMES_FLOOR, Math.floor(fit / FIT_PER_HOME)));
}

/** When a seat draws its plan (authored): past the opening's first homes and school, which keep the ground
 *  by the base. Observed on arabskie_wyspy_wolna_gra_mieszana: drawn at the start, the plots sent the school
 *  twice as far out, it finished much later and the housing lane behind it held back the homes, while the
 *  big patches lasted well into the game unplotted. */
export const GROUND_PLAN_FROM_TICKS = minutesToTicks(10);

/** How often a plan looks for ground again for what it lacks, a stalled search's own pace. */
const PLAN_REVIEW_TICKS = STALLED_PLACEMENT_RETRY_DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS;

/** Owner ruling: what a plan never cuts, plotted ahead of every bigger building: on one island seat a
 *  bakery's plot took the last patch the barracks could be cleared on. */
const NEVER_CUT: readonly string[] = ['barracks', 'work_armory_00'];

/** A node's neighbours on its row and column. */
const RIM_STEPS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** A row's weight in a cell's key, wider than any footprint. */
const RIM_KEY_ROW = 1024;

type PlaceEntry = Extract<BuildOrderEntry, { kind: 'place' }>;

/** What a plot search reads of the decision. */
interface PlotDecision {
  readonly underFire: () => EnemyFire;
  readonly reserveGrass: boolean;
}

interface Seat {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly player: number;
  readonly owned: readonly Entity[];
  readonly anchor: HalfCellNode;
  readonly tribe: number;
  readonly decision: PlotDecision;
}

/**
 * Owner ruling: a seat that scans very little room keeps ground for what it cannot do without, so homes
 * and copies never block its expansion. From {@link GROUND_PLAN_FROM_TICKS} a seat with the `noRoom` side
 * plots the zone of each step that would hold its line and that no gap of a home's size takes, biggest
 * first, packed by {@link packedSpot}, and cuts its homes by the room left ({@link plannedHomes}). Plotting
 * every line-holding step left two homes on three of five arabskie_wyspy seats and halved their people. A
 * plotted building may stand anywhere off the others' plots, its plot being the room it can always fall
 * back on. Each placement decision after that drops a plot once its step stands met and moves one something
 * else came to block; a plot with no ground left goes, and its step stalls as any other.
 */
export function keepGroundPlan(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  order: BuildOrder,
  statuses: LineStatuses,
  decision: PlotDecision,
): void {
  const carrier = aiControlEntity(world, player);
  if (carrier === null || !seatHasSide(world, player, 'noRoom')) return;
  const seat: Seat = { world, ctx, terrain, player, owned, anchor, tribe, decision };
  if (!world.has(carrier, GroundPlan)) measureGround(seat, carrier, order, statuses);
  if (ctx.tick < GROUND_PLAN_FROM_TICKS) return;
  if (world.get(carrier, GroundPlan).drawn) reviewPlots(seat, carrier, order, statuses);
  else drawGroundPlan(seat, carrier, order, statuses);
}

function plotSteps(seat: Seat, carrier: Entity, order: BuildOrder, statuses: LineStatuses): void {
  for (const step of essentialSteps(seat, order, statuses)) {
    const plot = plotOf(seat, step);
    if (plot !== null) seat.world.mut(carrier, GroundPlan).plots.push(plot);
  }
}

/** The seat's first decision sizes its homes on the plots it would draw, or the opening's homes would be
 *  past the cut before any plot stands; the plots themselves wait for {@link GROUND_PLAN_FROM_TICKS}. */
function measureGround(seat: Seat, carrier: Entity, order: BuildOrder, statuses: LineStatuses): void {
  const { world } = seat;
  world.add(carrier, GroundPlan, {
    plots: [],
    homes: NO_ROOM_HOMES,
    reviewTick: GROUND_PLAN_FROM_TICKS,
    drawn: false,
  });
  plotSteps(seat, carrier, order, statuses);
  const homes = plannedHomes(homeFit(seat));
  const plan = world.mut(carrier, GroundPlan);
  plan.plots = [];
  plan.homes = homes;
}

function drawGroundPlan(seat: Seat, carrier: Entity, order: BuildOrder, statuses: LineStatuses): void {
  const { world, ctx } = seat;
  const start = world.mut(carrier, GroundPlan);
  start.drawn = true;
  start.reviewTick = ctx.tick + PLAN_REVIEW_TICKS;
  plotSteps(seat, carrier, order, statuses);
  const homes = Math.max(world.get(carrier, GroundPlan).homes, plannedHomes(homeFit(seat)));
  if (homes !== world.get(carrier, GroundPlan).homes) world.mut(carrier, GroundPlan).homes = homes;
}

function zoneOf(seat: Seat, typeId: number): readonly FootprintCell[] {
  return buildingFootprintOf(seat.ctx.content, typeId, seat.tribe)?.reserved ?? ANCHOR_ONLY;
}

/** A step of a line: the one a plot waits on. */
interface PlottedStep {
  readonly entry: PlaceEntry;
  readonly line: BuildLineId;
  readonly step: number;
}

/** The unmet single-copy placements of `order` that would hold their line, with a zone over a home's,
 *  {@link NEVER_CUT} first, then biggest, then by content id, one per building: a role joinery's top tier, which an upgrade of a
 *  lower joinery meets, and a step only serving something beside it stay out, the shore's own joinery in. */
function essentialSteps(seat: Seat, order: BuildOrder, statuses: LineStatuses): readonly PlottedStep[] {
  const { world, ctx, owned } = seat;
  const index = contentIndex(ctx.content);
  const lifted = (target: BuildingType): boolean =>
    owned.some((e) => {
      const held = index.buildings.get(world.get(e, Building).buildingType);
      return held !== undefined && upgradesInto(index, held, target);
    });
  const home = buildingTypeByContentId(ctx.content, ROOM_HOME_BUILDING);
  const homeZone = home === undefined ? 0 : zoneOf(seat, home.typeId).length;
  const chosen = new Map<string, PlottedStep & { readonly zone: number }>();
  for (const line of order.lines) {
    for (const [step, entry] of line.steps.entries()) {
      if (entry.kind !== 'place' || entry.count !== 1 || chosen.has(entry.building)) continue;
      if (statuses.get(line.id)?.[step] !== 'unmet') continue;
      if (entry.role === undefined && placementPassesOver(ctx, entry)) continue;
      const type = buildingTypeByContentId(ctx.content, entry.building);
      if (type === undefined || lifted(type)) continue;
      const zone = zoneOf(seat, type.typeId).length;
      if (entry.role === undefined && zone <= homeZone) continue;
      chosen.set(entry.building, { entry, line: line.id, step, zone });
    }
  }
  const rank = (step: PlottedStep): number => (NEVER_CUT.includes(step.entry.building) ? 0 : 1);
  return [...chosen.values()].sort(
    (a, b) => rank(a) - rank(b) || b.zone - a.zone || (a.entry.building < b.entry.building ? -1 : 1),
  );
}

/** Where `plotted`'s step would land now, off the plots already drawn, or else the cheapest ground it
 *  could clear; null when the seat holds neither. A shore step has no ground but the shore's. */
function plotOf(seat: Seat, plotted: PlottedStep): GroundPlot | null {
  const { world, ctx, terrain, player, owned, anchor, tribe, decision } = seat;
  const { entry, line, step } = plotted;
  const type = buildingTypeByContentId(ctx.content, entry.building);
  if (type === undefined) return null;
  const placed = entry.ground !== undefined || entry.role !== undefined;
  const spot = placed
    ? placementSpot(
        world,
        ctx,
        terrain,
        player,
        owned,
        anchor,
        type,
        tribe,
        entry,
        decision.underFire(),
        decision.reserveGrass,
      )
    : packedSpot(seat, type);
  const plot = { building: entry.building, line, step };
  if (spot !== null) return { ...plot, ...spot, clearing: false };
  if (entry.near?.some((a) => a.kind === 'shore') === true) return null;
  const patch = clearingPatch(world, ctx, terrain, player, type.typeId, tribe, anchor);
  return patch === null ? null : { ...plot, hx: patch.x, hy: patch.y, clearing: patch.cost > 0 };
}

/**
 * The legal spot on the seat's land, within the wider reach of what it owns, whose zone leaves the least
 * free ground along its edge, the nearest to the base on a tie: a plot packed against the shore or a wall
 * cuts the land in fewer pieces than one out in the open, and the search its step runs still takes any
 * nearer ground off the other plots.
 */
function packedSpot(seat: Seat, type: BuildingType): HalfCellNode | null {
  // The grass stays for the grass buildings where a plot need not take it.
  if (seat.decision.reserveGrass) {
    const offGrass = packedOn(seat, type, true);
    if (offGrass !== null) return offGrass;
  }
  return packedOn(seat, type, false);
}

function packedOn(seat: Seat, type: BuildingType, spareGrass: boolean): HalfCellNode | null {
  const { world, ctx, terrain, player, owned, anchor, tribe, decision } = seat;
  const fan = overflowBuildReachNodes(seatTuning(world, player).reachNodes);
  const reach = buildReach(world, owned, anchor, fan);
  const land = baseComponent(world, ctx, terrain, player);
  const accept = seatSpotAcceptor(world, ctx, terrain, player, type.typeId, tribe).around(
    decision.underFire(),
    anchor,
    fan,
    spareGrass,
  );
  const walkable = baseWalkTest(world, ctx, terrain, player);
  const grid = placementBlockerGrid(world, ctx.content, terrain);
  const plotted = plottedNodes(world, ctx, terrain, player);
  const rim = rimOf(buildingFootprintOf(ctx.content, type.typeId, tribe)?.reserved ?? ANCHOR_ONLY);
  const looseEdge = (x: number, y: number): number => {
    let loose = 0;
    for (const c of rim) {
      const cx = x + footprintCellDx(y, c);
      const cy = y + c.dy;
      if (!terrain.inBounds(cx, cy)) continue;
      const node = terrain.nodeAt(cx, cy);
      const slot = cy * terrain.width + cx;
      if (
        terrain.isBuildable(node) &&
        plotted?.has(node) !== true &&
        (grid.obstacle[slot] ?? 0) === 0 &&
        (grid.buildingZone[slot] ?? 0) === 0
      )
        loose++;
    }
    return loose;
  };
  let best: HalfCellNode | null = null;
  let leastLoose = Number.POSITIVE_INFINITY;
  let leastDistance = Number.POSITIVE_INFINITY;
  for (let dy = -fan; dy <= fan; dy++) {
    const span = fan - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const x = anchor.hx + dx;
      const y = anchor.hy + dy;
      if (!terrain.inBounds(x, y) || terrain.componentOf(terrain.nodeAt(x, y)) !== land) continue;
      if (!reach.contains(x, y) || !accept(x, y) || (walkable !== null && !walkable(x, y))) continue;
      const loose = looseEdge(x, y);
      const distance = Math.abs(dx) + Math.abs(dy);
      if (loose > leastLoose || (loose === leastLoose && distance >= leastDistance)) continue;
      best = { hx: x, hy: y };
      leastLoose = loose;
      leastDistance = distance;
    }
  }
  return best;
}

/** The cells bordering `zone` on its rows and columns, each once. */
function rimOf(zone: readonly FootprintCell[]): readonly FootprintCell[] {
  const key = (c: FootprintCell): number => c.dy * RIM_KEY_ROW + c.dx;
  const inside = new Set(zone.map(key));
  const rim = new Map<number, FootprintCell>();
  for (const c of zone) {
    for (const [dx, dy] of RIM_STEPS) {
      const cell = { dx: c.dx + dx, dy: c.dy + dy };
      if (!inside.has(key(cell))) rim.set(key(cell), cell);
    }
  }
  return [...rim.values()];
}

/** The home zones the seat's land takes off its plots: those it owns plus as many more as fit one beside
 *  the other ({@link freeHomeZones}), up to {@link FIT_COUNTED}. Homes are the first copies a plan cuts. */
function homeFit(seat: Seat): number {
  const { world, ctx, terrain, player, owned, anchor, tribe, decision } = seat;
  const home = buildingTypeByContentId(ctx.content, ROOM_HOME_BUILDING);
  if (home === undefined) return FIT_COUNTED;
  const chain = countedTiers(ctx.content, home, undefined);
  const fits = owned.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
  // The plan sizes its homes on the overflow fan round the base.
  const area = { radius: overflowBuildReachNodes(seatTuning(world, player).reachNodes) };
  const free = freeHomeZones(
    world,
    ctx,
    terrain,
    player,
    anchor,
    tribe,
    decision.underFire(),
    FIT_COUNTED - fits,
    area,
  );
  return fits + free;
}

/** The plots still waiting after this decision: those whose step stands met go, a free one that no
 *  longer fits moves ({@link plotOf}). A plot on ground still to clear waits for the plan's review, which
 *  searches it again, and plots a never-cut step with no plot, its building lost or no ground found before. */
function reviewPlots(seat: Seat, carrier: Entity, order: BuildOrder, statuses: LineStatuses): void {
  const { world, ctx, terrain, tribe } = seat;
  const plan = world.get(carrier, GroundPlan);
  const kept: GroundPlot[] = [];
  let changed = false;
  for (const plot of plan.plots) {
    const type = buildingTypeByContentId(ctx.content, plot.building);
    // A skipped step keeps its plot: a seat that lost its herd may hold one again and need the ground.
    const status = statuses.get(plot.line)?.[plot.step];
    if (type === undefined || status === undefined || status === 'satisfied') {
      changed = true;
      continue;
    }
    const probe = placementProbe(world, ctx.content, terrain, type.typeId, tribe);
    if (plot.clearing || probe.canPlace(plot.hx, plot.hy)) {
      kept.push({ ...plot });
      continue;
    }
    changed = true;
    const entry = order.lines.find((line) => line.id === plot.line)?.steps[plot.step];
    const { line, step } = plot;
    const moved = entry?.kind === 'place' ? plotOf(seat, { entry, line, step }) : null;
    if (moved !== null) kept.push(moved);
  }
  if (changed) world.mut(carrier, GroundPlan).plots = kept;
  if (ctx.tick >= plan.reviewTick) reviewGround(seat, carrier, order, statuses);
}

function reviewGround(seat: Seat, carrier: Entity, order: BuildOrder, statuses: LineStatuses): void {
  const { world, ctx } = seat;
  world.mut(carrier, GroundPlan).reviewTick = ctx.tick + PLAN_REVIEW_TICKS;
  // Ground to clear may stand free by now, or a free fit may have opened elsewhere.
  const clearing = world.get(carrier, GroundPlan).plots.filter((plot) => plot.clearing);
  for (const { building, line, step } of clearing) {
    const entry = order.lines.find((held) => held.id === line)?.steps[step];
    const moved = entry?.kind === 'place' ? plotOf(seat, { entry, line, step }) : null;
    const others = world.get(carrier, GroundPlan).plots.filter((plot) => plot.building !== building);
    world.mut(carrier, GroundPlan).plots = [
      ...others.map((plot) => ({ ...plot })),
      ...(moved === null ? [] : [moved]),
    ];
  }
  for (const step of essentialSteps(seat, order, statuses)) {
    if (!NEVER_CUT.includes(step.entry.building)) continue;
    if (world.get(carrier, GroundPlan).plots.some((plot) => plot.building === step.entry.building)) continue;
    const plot = plotOf(seat, step);
    if (plot !== null) world.mut(carrier, GroundPlan).plots.push(plot);
  }
  const { homes } = world.get(carrier, GroundPlan);
  if (homes >= NO_ROOM_HOMES) return;
  // Felled trees and freed plots lift the cut.
  const lifted = Math.max(homes, plannedHomes(homeFit(seat)));
  if (lifted !== homes) world.mut(carrier, GroundPlan).homes = lifted;
}
