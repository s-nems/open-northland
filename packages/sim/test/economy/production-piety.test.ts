import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Settler } from '../../src/components/index.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { PIETY_PER_MILITARY_CYCLE, productionSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { CYCLE_TICKS, ctxOf, PLANK, sawmill, WOOD } from './production-system/support.js';

// Religion (piety) climbs only when a smith forges a weapon or piece of armor. The fixture sawmill turns
// wood into plank; declaring PLANK a weapon good (a WeaponType with `goodType: PLANK`) makes the sawmill
// stand in for a smithy so the mechanic can be exercised on the shared production fixture.
function contentWithMilitaryPlank() {
  const base = testContent();
  return parseContentSet({
    ...base,
    weapons: [...base.weapons, { typeId: 99, id: 'test_forged_plank', tribeType: 1, goodType: PLANK }],
  });
}

describe('productionSystem — forging a military good charges the smith piety', () => {
  it('raises the operator piety by PIETY_PER_MILITARY_CYCLE per completed weapon/armor cycle', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    sim.world.get(worker, Settler).piety = fx.fromInt(0);

    // One full cycle to completion (CYCLE_TICKS-th advance deposits the output on tick CYCLE_TICKS+1).
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).piety).toBe(PIETY_PER_MILITARY_CYCLE);
  });

  it('leaves piety untouched for a non-military output (a plain plank)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    sim.world.get(worker, Settler).piety = fx.fromInt(0);

    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).piety).toBe(fx.fromInt(0));
  });

  it('clamps piety at ONE across many forged cycles', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 40]]); // 40 cycles × 10% would overflow without the clamp
    if (worker === null) throw new Error('sawmill worker missing');
    sim.world.get(worker, Settler).piety = fx.fromInt(0);

    for (let t = 0; t < CYCLE_TICKS * 40 + 5; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).piety).toBe(ONE);
  });
});
