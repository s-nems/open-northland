import type { ContentSet } from '@open-northland/data';
import { landscapeEditState } from '../../../../components/landscape.js';
import type { World } from '../../../../ecs/world.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../../../nav/terrain/index.js';
import { placementBlockerGrid } from '../../../footprint/placement/blocker-grid.js';
import { resourceBlockedLayer } from '../../../footprint/resource-blocked-cache.js';
import { landscapeBlocks } from '../../../landscape/view.js';

/** The zone grid over a map: zones are `zoneNodes`-square blocks of half-cell nodes, the last row and
 *  column cut short by the map edge. */
export interface ZoneGrid {
  readonly width: number;
  readonly height: number;
  readonly zoneNodes: number;
  readonly zonesWide: number;
  readonly zonesHigh: number;
}

export function zoneGridOf(terrain: TerrainGraph, zoneNodes: number): ZoneGrid {
  return {
    width: terrain.width,
    height: terrain.height,
    zoneNodes,
    zonesWide: Math.ceil(terrain.width / zoneNodes),
    zonesHigh: Math.ceil(terrain.height / zoneNodes),
  };
}

/** The zone holding node `(hx, hy)`, which must lie on the map. */
export function zoneOfNode(grid: ZoneGrid, hx: number, hy: number): number {
  return Math.floor(hy / grid.zoneNodes) * grid.zonesWide + Math.floor(hx / grid.zoneNodes);
}

export interface GroundLayers {
  readonly land: number[];
  readonly water: number[];
  readonly free: number[];
  readonly clearable: number[];
  readonly blocked: number[];
  readonly plantable: number[];
  readonly dominantLand: number[];
  /** Walkable land nodes per land component over the whole map. */
  readonly componentNodes: ReadonlyMap<number, number>;
}

/** What stood on a buildable node at the scan. */
type GroundUse = 'free' | 'clearable' | 'blocked' | 'occupied';

/**
 * The per-zone ground counts, read zone by zone so one small tally names each zone's dominant land
 * component. A buildable node is free with no blocker count on it, blocked under the static landscape
 * layer (the non-resource placements no player removes) or a script's closed node, clearable when the
 * resource layer accounts for every obstacle on it (trees, rocks and other harvestable nodes), and
 * occupied otherwise (buildings, walls, signposts, vehicles).
 */
export function scanGround(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  grid: ZoneGrid,
): GroundLayers {
  const zones = grid.zonesWide * grid.zonesHigh;
  const layers = {
    land: new Array<number>(zones).fill(0),
    water: new Array<number>(zones).fill(0),
    free: new Array<number>(zones).fill(0),
    clearable: new Array<number>(zones).fill(0),
    blocked: new Array<number>(zones).fill(0),
    plantable: new Array<number>(zones).fill(0),
    dominantLand: new Array<number>(zones).fill(NO_COMPONENT),
  };
  const placement = placementBlockerGrid(world, content, terrain);
  const resourceCounts = resourceBlockedLayer(world, terrain).counts;
  const landscape = landscapeBlocks(world, terrain);
  const forbidden = landscapeEditState(world).forbidden;
  const useOf = (node: NodeId): GroundUse => {
    const obstacle = placement.obstacle[node] ?? 0;
    const exclusion = placement.exclusion[node] ?? 0;
    const structure = (placement.buildingZone[node] ?? 0) + (placement.palisadeBody[node] ?? 0);
    if (obstacle + exclusion + structure === 0) return 'free';
    if ((landscape.walkCounts[node] ?? 0) > 0 || landscape.build.has(node) || forbidden.has(node)) {
      return 'blocked';
    }
    // Without a landscape build cell on the node, its exclusion count is resource build margins alone.
    return structure === 0 && obstacle === (resourceCounts[node] ?? 0) ? 'clearable' : 'occupied';
  };
  const componentNodes = new Map<number, number>();
  const zoneTally = new Map<number, number>();
  for (let zy = 0; zy < grid.zonesHigh; zy++) {
    for (let zx = 0; zx < grid.zonesWide; zx++) {
      const zone = zy * grid.zonesWide + zx;
      zoneTally.clear();
      let land = 0;
      let water = 0;
      let free = 0;
      let clearable = 0;
      let blocked = 0;
      let plantable = 0;
      const maxY = Math.min(grid.height, (zy + 1) * grid.zoneNodes);
      const maxX = Math.min(grid.width, (zx + 1) * grid.zoneNodes);
      for (let y = zy * grid.zoneNodes; y < maxY; y++) {
        for (let x = zx * grid.zoneNodes; x < maxX; x++) {
          const node = terrain.nodeAt(x, y);
          if (terrain.isWater(node)) water++;
          else if (terrain.isWalkable(node)) {
            land++;
            const component = terrain.componentOf(node);
            if (component !== NO_COMPONENT) zoneTally.set(component, (zoneTally.get(component) ?? 0) + 1);
          }
          if (!terrain.isBuildable(node)) continue;
          const use = useOf(node);
          if (use === 'free') {
            free++;
            if (terrain.isPlantable(node)) plantable++;
          } else if (use === 'clearable') clearable++;
          else if (use === 'blocked') blocked++;
        }
      }
      layers.land[zone] = land;
      layers.water[zone] = water;
      layers.free[zone] = free;
      layers.clearable[zone] = clearable;
      layers.blocked[zone] = blocked;
      layers.plantable[zone] = plantable;
      let dominant = NO_COMPONENT;
      let most = 0;
      for (const [component, count] of zoneTally) {
        componentNodes.set(component, (componentNodes.get(component) ?? 0) + count);
        if (count > most || (count === most && component < dominant)) {
          dominant = component;
          most = count;
        }
      }
      layers.dominantLand[zone] = dominant;
    }
  }
  return { ...layers, componentNodes };
}
