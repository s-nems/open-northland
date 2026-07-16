import { Owner, Position, SIGNPOST_SPACING_RADIUS_NODES, Signpost } from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';

/** Stamp a standing signpost directly (bypassing the scout's hammer swing) — the shared network fixture
 *  for the signpost test suites. `x`/`y` are integer TILE coords (Position is tile-space). */
export function stampPost(sim: Simulation, x: number, y: number, navRadius: number, player = 0): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Owner, { player });
  sim.world.add(e, Signpost, { navRadius, spacingRadius: SIGNPOST_SPACING_RADIUS_NODES });
  return e;
}
