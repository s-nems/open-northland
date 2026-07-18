import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Position, Stockpile, UnderConstruction, Upgrading } from '../../src/components/index.js';
import { fx, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { buildingBlockedCells, constructionSystem } from '../../src/systems/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { HUT, mappedSim, terrainOf, VIKING } from './building-placement/support.js';

/** The HUT's anchor in every placement fixture — body (5,5)+(6,5), door (4,5). */
const ANCHOR = { x: 5, y: 5 };

/**
 * The building walk-block memo (building-blocked-cache.ts): a call burst between two building
 * mutations shares ONE build, and every mutation seam that can change the cell set — membership
 * (add/remove/destroy) and the home tier upgrade's IN-PLACE `buildingType` swap (which moves only the
 * VALUE generation, via `touchComponent(Building)`) — invalidates it. The in-place seam is the
 * regression the naive `componentGeneration(Building)`-only key would miss.
 */
describe('buildingBlockedCells memo', () => {
  it('a burst of callers between two building mutations shares one cached set', () => {
    const sim = mappedSim();
    sim.enqueue({ kind: 'placeBuilding', buildingType: HUT, x: ANCHOR.x, y: ANCHOR.y, tribe: VIKING });
    sim.step();
    const first = buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    expect(first.size).toBeGreaterThan(0);
    // Identity, not equality: the burst's later calls must reuse the same build.
    expect(buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim))).toBe(first);
  });

  it('a building appearing or disappearing invalidates the memo', () => {
    const sim = mappedSim();
    const terrain = terrainOf(sim);
    const before = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(before.size).toBe(0);

    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(ANCHOR.x, ANCHOR.y));
    sim.world.add(hut, Building, { buildingType: HUT, tribe: VIKING, built: ONE, level: 0 });
    const placed = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(placed.has(terrain.nodeAt(ANCHOR.x, ANCHOR.y))).toBe(true);

    sim.world.destroy(hut);
    expect(buildingBlockedCells(sim.world, ctxOf(sim), terrain).size).toBe(0);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('a home tier upgrade — the in-place buildingType swap — invalidates the memo', () => {
    const { sim, home, growth } = twoTierHome();
    const terrain = terrainOf(sim);
    const before = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(before.has(growth)).toBe(false); // level 0: the growth cell is still open ground

    constructionSystem(sim.world, ctxOf(sim)); // materials present — upgrades in place
    expect(sim.world.get(home, Building).level).toBe(1);
    const after = buildingBlockedCells(sim.world, ctxOf(sim), terrain);
    expect(after).not.toBe(before);
    expect(after.has(growth)).toBe(true); // the larger tier's wall is picked up
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('the verifier flags an in-place Building write that skipped touchComponent', () => {
    const { sim, home } = twoTierHome();
    buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    sim.world.get(home, Building).buildingType = HOME_L; // raw store write — no value-generation bump
    expect(sim.world.verifyCaches().join('\n')).toContain('buildingBlockedCells');

    sim.world.touchComponent(Building); // the bump the writer owed — the next read rebuilds
    buildingBlockedCells(sim.world, ctxOf(sim), terrainOf(sim));
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});

const HOME_S = 20; // 1-node body
const HOME_L = 21; // grows one node east
const STONE = 1;

/** A level-0 home re-opened as an UPGRADE SITE (the command-driven model: `UnderConstruction` +
 *  `Upgrading` beside the Building) with the hammering done and the next tier's material delivered —
 *  one `constructionSystem` run finishes the upgrade in place. `growth` is the node only the larger
 *  tier walls off. */
function twoTierHome() {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
    ],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME_S,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
        upgradeTarget: HOME_L,
        footprint: { blocked: [{ dx: 0, dy: 0 }] },
      },
      {
        typeId: HOME_L,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 2,
        construction: [{ goodType: STONE, amount: 1 }],
        footprint: {
          blocked: [
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
          ],
        },
      },
    ],
  });
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(16, 16) });
  const home = sim.world.create();
  sim.world.add(home, Position, positionOfNode(5, 5));
  sim.world.add(home, Building, { buildingType: HOME_S, tribe: VIKING, built: fx.fromInt(0), level: 0 });
  // The live stockpile is the site's build hold, holding the target tier's delivered bill.
  sim.world.add(home, Stockpile, { amounts: new Map<number, number>([[STONE, 1]]) });
  sim.world.add(home, UnderConstruction, { labor: ONE }); // hammering complete — only materials gate
  sim.world.add(home, Upgrading, { savedStock: new Map<number, number>() });
  return { sim, home, growth: terrainOf(sim).nodeAt(6, 5) };
}
