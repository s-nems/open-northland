import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { aiControlEntity, ComputerColony } from '../../../../src/components/index.js';
import { everyBuildingOf } from '../../../../src/systems/ai-shared/home-roster.js';
import { colonyMakes, landHolds } from '../../../../src/systems/computer-player/colony/provision.js';
import type { ColonyEnv } from '../../../../src/systems/computer-player/colony/voyage.js';
import { colonyContent, colonyWorld, WHEAT } from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { FARM_TYPE, MUD, SEAT, STONE, VIKING, WOOD } from '../support.js';

const EAST_ISLAND = { hx: 160, hy: 60 };
const FARM_AT = { x: 170, y: 100 };
const SEED = 7;

/** The fixture's farm, which names the grain it grows. */
function farmingContent() {
  const content = colonyContent();
  return parseContentSet({
    ...content,
    buildings: content.buildings.map((b) => (b.typeId === FARM_TYPE ? { ...b, produces: [WHEAT] } : b)),
  });
}

function setup() {
  const sim = colonyWorld(SEED, farmingContent());
  const ctx = ctxOf(sim);
  const terrain = ctx.terrain;
  const carrier = aiControlEntity(sim.world, SEAT);
  if (terrain === undefined || carrier === null) throw new Error('setup');
  const env: ColonyEnv = {
    world: sim.world,
    ctx,
    terrain,
    seat: SEAT,
    carrier,
    edit: () => sim.world.mut(carrier, ComputerColony),
  };
  return { sim, env };
}

describe('what a colony makes', () => {
  it('counts the deposits its land holds and no others', () => {
    const { env } = setup();
    expect(landHolds(env, EAST_ISLAND, WOOD)).toBe(true);
    expect(landHolds(env, EAST_ISLAND, MUD)).toBe(false);
    const makes = colonyMakes(env, EAST_ISLAND, []);
    expect(makes.has(WOOD)).toBe(true);
    expect(makes.has(STONE)).toBe(true);
    expect(makes.has(MUD)).toBe(false);
  });

  it('adds what a standing workshop produces, and nothing for a site', () => {
    const { sim, env } = setup();
    const place = (underConstruction: boolean) =>
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: FARM_TYPE,
        ...FARM_AT,
        tribe: VIKING,
        owner: SEAT,
        force: true,
        underConstruction,
      });
    place(true);
    sim.step();
    const farmed = (): boolean => colonyMakes(env, EAST_ISLAND, everyBuildingOf(sim.world, SEAT)).has(WHEAT);
    expect(farmed()).toBe(false);
    for (const e of everyBuildingOf(sim.world, SEAT)) sim.world.destroy(e);
    place(false);
    sim.step();
    expect(farmed()).toBe(true);
  });
});
