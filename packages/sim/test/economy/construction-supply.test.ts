import { describe, expect, it } from 'vitest';
import { Owner, Stockpile, SupplyRun, UnderConstruction } from '../../src/components/index.js';
import { fx, Simulation } from '../../src/index.js';
import { MAX_DIAGNOSTIC_STORES } from '../../src/systems/readviews/construction-supply.js';
import { dropGroundPile } from '../../src/systems/settlers/atomics/effects/goods/piles.js';
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

  it('counts no number of neutral piles as holding, and a rival store beyond the cap as nothing', () => {
    const sim = new Simulation({ seed: 4, content: constructionContent(), map: grassMap(48, 12) });
    const site = siteAt(sim, HOUSE, 6, 1);
    sim.world.add(site, Owner, { player: LOCAL });
    sim.world.mut(site, Stockpile).amounts.set(STONE, 2);
    const piles = MAX_DIAGNOSTIC_STORES + 2;
    for (let i = 0; i < piles; i++)
      dropGroundPile(sim.world, fx.fromInt(20 + (i % 24)), fx.fromInt(4 + Math.floor(i / 24)), WOOD, 1);
    const short = {
      kind: 'short',
      shortfalls: [{ goodType: WOOD, required: 1, delivered: 0, inbound: 0, held: false }],
    };
    expect(sim.constructionSupply(site)).toEqual(short);
    const rivalStore = builtBuildingAt(sim, HEADQUARTERS, 0, 1, [[WOOD, 3]]);
    sim.world.add(rivalStore, Owner, { player: RIVAL });
    expect(sim.constructionSupply(site)).toEqual(short);
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
