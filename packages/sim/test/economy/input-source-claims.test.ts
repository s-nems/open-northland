import { describe, expect, it } from 'vitest';
import { PickupClaim, PlayerOrder, SupplyRun } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { plannerSystem } from '../../src/systems/index.js';
import { clearNavState } from '../../src/systems/movement/nav-state.js';
import type { HaulFlagArea } from '../../src/systems/settlers/drives/economy/haul-flag-area.js';
import { nearestMissingInputSource } from '../../src/systems/settlers/drives/economy/workshop/supply.js';
import type { PlannerContext } from '../../src/systems/settlers/planner/context.js';
import { collectTargets } from '../../src/systems/settlers/targets/index.js';
import { GossipCandidates } from '../../src/systems/social/index.js';
import { collectSupplyTally } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import {
  buildingAt,
  CARPENTER,
  CARRIER,
  cell,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  pileAt,
  SAWMILL,
  settlerAt,
  VIKING,
  WOOD,
} from './producer-supply/support.js';

/**
 * A producer fetching a missing input passes over a source whose units of it are all claimed by settlers
 * already walking there, and takes it again once that claim is released. The claim steers the choice only.
 */

const STRIP_WIDTH = 14;
const NEAR_STORE_X = 6;
const FAR_STORE_X = 12;

function twoMillsSharingWood() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(STRIP_WIDTH, 1) });
  const firstMill = buildingAt(sim, SAWMILL, 0, 0);
  const secondMill = buildingAt(sim, SAWMILL, 3, 0);
  const near = buildingAt(sim, HEADQUARTERS, NEAR_STORE_X, 0, [[WOOD, 1]]);
  const far = buildingAt(sim, HEADQUARTERS, FAR_STORE_X, 0, [[WOOD, 1]]);
  // Planned first: the lower id.
  const first = settlerAt(sim, 0, 0, CARPENTER, firstMill);
  const second = settlerAt(sim, 3, 0, CARPENTER, secondMill);
  return { sim, first, second, near, far };
}

describe('workshop input fetch honours pickup claims', () => {
  it('sends the later-planned worker to the far store when the near unit is claimed', () => {
    const { sim, first, second, near, far } = twoMillsSharingWood();
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(first, PickupClaim)).toEqual({ source: near, goodType: WOOD, amount: 1 });
    expect(sim.world.get(second, PickupClaim).source).toBe(far);
  });

  it('frees the near unit once the first walker is diverted by an order', () => {
    const { sim, first, second, near, far } = twoMillsSharingWood();
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(second, PickupClaim).source).toBe(far);
    sim.world.add(first, PlayerOrder, {});
    // The second worker reaches a re-plan point, so it chooses its source again.
    clearNavState(sim.world, second);
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(first, PickupClaim)).toBe(false);
    expect(sim.world.has(first, SupplyRun)).toBe(false);
    expect(sim.world.get(second, PickupClaim).source).toBe(near);
  });
});

describe('a flagged carrier passes over a claimed loose pile', () => {
  function flaggedCarrierScene() {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(STRIP_WIDTH, 1) });
    const mill = buildingAt(sim, SAWMILL, 0, 0);
    const nearPile = pileAt(sim, 4, 0, [[WOOD, 1]]);
    const farPile = pileAt(sim, 8, 0, [[WOOD, 1]]);
    const carrier = settlerAt(sim, 2, 0, CARRIER, mill);
    const rival = settlerAt(sim, 4, 0, CARRIER);
    if (sim.terrain === undefined) throw new Error('mapped fixture');
    const terrain = sim.terrain;
    const ctx = ctxOf(sim);
    const plan: PlannerContext = {
      world: sim.world,
      ctx,
      terrain,
      entity: carrier,
      here: cell(sim, 2, 0),
      tribe: VIKING,
      jobType: CARRIER,
      experience: new Map(),
      owner: undefined,
      limit: null,
      targets: collectTargets(sim.world, ctx, terrain),
      supply: collectSupplyTally(sim.world),
      gossipCandidates: new GossipCandidates(sim.world, sim.content),
    };
    const area: HaulFlagArea = {
      flag: nearPile,
      center: cell(sim, 2, 0),
      gate: {
        bounds: { minX: 0, maxX: terrain.width - 1, minY: 0, maxY: terrain.height - 1 },
        allowsNode: () => true,
      },
    };
    return { plan, mill, nearPile, farPile, rival, area };
  }

  function sourceOf(plan: PlannerContext, mill: Entity, area: HaulFlagArea): Entity | undefined {
    const recipe = { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [], ticks: 1 };
    return nearestMissingInputSource(plan, mill, recipe, { restockToCapacity: true }, area)?.store;
  }

  it('takes the far pile while a rival walks to the near one, and the near one once it lets go', () => {
    const { plan, mill, nearPile, farPile, rival, area } = flaggedCarrierScene();
    expect(sourceOf(plan, mill, area)).toBe(nearPile);
    plan.supply.stampPickupClaim(rival, { source: nearPile, goodType: WOOD, amount: 1 });
    expect(sourceOf(plan, mill, area)).toBe(farPile);
    plan.supply.releaseErrands(rival);
    expect(sourceOf(plan, mill, area)).toBe(nearPile);
  });
});
