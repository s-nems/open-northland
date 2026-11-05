import { footprintCellDx } from '@open-northland/data';
import { aiControlEntity, GroundPlan, playerPlacementTribes } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { type SpotAcceptor, spotAcceptor } from '../../ai-shared/building-spot.js';
import { buildingTypeByContentId, countedTiers } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import { ANCHOR_ONLY, buildingFootprintOf, translatedCells } from '../../footprint/geometry.js';
import { seatDepositKept } from './deposit-keep.js';

/**
 * The reserved nodes of the seat's ground plots (`./ground-plan.ts`), but those of a plot `forType` takes
 * itself, a tier of the plot's chain; null while none is kept, so a seat with no plan pays one read.
 */
export function plottedNodes(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  forType?: number,
): ReadonlySet<NodeId> | null {
  const carrier = aiControlEntity(world, player);
  const plots = carrier === null ? undefined : world.tryGet(carrier, GroundPlan)?.plots;
  const tribe = playerPlacementTribes(world, player)?.[0];
  if (plots === undefined || plots.length === 0 || tribe === undefined) return null;
  const nodes = new Set<NodeId>();
  for (const { building, hx, hy } of plots) {
    const type = buildingTypeByContentId(ctx.content, building);
    if (type === undefined) continue;
    if (forType !== undefined && countedTiers(ctx.content, type, undefined).has(forType)) continue;
    const zone = buildingFootprintOf(ctx.content, type.typeId, tribe)?.reserved;
    for (const node of translatedCells(terrain, zone ?? ANCHOR_ONLY, hx, hy)) nodes.add(node);
  }
  return nodes.size === 0 ? null : nodes;
}

/** The seat's placement test ({@link spotAcceptor}), off only the deposits the seat still works
 *  ({@link seatDepositKept}), which also keeps a building's zone off the ground
 *  plotted for another: every computer search goes through it, a human's placement never. */
export function seatSpotAcceptor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  buildingTypeId: number,
  tribe: number,
  withinReach = true,
): SpotAcceptor {
  const acceptor = spotAcceptor(
    world,
    ctx,
    terrain,
    player,
    buildingTypeId,
    tribe,
    seatDepositKept(world, ctx, player),
    withinReach,
  );
  const plotted = plottedNodes(world, ctx, terrain, player, buildingTypeId);
  if (plotted === null) return acceptor;
  const reserved = buildingFootprintOf(ctx.content, buildingTypeId, tribe)?.reserved;
  const zone = reserved !== undefined && reserved.length > 0 ? reserved : ANCHOR_ONLY;
  const offPlots = (x: number, y: number): boolean => {
    for (const c of zone) {
      const cx = x + footprintCellDx(y, c);
      const cy = y + c.dy;
      if (terrain.inBounds(cx, cy) && plotted.has(terrain.nodeAt(cx, cy))) return false;
    }
    return true;
  };
  return {
    grassBeside: acceptor.grassBeside,
    around(underFire, centre, fan, spareGrass) {
      const accept = acceptor.around(underFire, centre, fan, spareGrass);
      return (x, y) => accept(x, y) && offPlots(x, y);
    },
  };
}

/** `count` homes under the seat's ground plan's cut (`./ground-plan.ts`). */
export function seatHomesCap(world: World, player: number, count: number): number {
  const carrier = aiControlEntity(world, player);
  const plan = carrier === null ? undefined : world.tryGet(carrier, GroundPlan);
  return plan === undefined ? count : Math.min(count, plan.homes);
}
