import {
  AiControl,
  type BriefLandComponent,
  computerControllerRuns,
  mapBriefOf,
  writeMapBrief,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { REGION_NODES } from '../../../spatial/region.js';
import { coastsOf } from '../../sea-route.js';
import { scanDeposits } from './deposits.js';
import { scanGround, zoneGridOf } from './ground.js';
import { scanSeatStarts } from './seats.js';

export { BRIEF_GOOD_IDS } from './deposits.js';

/** The brief's zone edge in half-cell nodes: the spatial indexes' regions, so a zone is one region. */
export const BRIEF_ZONE_NODES = REGION_NODES;

/**
 * Take the map brief the first time a computer controller runs on a mapped world: one scan of the
 * ground, the deposits and the seat starts as they stand then. A world where no seat's computer
 * controller runs never pays for it.
 */
export function ensureMapBrief(world: World, ctx: SystemContext): void {
  const terrain = ctx.terrain;
  if (terrain === undefined || mapBriefOf(world) !== null) return;
  let carrier: Entity | null = null;
  for (const e of world.query(AiControl)) {
    if (!computerControllerRuns(world, world.get(e, AiControl).player)) continue;
    if (carrier === null || e < carrier) carrier = e;
  }
  if (carrier !== null) scanMapBrief(world, ctx, terrain, carrier);
}

/** Held on the lowest-id running seat's {@link AiControl} carrier; a `setAiControl` that removes that
 *  carrier hands the brief on first (`handOnMapBrief`). */
function scanMapBrief(world: World, ctx: SystemContext, terrain: TerrainGraph, carrier: Entity): void {
  const grid = zoneGridOf(terrain, BRIEF_ZONE_NODES);
  const ground = scanGround(world, ctx.content, terrain, grid);
  const deposits = scanDeposits(world, ctx.content, terrain, grid);
  const seats = scanSeatStarts(world, ctx, terrain);
  const startLands = new Set(seats.map((seat) => seat.component));
  const coasts = coastsOf(terrain);
  const zoneArea = BRIEF_ZONE_NODES * BRIEF_ZONE_NODES;
  const landComponents: BriefLandComponent[] = [];
  for (const [component, nodes] of ground.componentNodes) {
    if (component === NO_COMPONENT || (nodes < zoneArea && !startLands.has(component))) continue;
    const waters = [...(coasts.get(component) ?? [])].sort((a, b) => a - b);
    landComponents.push({ component, nodes, waters });
  }
  landComponents.sort((a, b) => a.component - b.component);
  writeMapBrief(world, carrier, {
    scanned: true,
    ...grid,
    land: ground.land,
    water: ground.water,
    free: ground.free,
    clearable: ground.clearable,
    blocked: ground.blocked,
    plantable: ground.plantable,
    dominantLand: ground.dominantLand,
    ...deposits,
    landComponents,
    seats,
  });
}
