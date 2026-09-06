import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Settler } from '../../src/components/index.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { needBar, productionSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { CARPENTER, CYCLE_TICKS, ctxOf, PLANK, sawmill, WOOD } from './production-system/support.js';

/** The forge clip's `event <at> 4 <delta>`, the religion the maker spends on one item - the shape every
 *  weapon and armour `..._produce_*` clip carries, where the plain rows spend 1500 and the heavy ones 3000. */
const FORGE_ATOMIC = 69;
const FORGE_PIETY_UNITS = -1500;

// Religion (piety) is spent only on forging a weapon or piece of armor. The fixture sawmill turns wood
// into plank; declaring PLANK a weapon good (a WeaponType with `goodType: PLANK`) and binding the carpenter
// a forge clip makes the sawmill stand in for a smithy on the shared production fixture.
function contentWithMilitaryPlank(pietyUnits = FORGE_PIETY_UNITS) {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: base.goods.map((g) => (g.typeId === PLANK ? { ...g, atomics: { produce: FORGE_ATOMIC } } : g)),
    weapons: [...base.weapons, { typeId: 99, id: 'test_forged_plank', tribeType: 1, goodType: PLANK }],
    tribes: base.tribes.map((t) =>
      t.typeId === 1
        ? {
            ...t,
            atomicBindings: [
              ...t.atomicBindings,
              { jobType: CARPENTER, atomicId: FORGE_ATOMIC, animation: 'viking_forge' },
            ],
          }
        : t,
    ),
    atomicAnimations: [
      ...base.atomicAnimations,
      {
        id: 'viking_forge',
        name: 'viking_forge',
        length: 4,
        events: [{ at: 2, type: 4, value: pietyUnits }],
      },
    ],
  });
}

describe('productionSystem - forging a military good charges the smith piety', () => {
  it('raises the operator piety by what its own forge clip spends per completed cycle', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    sim.world.mut(worker, Settler).piety = fx.fromInt(0);

    // One full cycle to completion (CYCLE_TICKS-th advance deposits the output on tick CYCLE_TICKS+1).
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).piety).toBe(needBar(-FORGE_PIETY_UNITS));
  });

  it('leaves piety untouched for a non-military output (a plain plank)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    sim.world.mut(worker, Settler).piety = fx.fromInt(0);

    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).piety).toBe(fx.fromInt(0));
  });

  it('clamps piety at ONE across many forged cycles', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 40]]); // 40 cycles × 10% would overflow without the clamp
    if (worker === null) throw new Error('sawmill worker missing');
    sim.world.mut(worker, Settler).piety = fx.fromInt(0);

    for (let t = 0; t < CYCLE_TICKS * 40 + 5; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).piety).toBe(ONE);
  });

  it('spends what the heavier item costs when its clip says so', () => {
    const HEAVY_PIETY_UNITS = -3000;
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank(HEAVY_PIETY_UNITS) });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    sim.world.mut(worker, Settler).piety = fx.fromInt(0);

    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(worker, Settler).piety).toBe(needBar(-HEAVY_PIETY_UNITS));
  });
});
