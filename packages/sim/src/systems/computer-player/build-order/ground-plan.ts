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
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId, countedTiers } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { firstRingNode } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { ANCHOR_ONLY, buildingFootprintOf, translatedCells } from '../../footprint/geometry.js';
import { placementBlockerGrid } from '../../footprint/placement/blocker-grid.js';
import { placementProbe } from '../../footprint/placement/building.js';
import { minutesToTicks } from '../game-phase.js';
import { clearingPatch } from '../workforce/collectors/clearing-aim.js';
import { type BuildOrder, type BuildOrderEntry, OPENING_HOMES, overflowBuildReachNodes } from './entries.js';
import { baseComponent, buildReach, placementPassesOver, placementSpot } from './placement.js';
import { plottedNodes, seatSpotAcceptor } from './plots.js';
import { type LineStatuses, upgradesInto } from './progress.js';
import { NO_ROOM_HOMES, seatHasSide, seatTuning } from './seat-order.js';
import { baseWalkTest } from './spot-walk.js';

/** The fewest homes a plan cuts a seat to (authored): every seat on arabskie_wyspy_wolna_gra_mieszana held
 *  five by game minute 45 in the plain order, and cut to three or four its women stood at 3-10 where they
 *  had stood at 10-17, too few people for an economy and a colony's crew. */
export const PLANNED_HOMES_FLOOR = 5;

/** When a seat draws its plan (authored): past the opening's first homes and school, which keep the ground
 *  by the base. Drawn at the start, the plots sent the school 39 nodes out where it stood 17 from the
 *  headquarters, it finished ten to twenty minutes later and the housing lane behind it held back the
 *  homes; the big patches lasted to minute 30 unplotted (arabskie_wyspy_wolna_gra_mieszana). */
export const GROUND_PLAN_FROM_TICKS = minutesToTicks(10);

/** Owner ruling: what a plan never cuts, plotted ahead of every bigger building: on one island seat a
 *  bakery's plot took the last patch the barracks could be cleared on. */
const NEVER_CUT: readonly string[] = ['barracks', 'work_armory_00'];

/** The stable content id of the home chain's base tier. */
const HOME_BUILDING = 'home_level_00';

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
 * first, packed by {@link packedSpot}, and cuts its homes to what still fits ({@link fittingHomes}). Plotting
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
  if (carrier === null || ctx.tick < GROUND_PLAN_FROM_TICKS || !seatHasSide(world, player, 'noRoom')) return;
  const seat: Seat = { world, ctx, terrain, player, owned, anchor, tribe, decision };
  if (world.has(carrier, GroundPlan)) reviewPlots(seat, carrier, order, statuses);
  else drawGroundPlan(seat, carrier, order, statuses);
}

function drawGroundPlan(seat: Seat, carrier: Entity, order: BuildOrder, statuses: LineStatuses): void {
  const { world } = seat;
  world.add(carrier, GroundPlan, { plots: [], homes: NO_ROOM_HOMES });
  for (const step of essentialSteps(seat, order, statuses)) {
    const plot = plotOf(seat, step);
    if (plot !== null) world.mut(carrier, GroundPlan).plots.push(plot);
  }
  const homes = fittingHomes(seat);
  if (homes < NO_ROOM_HOMES) world.mut(carrier, GroundPlan).homes = homes;
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
  const home = buildingTypeByContentId(ctx.content, HOME_BUILDING);
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
  return patch === null ? null : { ...plot, hx: patch.x, hy: patch.y, clearing: true };
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

/**
 * The homes the seat keeps: those it owns plus as many more zones as fit one beside the other on its
 * land off the plots, within {@link PLANNED_HOMES_FLOOR} and {@link NO_ROOM_HOMES}. Homes are the first copies
 * a plan cuts.
 */
function fittingHomes(seat: Seat): number {
  const { world, ctx, terrain, player, owned, anchor, tribe, decision } = seat;
  const home = buildingTypeByContentId(ctx.content, HOME_BUILDING);
  if (home === undefined) return NO_ROOM_HOMES;
  const chain = countedTiers(ctx.content, home, undefined);
  let fits = owned.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
  const zone = buildingFootprintOf(ctx.content, home.typeId, tribe)?.reserved ?? ANCHOR_ONLY;
  const fan = overflowBuildReachNodes(seatTuning(world, player).reachNodes);
  const accept = seatSpotAcceptor(world, ctx, terrain, player, home.typeId, tribe).around(
    decision.underFire(),
    anchor,
    fan,
  );
  const land = baseComponent(world, ctx, terrain, player);
  const taken = new Set<NodeId>();
  while (fits < NO_ROOM_HOMES) {
    const spot = firstRingNode(
      anchor.hx,
      anchor.hy,
      fan,
      (x, y) =>
        terrain.inBounds(x, y) &&
        terrain.componentOf(terrain.nodeAt(x, y)) === land &&
        accept(x, y) &&
        !translatedCells(terrain, zone, x, y).some((node) => taken.has(node)),
    );
    if (spot === null) break;
    for (const node of translatedCells(terrain, zone, spot.hx, spot.hy)) taken.add(node);
    fits++;
  }
  return Math.max(PLANNED_HOMES_FLOOR, fits);
}

/** The plots still waiting after this decision: those whose step no longer waits go, a free one that no
 *  longer fits moves ({@link plotOf}). A plot on ground still to clear stays where it lies. */
function reviewPlots(seat: Seat, carrier: Entity, order: BuildOrder, statuses: LineStatuses): void {
  const { world, ctx, terrain, tribe } = seat;
  const plots = world.get(carrier, GroundPlan).plots;
  if (plots.length === 0) return;
  const kept: GroundPlot[] = [];
  let changed = false;
  for (const plot of plots) {
    const type = buildingTypeByContentId(ctx.content, plot.building);
    if (type === undefined || statuses.get(plot.line)?.[plot.step] !== 'unmet') {
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
  if (!changed) return;
  const plan = world.mut(carrier, GroundPlan);
  plan.plots = kept;
  // Ground freed since the last read, felled trees included, lifts the cut; with no plot left nothing needs it.
  plan.homes = kept.length === 0 ? NO_ROOM_HOMES : Math.max(plan.homes, fittingHomes(seat));
}
