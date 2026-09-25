import { describe, expect, it } from 'vitest';
import { cellAnchorNode, Simulation } from '../../../src/index.js';
import { collectTargets } from '../../../src/systems/settlers/targets/index.js';
import { BLOCKHOUSE, Building, blockhouseAt, ctxOf, FARM, grassMap, wallsContent } from './support.js';

/** The blockhouse's 2x2 reserved body; the fixture farm reserves only its anchor. */
const BLOCKHOUSE_ZONE_NODES = 4;
const ANCHOR_ONLY_ZONE_NODES = 1;
const TILE = { x: 4, y: 3 };

describe('field zones kept across ticks', () => {
  it('follow a building raised, retyped and razed', () => {
    const sim = new Simulation({ seed: 1, content: wallsContent(), map: grassMap(12, 12) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('fixture map missing');
    const zones = () => new Set(collectTargets(sim.world, ctxOf(sim), terrain).fieldZones);
    const anchor = cellAnchorNode(TILE.x, TILE.y);
    const anchorNode = terrain.nodeAt(anchor.hx, anchor.hy);
    const empty = zones();
    expect(empty.has(anchorNode)).toBe(false);

    blockhouseAt(sim, TILE.x, TILE.y);
    const raised = zones();
    expect(raised.size).toBe(empty.size + BLOCKHOUSE_ZONE_NODES);
    expect(raised.has(anchorNode)).toBe(true);

    const house = sim.world
      .canonicalQuery(Building)
      .find((e) => sim.world.get(e, Building).buildingType === BLOCKHOUSE);
    if (house === undefined) throw new Error('blockhouse not raised');
    sim.world.mut(house, Building).buildingType = FARM;
    expect(zones().size).toBe(empty.size + ANCHOR_ONLY_ZONE_NODES);

    sim.world.destroy(house);
    expect(zones()).toEqual(empty);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
