import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, type Simulation } from '../../src/index.js';
import { createSignpost } from '../../src/systems/index.js';

/** Stand a signpost directly (bypassing the scout's hammer swing and the legality gate), linked as the
 *  erect would link it - the shared network fixture for the signpost test suites. `x`/`y` are integer
 *  TILE coords. */
export function stampPost(sim: Simulation, x: number, y: number, player = 0): Entity {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('stampPost needs a mapped sim');
  const anchor = cellAnchorNode(x, y);
  return createSignpost(sim.world, terrain, terrain.nodeAt(anchor.hx, anchor.hy), player);
}
