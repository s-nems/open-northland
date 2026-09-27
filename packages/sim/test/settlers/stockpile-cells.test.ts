import { describe, expect, it } from 'vitest';
import { Building, Position, Stockpile } from '../../src/components/index.js';
import { GENERATION_JOURNAL_LIMIT } from '../../src/ecs/generation-journal.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { collectTargets } from '../../src/systems/settlers/targets/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

const WOOD = 1;
const HEADQUARTERS = 1;
const VIKING = 1;

function pileAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[WOOD, 1]]) });
  return e;
}

function fixture() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 8) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  const tick = () => collectTargets(sim.world, ctxOf(sim), terrain).stockpileCells;
  return { sim, tick };
}

describe('stockpileCells - the planner stockpile index kept across ticks', () => {
  it('follows piles that appear, move, lose their stock or die between passes', () => {
    const { sim, tick } = fixture();
    const piles = [pileAt(sim, 2, 1), pileAt(sim, 5, 3), pileAt(sim, 9, 6), pileAt(sim, 12, 2)];
    tick();
    const [first, second, third, fourth] = piles;
    if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
      throw new Error('fixture piles missing');
    }
    pileAt(sim, 7, 7);
    sim.world.add(second, Position, { x: fx.fromInt(14), y: fx.fromInt(5) }); // re-placed on a new node
    sim.world.remove(third, Stockpile);
    sim.world.destroy(fourth);
    sim.world.add(first, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
    tick();
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('rebuilds after a journal gap', () => {
    const { sim, tick } = fixture();
    const pile = pileAt(sim, 2, 1);
    tick();
    for (let i = 0; i <= GENERATION_JOURNAL_LIMIT; i++) {
      sim.world.add(pile, Position, { x: fx.fromInt(2 + (i % 10)), y: fx.fromInt(1) });
    }
    tick();
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('holds the stockpiles of the pass start while the pass drops a new pile', () => {
    const { sim, tick } = fixture();
    const index = tick();
    const late = pileAt(sim, 3, 3);
    const here = sim.terrain?.nodeAt(6, 6);
    if (here === undefined) throw new Error('fixture map missing');
    expect(index.nearest(here, (e) => (e === late ? { payload: null } : null))).toBeNull();
    tick();
    expect(index.nearest(here, (e) => (e === late ? { payload: null } : null))?.entity).toBe(late);
  });
});
