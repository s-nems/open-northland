import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Owner,
  Position,
  Stockpile,
  setStockAmount,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { reapEmptyLoosePile } from '../../../src/systems/settlers/atomics/effects/goods/piles.js';
import { collectTargets } from '../../../src/systems/settlers/targets/index.js';
import { settlementGround } from '../../../src/systems/trade/settlement-ground.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassCellMap as grassMap } from '../../fixtures/terrain.js';

/** A settlement stop's ground read, held across plans, answers as a fresh read would after any change. */

const VIKING = 1;
const HUMAN = 0;
const TRADER = 25;
const WOOD = 1;
const HEADQUARTERS = 1;
const MAP_W = 30;
const MAP_H = 3;
const ANCHOR_X = 1;
const PILE_X = 4;
const LATER_PILE_X = 12;
const GROUND_ROW = 2;
const PILE_WOOD = 3;

function houseAt(sim: Simulation, x: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function pileAt(sim: Simulation, x: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(GROUND_ROW) });
  sim.world.add(e, Stockpile, { amounts: new Map([[WOOD, PILE_WOOD]]) });
  return e;
}

describe("a settlement stop's ground", () => {
  it('follows piles laid, emptied and taken up between reads', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(MAP_W, MAP_H) });
    const anchor = houseAt(sim, ANCHOR_X);
    const first = pileAt(sim, PILE_X);
    const trader = sim.world.create();
    sim.world.add(trader, Position, { x: fx.fromInt(ANCHOR_X), y: fx.fromInt(1) });
    addPerson(sim.world, trader, {
      tribe: VIKING,
      jobType: TRADER,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(trader, Owner, { player: HUMAN });
    sim.step();
    const read = () => {
      const ctx = ctxOf(sim);
      const terrain = ctx.terrain;
      if (terrain === undefined) throw new Error('mapless sim');
      const targets = collectTargets(sim.world, ctx, terrain);
      return settlementGround(sim.world, ctx, terrain, trader, anchor, WOOD, (good) =>
        targets.bands.holding(good),
      );
    };

    expect(read().piles).toEqual([first]);
    expect(read().units()).toBe(PILE_WOOD);
    const later = pileAt(sim, LATER_PILE_X);
    expect(read().piles).toEqual([first, later]);
    setStockAmount(sim.world, first, WOOD, 1);
    expect(read().units()).toBe(1 + PILE_WOOD);
    setStockAmount(sim.world, first, WOOD, 0);
    reapEmptyLoosePile(sim.world, first);
    expect(read().piles).toEqual([later]);
    expect(read().units()).toBe(PILE_WOOD);
  });
});
