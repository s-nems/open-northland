import { describe, expect, it } from 'vitest';
import { Owner, Position, Stockpile, setStockAmount } from '../../src/components/index.js';
import { GENERATION_JOURNAL_LIMIT } from '../../src/ecs/generation-journal.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { GrantedStock } from '../../src/systems/settlers/planner/granted-stock.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/** Fixture goods: 8 = shoes, 13 = mead. */
const SHOES = 8;
const MEAD = 13;
const HUMAN_PLAYER = 0;
const RIVAL_PLAYER = 1;

function pileAt(sim: Simulation, x: number, goodType: number, amount: number, player?: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  sim.world.add(e, Stockpile, { amounts: new Map([[goodType, amount]]) });
  if (player !== undefined) sim.world.add(e, Owner, { player });
  return e;
}

/** The units of `goodType` `player` may draw on, read through the ledger's only question. */
function unitsFor(sim: Simulation, player: number, goodType: number): number {
  const stock = GrantedStock.of(sim.world, ctxOf(sim));
  let units = 0;
  while (stock.exceeds(player, goodType, units)) units++;
  return units;
}

describe('GrantedStock - the assistant grant budget kept across ticks', () => {
  it("counts a player's own stores and every unowned pile, never a rival's", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
    pileAt(sim, 2, SHOES, 2, HUMAN_PLAYER);
    pileAt(sim, 4, SHOES, 3);
    pileAt(sim, 6, SHOES, 5, RIVAL_PLAYER);

    expect(unitsFor(sim, HUMAN_PLAYER, SHOES)).toBe(5);
    expect(unitsFor(sim, RIVAL_PLAYER, SHOES)).toBe(8);
    expect(unitsFor(sim, HUMAN_PLAYER, MEAD)).toBe(0);
  });

  it('follows stock writes, new and destroyed piles and an owner change without drifting', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
    const own = pileAt(sim, 2, SHOES, 2, HUMAN_PLAYER);
    const loose = pileAt(sim, 4, SHOES, 3);
    expect(unitsFor(sim, HUMAN_PLAYER, SHOES)).toBe(5);

    setStockAmount(sim.world, own, SHOES, 4);
    setStockAmount(sim.world, own, MEAD, 1);
    expect(unitsFor(sim, HUMAN_PLAYER, SHOES)).toBe(7);
    expect(unitsFor(sim, HUMAN_PLAYER, MEAD)).toBe(1);

    sim.world.destroy(loose);
    pileAt(sim, 8, SHOES, 6, RIVAL_PLAYER);
    expect(unitsFor(sim, HUMAN_PLAYER, SHOES)).toBe(4);

    sim.world.add(own, Owner, { player: RIVAL_PLAYER });
    expect(unitsFor(sim, HUMAN_PLAYER, SHOES)).toBe(0);
    expect(unitsFor(sim, RIVAL_PLAYER, SHOES)).toBe(10);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('rebuilds when more writes landed than the journal retains', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
    const own = pileAt(sim, 2, SHOES, 1, HUMAN_PLAYER);
    expect(unitsFor(sim, HUMAN_PLAYER, SHOES)).toBe(1);

    for (let amount = 0; amount <= GENERATION_JOURNAL_LIMIT; amount++)
      setStockAmount(sim.world, own, SHOES, amount);

    expect(unitsFor(sim, HUMAN_PLAYER, SHOES)).toBe(GENERATION_JOURNAL_LIMIT);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
