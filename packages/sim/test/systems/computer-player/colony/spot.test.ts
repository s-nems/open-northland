import { describe, expect, it } from 'vitest';
import { FOG_MODE, Resource } from '../../../../src/components/index.js';
import { halfCellMapFromCells, Simulation } from '../../../../src/index.js';
import { nodeManhattan } from '../../../../src/nav/halfcell.js';
import { buildingTypeByContentId } from '../../../../src/systems/ai-shared/content-lookup.js';
import { colonySpot } from '../../../../src/systems/computer-player/colony/spot.js';
import { shoreScore, shoreWithStore } from '../../../../src/systems/computer-player/colony/voyage/shore.js';
import { blankColony, colonyContent, colonyWorld, looseColonyEnv } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { CIVILIST, MUD, makeAiSeat, SEAT, VIKING, WOOD, WOOD_HARVEST } from '../support.js';

/** The east island's west shore, and a node in the strait a site's centre could fall on. */
const EAST_SHORE = { hx: 142, hy: 60 };
const IN_THE_STRAIT = { hx: 120, hy: 60 };
const SEARCH_NODES = 40;
const STORE_ID = 'stock_00';
/** A map whose strait is narrower than a shore's look: cells of the west island, the strait, the east one. */
const NARROW = { width: 60, height: 40, straitFrom: 20, straitTo: 30 };
const GRASS = 0;
const WATER = 1;
/** The narrow map's east shore, and a node on the west island across the strait from it. */
const NARROW_EAST_SHORE = { hx: 60, hy: 40 };
const ACROSS_THE_STRAIT = { hx: 36, hy: 40 };
/** A deposit on the east island near its shore, in the original's mud-digging atomic. */
const NEAR_EAST_SHORE = { hx: 152, hy: 60 };
const MUD_HARVEST = 32;
const DEPOSIT_UNITS = 10;

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

/** A seat with nobody on either island of {@link NARROW}, the fog off. */
function narrowStrait(): Simulation {
  const { width, height, straitFrom, straitTo } = NARROW;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++)
    for (let col = straitFrom; col < straitTo; col++) typeIds[row * width + col] = WATER;
  const sim = new Simulation({
    seed: 1,
    content: colonyContent(),
    map: halfCellMapFromCells({ width, height, typeIds }),
  });
  makeAiSeat(sim, SEAT);
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.step();
  return sim;
}

describe("a shore's score", () => {
  it('counts no deposit across the water toward the shore', () => {
    const sim = narrowStrait();
    const terrain = ctxOf(sim).terrain;
    if (terrain === undefined) throw new Error('setup');
    const land = terrain.componentOf(terrain.nodeAt(NARROW_EAST_SHORE.hx, NARROW_EAST_SHORE.hy));
    const env = looseColonyEnv(sim, blankColony(land));
    const score = () => shoreScore(env, land, NARROW_EAST_SHORE, NARROW_EAST_SHORE, VIKING);
    const before = score();
    const { hx: x, hy: y } = ACROSS_THE_STRAIT;
    sim.enqueueSetup({
      kind: 'placeResource',
      good: WOOD,
      x,
      y,
      remaining: DEPOSIT_UNITS,
      harvestAtomic: WOOD_HARVEST,
    });
    sim.step();
    expect(score()).toBe(before);
  });

  it('counts no deposit the seat never saw toward the shore', () => {
    const { sim, env, land } = setup();
    const { hx: x, hy: y } = NEAR_EAST_SHORE;
    sim.enqueueSetup({
      kind: 'placeResource',
      good: MUD,
      x,
      y,
      remaining: DEPOSIT_UNITS,
      harvestAtomic: MUD_HARVEST,
    });
    sim.step();
    const deposit = [...sim.world.query(Resource)].find((e) => sim.world.get(e, Resource).goodType === MUD);
    // Fog of war over a seat that never looked across the strait; no step after, which would reset it.
    const fog = sim.fog;
    if (fog === undefined || deposit === undefined) throw new Error('setup');
    fog.activeMode = FOG_MODE.CLASSIC_FOG_OF_WAR;
    const fogged = { ...env, ctx: { ...env.ctx, fog } };
    const score = () => shoreScore(fogged, land, EAST_SHORE, EAST_SHORE, VIKING);
    const unseen = score();
    sim.world.destroy(deposit);
    expect(score()).toBe(unseen);
  });
});
