import { describe, expect, it } from 'vitest';
import { Owner, Stockpile, SupplyRun, UnderConstruction } from '../../src/components/index.js';
import { fx, Simulation } from '../../src/index.js';
import { MAX_DIAGNOSTIC_STORES } from '../../src/systems/readviews/construction-supply.js';
import { dropGroundPile } from '../../src/systems/settlers/atomics/effects/goods/piles.js';
import { grassCellMap } from '../fixtures/terrain.js';
import {
  builderAt,
  builtBuildingAt,
  constructionContent,
  grassMap,
  HEADQUARTERS,
  HOUSE,
  STONE,
  siteAt,
  WOOD,
} from './construction-system/support.js';

const LOCAL = 0;
const RIVAL = 1;
const ROW = 2;
const SITE_X = 8;
/** Past a builder's walk range from the site's door, with no signpost to stretch it. */
const BEYOND_REACH_X = 60;

describe('constructionSupply', () => {
  it('lists each lacking line with what is on site, on its way and held by the side', () => {
    const sim = new Simulation({ seed: 1, content: constructionContent(), map: grassMap(12, 4) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.add(site, Owner, { player: LOCAL });
    sim.world.mut(site, Stockpile).amounts.set(STONE, 1);
    const store = builtBuildingAt(sim, HEADQUARTERS, 0, 1, [[STONE, 3]]);
    sim.world.add(store, Owner, { player: LOCAL });

    expect(sim.constructionSupply(site)).toEqual({
      kind: 'short',
      shortfalls: [
        { goodType: STONE, required: 2, delivered: 1, inbound: 0, held: true },
        { goodType: WOOD, required: 1, delivered: 0, inbound: 0, held: false },
      ],
    });
  });

  it("counts a rival's store as holding nothing, and a load on its way toward the line", () => {
    const sim = new Simulation({ seed: 2, content: constructionContent(), map: grassMap(12, 4) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.add(site, Owner, { player: LOCAL });
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    const rivalStore = builtBuildingAt(sim, HEADQUARTERS, 0, 1, [[WOOD, 3]]);
    sim.world.add(rivalStore, Owner, { player: RIVAL });
    expect(sim.constructionSupply(site)).toEqual({
      kind: 'short',
      shortfalls: [{ goodType: WOOD, required: 1, delivered: 0, inbound: 0, held: false }],
    });

    const runner = builderAt(sim, 3, 2);
    sim.world.add(runner, SupplyRun, { site, goodType: WOOD, amount: 1 });
    expect(sim.constructionSupply(site)).toEqual({ kind: 'covered' });
  });

  it("counts a neutral pile in the site's reach as holding, and no number beyond it", () => {
    const sim = new Simulation({ seed: 4, content: constructionContent(), map: grassCellMap(128, 8) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const site = siteAt(sim, HOUSE, SITE_X, ROW);
    sim.world.add(site, Owner, { player: LOCAL });
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    const piles = MAX_DIAGNOSTIC_STORES + 2;
    for (let i = 0; i < piles; i++) {
      dropGroundPile(
        sim.world,
        fx.fromInt(BEYOND_REACH_X + (i % 24)),
        fx.fromInt(1 + Math.floor(i / 24)),
        WOOD,
        1,
      );
    }
    const rivalStore = builtBuildingAt(sim, HEADQUARTERS, SITE_X + 4, ROW, [[WOOD, 3]]);
    sim.world.add(rivalStore, Owner, { player: RIVAL });
    const woodLine = (held: boolean) => ({
      kind: 'short',
      shortfalls: [{ goodType: WOOD, required: 1, delivered: 0, inbound: 0, held }],
    });
    expect(sim.constructionSupply(site)).toEqual(woodLine(false));

    dropGroundPile(sim.world, fx.fromInt(SITE_X - 3), fx.fromInt(ROW), WOOD, 1);
    expect(sim.constructionSupply(site)).toEqual(woodLine(true));
  });

  it('answers covered for a site holding its bill, and nothing for anything but a building site', () => {
    const sim = new Simulation({ seed: 3, content: constructionContent(), map: grassMap(12, 4) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    sim.world.mut(site, Stockpile).amounts.set(WOOD, 1);
    expect(sim.constructionSupply(site)).toEqual({ kind: 'covered' });

    sim.world.remove(site, UnderConstruction);
    expect(sim.constructionSupply(site)).toBeUndefined();
    expect(sim.constructionSupply(builderAt(sim, 2, 2))).toBeUndefined();
  });
});
