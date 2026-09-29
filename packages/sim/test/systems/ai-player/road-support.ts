import { Position, RoadSite } from '../../../src/components/index.js';
import { aiCommand, type PlayerCommand } from '../../../src/core/commands/index.js';
import { hexNeighboursOf, nodeOfPosition, Simulation } from '../../../src/index.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { ROADS_FROM_TICKS } from '../../../src/systems/ai-player/game-phase.js';
import { structureBlockOverlay } from '../../../src/systems/footprint/blocked.js';
import { layRoad } from '../../../src/systems/roads/index.js';
import { ownedRoadSites, roadSitesByNode } from '../../../src/systems/roads/site-index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { BUILDER, ctxOf, HOME_TYPE, HQ_TYPE, HQ_X, HQ_Y, SEAT, spawnMen, VIKING } from './support.js';

/** A home far enough west of the HQ that its road runs a good stretch of open grass. */
export const HOME_X = HQ_X - 16;
export const HOME_Y = HQ_Y;

/** The seat's HQ door, where every route of the road cases ends. */
export const HQ_DOOR = { x: HQ_X, y: HQ_Y + 4 };

/** A seat at the road clock with its stocked HQ, a built home to the west and `men` builders. */
export function roadSim(seed: number, men: number): Simulation {
  const sim = new Simulation({ seed, content: aiContent(), map: grassNodeMap(64, 32) });
  sim.restoreTick(ROADS_FROM_TICKS);
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HQ_TYPE,
    x: HQ_X,
    y: HQ_Y,
    tribe: VIKING,
    owner: SEAT,
    fillStock: true,
  });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HOME_TYPE,
    x: HOME_X,
    y: HOME_Y,
    tribe: VIKING,
    owner: SEAT,
  });
  spawnMen(sim, men, BUILDER);
  sim.step();
  return sim;
}

/** Apply the seat's `commands` and step once. */
export function apply(sim: Simulation, commands: readonly PlayerCommand[]): void {
  for (const command of commands) sim.enqueue(aiCommand(SEAT, command));
  sim.step();
}

export const sitesOf = (sim: Simulation): number =>
  sim.terrain === undefined ? 0 : ownedRoadSites(sim.world, sim.terrain, SEAT).size;

export function terrainOf(sim: Simulation): TerrainGraph {
  if (sim.terrain === undefined) throw new Error('mapped sim');
  return sim.terrain;
}

/** Whether roads and road sites join the building at `from` to the one at `to` node by node over the
 *  ring a road paints across, from beside the one to beside the other: an entrance on a building's
 *  own body takes no road. */
export function paved(
  sim: Simulation,
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  const terrain = terrainOf(sim);
  const sites = roadSitesByNode(sim.world, terrain);
  const blocked = structureBlockOverlay(sim.world, ctxOf(sim, sim.tick), terrain);
  const carries = (node: NodeId): boolean => (terrain.isRoad(node) || sites.has(node)) && !blocked.has(node);
  const ring = (x: number, y: number): NodeId[] => [
    terrain.nodeAt(x, y),
    ...hexNeighboursOf(x, y)
      .filter((n) => terrain.inBounds(n.hx, n.hy))
      .map((n) => terrain.nodeAt(n.hx, n.hy)),
  ];
  const goal = new Set(ring(to.x, to.y));
  const open = ring(from.x, from.y).filter(carries);
  const seen = new Set<NodeId>(open);
  for (let node = open.pop(); node !== undefined; node = open.pop()) {
    if (goal.has(node)) return true;
    for (const next of ring(terrain.xOf(node), terrain.yOf(node))) {
      if (seen.has(next) || !carries(next)) continue;
      seen.add(next);
      open.push(next);
    }
  }
  return false;
}

/** Turn every road site into road, as a finished run would. */
export function paveSites(sim: Simulation): void {
  const terrain = terrainOf(sim);
  const nodes: NodeId[] = [];
  for (const e of sim.world.query(RoadSite, Position)) {
    const at = nodeOfPosition(sim.world.get(e, Position).x, sim.world.get(e, Position).y);
    nodes.push(terrain.nodeAt(at.hx, at.hy));
  }
  layRoad(sim.world, terrain, nodes);
  apply(
    sim,
    [...sim.world.query(RoadSite)].map((roadSite) => ({ kind: 'cancelRoadSite', roadSite }) as const),
  );
}
