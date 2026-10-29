import type { ContentSet } from '@open-northland/data';
import { FishSwarm, Position, Resource } from '../../../../components/index.js';
import type { World } from '../../../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { fishSwarmsNearNode } from '../../../spatial/fish.js';
import { canonicalResources } from '../../../spatial/resources.js';
import { type ZoneGrid, zoneOfNode } from './ground.js';

/** The goods the brief sums deposits of: the ones the computer player already plans by stable content
 *  id. A good the content set lacks is left out. */
export const BRIEF_GOOD_IDS: readonly string[] = ['wood', 'stone', 'mud', 'iron', 'gold', 'mushroom'];

export interface DepositLayers {
  readonly goods: string[];
  readonly deposits: number[];
  readonly fish: number[];
}

/** Every standing resource's `remaining` summed into its zone and good, and every fish swarm's count
 *  into its shore's zone. */
export function scanDeposits(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  grid: ZoneGrid,
): DepositLayers {
  const zones = grid.zonesWide * grid.zonesHigh;
  const goods: string[] = [];
  const columnOf = new Map<number, number>();
  for (const id of BRIEF_GOOD_IDS) {
    const good = goodTypeByContentId(content, id);
    if (good === undefined) continue;
    columnOf.set(good.typeId, goods.length);
    goods.push(id);
  }
  const deposits = new Array<number>(zones * goods.length).fill(0);
  for (const e of canonicalResources(world)) {
    const resource = world.get(e, Resource);
    const column = columnOf.get(resource.goodType);
    if (column === undefined || resource.remaining <= 0) continue;
    const p = world.get(e, Position);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.x, p.y);
    if (!terrain.inBounds(hx, hy)) continue;
    const slot = zoneOfNode(grid, hx, hy) * goods.length + column;
    deposits[slot] = (deposits[slot] ?? 0) + resource.remaining;
  }
  const fish = new Array<number>(zones).fill(0);
  const reach = Math.max(grid.width, grid.height);
  for (const e of fishSwarmsNearNode(world, grid.width >> 1, grid.height >> 1, reach)) {
    const swarm = world.get(e, FishSwarm);
    if (swarm.count <= 0) continue;
    let hx: number;
    let hy: number;
    if (swarm.shore !== null) {
      hx = terrain.xOf(swarm.shore);
      hy = terrain.yOf(swarm.shore);
    } else {
      const p = world.get(e, Position);
      hx = nodeHxOfPosition(p.x, p.y);
      hy = nodeHyOfPosition(p.x, p.y);
    }
    if (!terrain.inBounds(hx, hy)) continue;
    const zone = zoneOfNode(grid, hx, hy);
    fish[zone] = (fish[zone] ?? 0) + swarm.count;
  }
  return { goods, deposits, fish };
}
