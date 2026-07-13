import { beforeEach, describe, expect, it } from 'vitest';
import { Production, Stockpile } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { productionSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { clearComponentStores } from '../../fixtures/stores.js';
import { CYCLE_TICKS, ctxOf, PLANK, sawmill, WOOD } from './support.js';

beforeEach(clearComponentStores);

describe('productionSystem — cycle lifecycle', () => {
  it('consumes the input at cycle start and produces the output on the duration-th tick', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [
      [WOOD, 3],
      [PLANK, 0],
    ]);

    // Tick 1: starts a cycle — input consumed immediately, no Production-advance yet (begins next tick).
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(2); // one wood reserved/consumed
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(0); // no output until completion
    expect(sim.world.has(mill, Production)).toBe(true);

    // Ticks 2..CYCLE_TICKS: the cycle advances (elapsed 1..CYCLE_TICKS-1) — still producing.
    for (let t = 2; t <= CYCLE_TICKS; t++) {
      productionSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(0); // no output mid-cycle
    }
    // Tick CYCLE_TICKS+1: the CYCLE_TICKS-th advance completes (elapsed reaches duration) — +1 plank,
    // Production removed; then — wood still available — a fresh cycle starts the same tick.
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(1); // 2nd cycle consumed another
    expect(sim.world.has(mill, Production)).toBe(true); // new cycle running
  });

  it('three input units yield exactly three outputs over three cycles (goods accounting)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [
      [WOOD, 3],
      [PLANK, 0],
    ]);
    // Run long enough for all three cycles to finish.
    for (let t = 0; t < CYCLE_TICKS * 3 + 2; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(0); // all consumed
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(3); // all produced
    expect(sim.world.has(mill, Production)).toBe(false); // idle: nothing left to produce
  });

  it('emits a goodProduced event for the output on completion', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [[WOOD, 1]]);
    let produced: { building: Entity; goodType: number; amount: number } | undefined;
    for (let t = 0; t <= CYCLE_TICKS; t++) {
      sim.events.clear();
      productionSystem(sim.world, ctxOf(sim));
      const evt = sim.events.current().find((e) => e.kind === 'goodProduced');
      if (evt !== undefined && evt.kind === 'goodProduced') produced = evt;
    }
    expect(produced).toMatchObject({ building: mill, goodType: PLANK, amount: 1 });
  });
});
