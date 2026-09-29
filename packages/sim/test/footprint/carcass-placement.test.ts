import { describe, expect, it } from 'vitest';
import { KilledBy, Position, Resource, ResourceLayers } from '../../src/components/index.js';
import { nodeOfPosition } from '../../src/index.js';
import { assembleBuilding } from '../../src/systems/command/placement.js';
import { placeCarcass } from '../../src/systems/economy/carcasses.js';
import { canPlaceBuilding } from '../../src/systems/index.js';
import { resourcesAtNode } from '../../src/systems/spatial/resources.js';
import { CADAVER_ATOMIC, MEAT, TEST_HUT, VIKING } from './resource-footprint/content.js';
import { ctxOf, mappedSim, placeResource, placeSettler, terrainOf } from './resource-footprint/support.js';

const IDLE = 0;
const AT = { hx: 4, hy: 2 };
const HUT_DOOR = { hx: 4, hy: 3 };

describe('a carcass under a building site', () => {
  it('leaves the site free, where a plain node with the same record holds the walls back', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    placeResource(sim, MEAT, CADAVER_ATOMIC, AT.hx, AT.hy);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, TEST_HUT, VIKING, AT.hx, AT.hy)).toBe(false);

    const hunted = mappedSim();
    const hunter = placeSettler(hunted, IDLE, 0, 0);
    placeCarcass(hunted.world, hunted.content, AT.hx, AT.hy, {
      resource: { goodType: MEAT, remaining: 2, harvestAtomic: CADAVER_ATOMIC },
      layers: [],
      killedBy: hunter,
    });
    expect(
      canPlaceBuilding(hunted.world, ctxOf(hunted), terrainOf(hunted), TEST_HUT, VIKING, AT.hx, AT.hy),
    ).toBe(true);
  });

  it('is pushed off the walls onto free ground, keeping its yield and its hunter', () => {
    const sim = mappedSim();
    const hunter = placeSettler(sim, IDLE, 0, 0);
    const layer = { goodType: MEAT, amount: 1, harvestAtomic: CADAVER_ATOMIC };
    const carcass = placeCarcass(sim.world, sim.content, AT.hx, AT.hy, {
      resource: { goodType: MEAT, remaining: 2, harvestAtomic: CADAVER_ATOMIC },
      layers: [layer],
      killedBy: hunter,
    });

    assembleBuilding(sim.world, ctxOf(sim), requiredHut(sim), {
      buildingType: TEST_HUT,
      tribe: VIKING,
      owner: undefined,
      missionId: undefined,
      x: AT.hx,
      y: AT.hy,
      underConstruction: true,
      fillStock: false,
    });

    expect(sim.world.isAlive(carcass)).toBe(false);
    expect(resourcesAtNode(sim.world, AT.hx, AT.hy)).toEqual([]);
    const moved = [...sim.world.query(KilledBy, Resource)];
    expect(moved).toHaveLength(1);
    const [body] = moved;
    if (body === undefined) throw new Error('carcass expected');
    const p = sim.world.get(body, Position);
    const landing = nodeOfPosition(p.x, p.y);
    expect(landing).not.toEqual(AT);
    expect(landing).not.toEqual(HUT_DOOR);
    expect(sim.world.get(body, Resource).remaining).toBe(2);
    expect(sim.world.get(body, KilledBy).by).toBe(hunter);
    expect(sim.world.get(body, ResourceLayers).layers).toEqual([layer]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

function requiredHut(sim: ReturnType<typeof mappedSim>) {
  const hut = sim.content.buildings.find((b) => b.typeId === TEST_HUT);
  if (hut === undefined) throw new Error('fixture hut expected');
  return hut;
}
