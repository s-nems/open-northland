import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Health } from '../../../../src/components/index.js';
import { Simulation } from '../../../../src/index.js';
import { buildingBlockedCells, canPlaceBuilding } from '../../../../src/systems/index.js';
import { ctxOf, grassMap, HUT, placedBuilding, placementContent, terrainOf, VIKING } from './support.js';

/** One typeId, two civilizations: a saracen hut stands on a longer body three nodes further east and
 *  carries its own life pool, the way a saracen palace and a viking longhouse share a `typeId`. */
const SARACEN = 4;
const HUT_HITPOINTS = 3000;
const SARACEN_HUT_HITPOINTS = 5000;
const SARACEN_HUT_FOOTPRINT = {
  blocked: [0, 1, 2, 3, 4].map((dx) => ({ dx, dy: 0 })),
  familyBody: [0, 1, 2, 3, 4].map((dx) => ({ dx, dy: 0 })),
  reserved: [-1, 0, 1].flatMap((dy) => [-1, 0, 1, 2, 3, 4, 5].map((dx) => ({ dx, dy }))),
  door: { dx: -1, dy: 0 },
};

function tribeVariantSim(): Simulation {
  const base = placementContent();
  const content = parseContentSet({
    ...base,
    tribes: [...base.tribes, { ...base.tribes[0], typeId: SARACEN, id: 'saracen' }],
    buildings: base.buildings.map((b) =>
      b.typeId === HUT
        ? {
            ...b,
            hitpoints: HUT_HITPOINTS,
            tribeVariants: [
              { tribe: SARACEN, footprint: SARACEN_HUT_FOOTPRINT, hitpoints: SARACEN_HUT_HITPOINTS },
            ],
          }
        : b,
    ),
  });
  return new Simulation({ seed: 1, content, map: grassMap(16, 16) });
}

describe("a building type's per-tribe footprint and life pool", () => {
  it("places, blocks and reserves each tribe's own body", () => {
    const sim = tribeVariantSim();
    const terrain = terrainOf(sim);
    // Four nodes from the east edge the viking reserve (to dx 2) fits; the saracen one (to dx 5) runs off.
    const nearEdge = terrain.width - 4;
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, VIKING, nearEdge, 6)).toBe(true);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, SARACEN, nearEdge, 6)).toBe(false);

    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 2, y: 2, tribe: SARACEN });
    sim.step();
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect([2, 3, 4, 5, 6].every((hx) => blocked.has(terrain.nodeAt(hx, 2)))).toBe(true);
    expect(blocked.has(terrain.nodeAt(3, 3))).toBe(false); // the viking body's growth cell
    // The saracen reserve runs to x = 7, so a viking hut whose own reserve starts there is refused and one
    // a node further east is not.
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, VIKING, 8, 2)).toBe(false);
    expect(canPlaceBuilding(sim.world, ctxOf(sim), terrain, HUT, VIKING, 9, 2)).toBe(true);
  });

  it("answers the placement grid with each tribe's footprint, a paper waiving only the technology gate", () => {
    const sim = tribeVariantSim();
    const terrain = terrainOf(sim);
    const nearEdge = terrain.width - 4;
    const area = { minHx: nearEdge, minHy: 6, maxHx: nearEdge, maxHy: 6 };
    const accepts = (tribe: number, gated: boolean): number | undefined =>
      sim.placementAnswer(HUT, area, { tribe, gated })?.accepted[0];
    expect(accepts(VIKING, true)).toBe(1);
    expect(accepts(SARACEN, true)).toBe(0);
    expect(accepts(SARACEN, false)).toBe(0);
    expect(accepts(VIKING, false)).toBe(1);
  });

  it("gives each tribe's building its own hitpoints", () => {
    const sim = tribeVariantSim();
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 2, y: 2, tribe: SARACEN });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HUT, x: 2, y: 10, tribe: VIKING });
    sim.step();
    expect(sim.world.get(placedBuilding(sim, 0), Health).max).toBe(SARACEN_HUT_HITPOINTS);
    expect(sim.world.get(placedBuilding(sim, 1), Health).max).toBe(HUT_HITPOINTS);
  });
});

describe("a house record's own footprint", () => {
  const HALL = 'viking hall';

  function recordSim(): Simulation {
    const base = placementContent();
    const content = parseContentSet({
      ...base,
      buildings: base.buildings.map((b) =>
        b.typeId === HUT
          ? { ...b, recordFootprints: [{ tribe: VIKING, editName: HALL, footprint: SARACEN_HUT_FOOTPRINT }] }
          : b,
      ),
    });
    return new Simulation({ seed: 1, content, map: grassMap(16, 16) });
  }

  it("blocks the named record's body and keeps the default for a record without one", () => {
    const sim = recordSim();
    const terrain = terrainOf(sim);
    const place = (y: number, record: string): void =>
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: HUT,
        x: 2,
        y,
        tribe: VIKING,
        force: true,
        record,
      });
    place(2, HALL);
    place(10, 'viking hut');
    sim.step();
    expect(sim.world.get(placedBuilding(sim, 0), Building).record).toBe(HALL);
    expect(sim.world.get(placedBuilding(sim, 1), Building).record).toBeUndefined();
    const blocked = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect([2, 3, 4, 5, 6].every((hx) => blocked.has(terrain.nodeAt(hx, 2)))).toBe(true);
    expect(blocked.has(terrain.nodeAt(6, 10))).toBe(false); // the hall's east end, absent from the default
  });

  it("answers the placement grid with the named record's body", () => {
    const sim = recordSim();
    const terrain = terrainOf(sim);
    // Four nodes from the east edge the default hut's reserve fits and the longer hall's runs off.
    const nearEdge = terrain.width - 4;
    const area = { minHx: nearEdge, minHy: 6, maxHx: nearEdge, maxHy: 6 };
    const accepts = (record?: string): number | undefined =>
      sim.placementAnswer(HUT, area, { tribe: VIKING, record })?.accepted[0];
    expect(accepts()).toBe(1);
    expect(accepts(HALL)).toBe(0);
    expect(accepts('viking hut')).toBe(1);
  });
});
