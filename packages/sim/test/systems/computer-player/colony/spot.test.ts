import { describe, expect, it } from 'vitest';
import { nodeManhattan } from '../../../../src/nav/halfcell.js';
import { buildingTypeByContentId } from '../../../../src/systems/ai-shared/content-lookup.js';
import { colonySpot, shoreWithStore } from '../../../../src/systems/computer-player/colony/spot.js';
import { blankColony, colonyWorld, looseColonyEnv } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { CIVILIST, SEAT, VIKING } from '../support.js';

/** The east island's west shore, and a node in the strait a site's centre could fall on. */
const EAST_SHORE = { hx: 142, hy: 60 };
const IN_THE_STRAIT = { hx: 120, hy: 60 };
const SEARCH_NODES = 40;
const STORE_ID = 'stock_00';

function setup() {
  const sim = colonyWorld();
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const store = buildingTypeByContentId(ctx.content, STORE_ID);
  if (terrain === undefined || store === undefined) throw new Error('setup');
  const land = terrain.componentOf(terrain.nodeAt(EAST_SHORE.hx, EAST_SHORE.hy));
  const env = looseColonyEnv(sim, blankColony(land));
  return { sim, env, terrain, land, store };
}

describe('a colony spot', () => {
  it('stands on the colony land near a shore, once a man of the seat stands there', () => {
    const { sim, env, terrain, land, store } = setup();
    expect(colonySpot(env, land, store, VIKING, EAST_SHORE, SEARCH_NODES)).toBeNull();
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: CIVILIST,
      x: EAST_SHORE.hx,
      y: EAST_SHORE.hy,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const spot = colonySpot(env, land, store, VIKING, EAST_SHORE, SEARCH_NODES);
    if (spot === null) throw new Error('no spot');
    expect(terrain.componentOf(terrain.nodeAt(spot.hx, spot.hy))).toBe(land);
    expect(nodeManhattan(spot, EAST_SHORE)).toBeLessThanOrEqual(SEARCH_NODES);
  });

  it('finds land from a centre in the water only within its radius, and picks the shore with room before anyone lands', () => {
    const { env, terrain, land, store } = setup();
    expect(terrain.isWater(terrain.nodeAt(IN_THE_STRAIT.hx, IN_THE_STRAIT.hy))).toBe(true);
    expect(colonySpot(env, land, store, VIKING, IN_THE_STRAIT, 1)).toBeNull();
    expect(shoreWithStore(env, land, [IN_THE_STRAIT, EAST_SHORE])).toEqual(EAST_SHORE);
  });
});
