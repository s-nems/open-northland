import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AtomicClock,
  addCurrentAtomic,
  atomicElapsed,
  CurrentAtomic,
  Equipment,
  IdleStand,
  JobAssignment,
  MISC_EQUIP_SLOTS,
  MoveGoal,
  Position,
  Production,
  ProductionBonus,
  Resting,
  SettlerProgress,
  Stockpile,
  setNeedsEnabled,
} from '../../../../src/components/index.js';
import { exportSaveGame, fx, ONE, restoreSimulation, Simulation } from '../../../../src/index.js';
import { atomicSystem, needBar, plannerSystem, productionSystem } from '../../../../src/systems/index.js';
import { startCraftAtomic } from '../../../../src/systems/settlers/drives/economy/workshop/craft.js';
import { testContent } from '../../../fixtures/content.js';
import { nextTickCtxOf } from '../../../fixtures/context.js';
import { needsOf, setNeeds } from '../../../fixtures/settler.js';
import { buildingAt, grassMap, HEADQUARTERS } from './producer-supply/support.js';
import {
  CARPENTER,
  CYCLE_TICKS,
  ctxOf,
  PLANK,
  PLANK_GATE_EARNED,
  sawmill,
  spawnSettler,
  WOOD,
} from './system/support.js';

/** The forge clip's `event <at> 4 <delta>`, the religion the maker spends on one item - the shape every
 *  weapon and armour `..._produce_*` clip carries, where the plain rows spend 1500 and the heavy ones 3000. */
const FORGE_ATOMIC = 69;
const FORGE_PIETY_UNITS = -1500;
/** The forge clip's need events: authored at frame 2, fired on the batch's third tick. */
const FORGE_EVENT_FRAME = 2;
const FORGE_EVENT_TICK = FORGE_EVENT_FRAME + 1;

// Religion (piety) is spent only on forging a weapon or piece of armor. The fixture sawmill turns wood
// into plank; declaring PLANK a weapon good (a WeaponType with `goodType: PLANK`) and binding the carpenter
// a forge clip makes the sawmill stand in for a smithy on the shared production fixture.
function contentWithMilitaryPlank(pietyUnits = FORGE_PIETY_UNITS, eventFrame = FORGE_EVENT_FRAME) {
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
        events: [
          { at: eventFrame, type: 4, value: pietyUnits },
          { at: eventFrame, type: 1, value: -100 },
          { at: eventFrame, type: 2, value: -100 },
        ],
      },
    ],
  });
}

describe('productionSystem - forging a military good charges the smith piety', () => {
  it('raises the operator piety by what its own forge clip spends per completed cycle', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    setNeeds(sim, worker, { piety: fx.fromInt(0) });

    // One full cycle to completion (CYCLE_TICKS-th advance deposits the output on tick CYCLE_TICKS+1).
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(needBar(-FORGE_PIETY_UNITS));
  });

  it('leaves piety untouched for a non-military output (a plain plank)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    setNeeds(sim, worker, { piety: fx.fromInt(0) });

    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(fx.fromInt(0));
  });

  it('clamps piety at ONE across many forged cycles', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 40]]); // 40 cycles × 10% would overflow without the clamp
    if (worker === null) throw new Error('sawmill worker missing');
    setNeeds(sim, worker, { piety: fx.fromInt(0) });

    for (let t = 0; t < CYCLE_TICKS * 40 + 5; t++) productionSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(ONE);
  });

  it('spends what the heavier item costs when its clip says so', () => {
    const HEAVY_PIETY_UNITS = -3000;
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank(HEAVY_PIETY_UNITS) });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('sawmill worker missing');
    setNeeds(sim, worker, { piety: fx.fromInt(0) });

    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(needBar(-HEAVY_PIETY_UNITS));
  });
});

describe('production events share the batch clock with the displayed craft', () => {
  it('stops before reserving inputs at empty religion and finishes the last paid batch', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { mill, worker } = sawmill(sim, [[WOOD, 2]]);
    if (worker === null) throw new Error('missing maker');
    setNeeds(sim, worker, { piety: ONE });
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false);
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(2);
    setNeeds(sim, worker, { piety: needBar(9999) });
    for (let i = 0; i < 10; i++) productionSystem(sim.world, nextTickCtxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(ONE);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    expect(sim.world.get(mill, Stockpile).amounts.get(WOOD)).toBe(1);
    expect(sim.world.has(mill, Production)).toBe(false);
  });

  it('holds an unpaid batch through save/load and resumes after religion is restored', () => {
    const content = contentWithMilitaryPlank();
    const sim = new Simulation({ seed: 1, content });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('missing maker');
    productionSystem(sim.world, nextTickCtxOf(sim));
    productionSystem(sim.world, nextTickCtxOf(sim));
    setNeeds(sim, worker, { piety: ONE });
    for (let i = 0; i < 5; i++) productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(mill, Production).cycles[0]?.elapsed).toBe(1);
    const restored = restoreSimulation(exportSaveGame(sim), { content });
    setNeeds(restored, worker, { piety: needBar(5000) });
    for (let i = 0; i < 3; i++) productionSystem(restored.world, nextTickCtxOf(restored));
    expect(restored.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    expect(needsOf(restored, worker).piety).toBe(needBar(6500));
  });

  it.each([true, false])(
    'keeps an unpaid batch while free work continues (inputs stocked: %s)',
    (stocked) => {
      const base = contentWithMilitaryPlank();
      const freeGood = 3;
      const content = parseContentSet({
        ...base,
        buildings: base.buildings.map((b) =>
          b.typeId !== 2
            ? b
            : {
                ...b,
                stock: [...b.stock, { goodType: freeGood, capacity: 20, initial: 0 }],
                recipes: [
                  ...b.recipes,
                  {
                    inputs: [{ goodType: WOOD, amount: 1 }],
                    outputs: [{ goodType: freeGood, amount: 1 }],
                    ticks: 2,
                  },
                ],
              },
        ),
      });
      const sim = new Simulation({ seed: 1, content, map: grassMap(12, 12) });
      const { mill, worker } = sawmill(sim, [[WOOD, stocked ? 2 : 1]]);
      if (worker === null) throw new Error('missing maker');
      productionSystem(sim.world, nextTickCtxOf(sim));
      setNeeds(sim, worker, { piety: ONE });
      if (!stocked) {
        buildingAt(sim, HEADQUARTERS, 4, 0, [[WOOD, 1]]);
        plannerSystem(sim.world, ctxOf(sim));
        expect(sim.world.has(worker, MoveGoal)).toBe(true);
        for (let i = 0; i < 400 && (sim.world.get(mill, Stockpile).amounts.get(freeGood) ?? 0) === 0; i++)
          sim.step();
      } else for (let i = 0; i < 4; i++) productionSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.get(mill, Stockpile).amounts.get(freeGood)).toBe(1);
      expect(sim.world.get(mill, Production).cycles).toEqual([
        { goodType: PLANK, elapsed: 0, duration: 4, operator: worker },
      ]);
      sim.world.remove(worker, MoveGoal);
      sim.world.add(worker, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
      setNeeds(sim, worker, { piety: needBar(5000) });
      for (let i = 0; i < 4; i++) productionSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
      expect(sim.world.has(mill, Production)).toBe(false);
    },
  );

  it('finishes its own batch first, then takes over one its owner may no longer craft and keeps it', () => {
    const base = contentWithMilitaryPlank();
    const freeGood = 3;
    const freeGoodTicks = 2;
    const content = parseContentSet({
      ...base,
      buildings: base.buildings.map((b) =>
        b.typeId !== 2
          ? b
          : {
              ...b,
              workers: [{ jobType: CARPENTER, count: 2 }],
              stock: [...b.stock, { goodType: freeGood, capacity: 20, initial: 0 }],
              recipes: [
                ...b.recipes,
                {
                  inputs: [{ goodType: WOOD, amount: 1 }],
                  outputs: [{ goodType: freeGood, amount: 1 }],
                  ticks: freeGoodTicks,
                },
              ],
            },
      ),
    });
    const sim = new Simulation({ seed: 1, content, map: grassMap(12, 12) });
    const { mill, worker } = sawmill(sim, []);
    if (worker === null) throw new Error('missing maker');
    const empty = spawnSettler(sim, CARPENTER, 0, 0, PLANK_GATE_EARNED);
    sim.world.add(empty, JobAssignment, { workplace: mill });
    setNeeds(sim, empty, { piety: ONE });
    sim.world.add(mill, Production, {
      cycles: [
        { goodType: PLANK, elapsed: 0, duration: 4, operator: empty },
        { goodType: freeGood, elapsed: 0, duration: freeGoodTicks, operator: worker },
      ],
    });
    buildingAt(sim, HEADQUARTERS, 4, 0, [[WOOD, 2]]);
    const plankBatch = () => sim.world.get(mill, Production).cycles.find((c) => c.goodType === PLANK);

    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(plankBatch()).toEqual({ goodType: PLANK, elapsed: 0, duration: 4, operator: empty });
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(freeGood)).toBe(1);
    // The planner holds him at the batch left open rather than sending him out for wood.
    plannerSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(worker, MoveGoal)).toBe(false);
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(plankBatch()).toEqual({ goodType: PLANK, elapsed: 1, duration: 4, operator: worker });
    // Its old owner's religion back, the batch stays with the colleague now working it.
    setNeeds(sim, empty, { piety: needBar(5000) });
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(plankBatch()).toEqual({ goodType: PLANK, elapsed: 2, duration: 4, operator: worker });
  });

  it('leaves a batch its owner may not craft to wait when the free colleague has not earned the ware', () => {
    const base = contentWithMilitaryPlank();
    const content = parseContentSet({
      ...base,
      buildings: base.buildings.map((b) =>
        b.typeId === 2 ? { ...b, workers: [{ jobType: CARPENTER, count: 2 }] } : b,
      ),
    });
    const sim = new Simulation({ seed: 1, content, map: grassMap(12, 12) });
    const { mill } = sawmill(sim, [], false);
    const owner = spawnSettler(sim, CARPENTER, 0, 0, PLANK_GATE_EARNED);
    const novice = spawnSettler(sim, CARPENTER, 0, 0);
    for (const e of [owner, novice]) sim.world.add(e, JobAssignment, { workplace: mill });
    setNeeds(sim, owner, { piety: ONE });
    const batch = { goodType: PLANK, elapsed: 0, duration: 4, operator: owner };
    sim.world.add(mill, Production, { cycles: [{ ...batch }] });

    productionSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.get(mill, Production).cycles).toEqual([batch]);
  });

  it('credits the actual maker when a later batch finishes first', () => {
    const base = contentWithMilitaryPlank();
    const content = parseContentSet({
      ...base,
      buildings: base.buildings.map((b) =>
        b.typeId === 2 ? { ...b, workers: [{ jobType: CARPENTER, count: 2 }] } : b,
      ),
    });
    const sim = new Simulation({ seed: 1, content });
    const { mill, worker } = sawmill(sim, []);
    if (worker === null) throw new Error('missing maker');
    const second = spawnSettler(sim, CARPENTER, 0, 0, PLANK_GATE_EARNED);
    sim.world.add(second, JobAssignment, { workplace: mill });
    sim.world.add(mill, Production, {
      cycles: [
        { goodType: PLANK, elapsed: 0, duration: 4, operator: null },
        { goodType: PLANK, elapsed: 3, duration: 4, operator: null },
      ],
    });
    for (const maker of [worker, second])
      sim.world.add(maker, Equipment, {
        boots: null,
        tool: { goodType: 12, degreeOfUse: fx.fromInt(0) },
        weapon: null,
        armor: null,
        misc: new Array(MISC_EQUIP_SLOTS).fill(null),
      });
    const firstXp = [...sim.world.get(worker, SettlerProgress).experience];
    const secondXp = [...sim.world.get(second, SettlerProgress).experience];
    productionSystem(sim.world, nextTickCtxOf(sim));
    expect([...sim.world.get(worker, SettlerProgress).experience]).toEqual(firstXp);
    expect([...sim.world.get(second, SettlerProgress).experience]).not.toEqual(secondXp);
    expect(sim.world.get(mill, Production).cycles[0]?.elapsed).toBe(1);
    expect(sim.world.get(worker, Equipment).tool?.degreeOfUse).toBe(0);
    expect(sim.world.get(second, Equipment).tool?.degreeOfUse).toBeGreaterThan(0);
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(7);
  });

  it('refreshes a seated clip when replenishment changes its assigned batch between idle beats', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { mill, worker } = sawmill(sim, []);
    if (worker === null) throw new Error('missing maker');
    sim.world.add(mill, Production, {
      cycles: [
        { goodType: PLANK, elapsed: 0, duration: 8, operator: null },
        { goodType: PLANK, elapsed: 3, duration: 8, operator: null },
      ],
    });
    sim.world.add(worker, Resting, { at: mill });
    setNeeds(sim, worker, { piety: ONE });
    startCraftAtomic(sim.world, ctxOf(sim), worker, mill);
    expect(atomicElapsed(sim.world.get(worker, AtomicClock), 0)).toBe(3);
    sim.world.add(worker, IdleStand, { standing: false });
    setNeeds(sim, worker, { piety: needBar(5000) });
    const ctx = nextTickCtxOf(sim);
    atomicSystem(sim.world, ctx);
    productionSystem(sim.world, ctx);
    expect(sim.world.has(worker, IdleStand)).toBe(false);
    startCraftAtomic(sim.world, ctx, worker, mill);
    expect(atomicElapsed(sim.world.get(worker, AtomicClock), ctx.tick)).toBe(1);
  });

  it.each([0, FORGE_EVENT_FRAME])(
    'also stops an outdoor spending action at zero before its frame-%i cost lands, with its other effects',
    (eventFrame) => {
      const sim = new Simulation({
        seed: 1,
        content: contentWithMilitaryPlank(FORGE_PIETY_UNITS, eventFrame),
      });
      const worker = spawnSettler(sim, CARPENTER, 0, 0);
      setNeeds(sim, worker, { piety: ONE });
      addCurrentAtomic(sim.world, worker, {
        atomicId: FORGE_ATOMIC,
        duration: 4,
        effect: { kind: 'produce', recipeOutput: PLANK },
        targetEntity: null,
        targetTile: null,
      });
      atomicSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.has(worker, CurrentAtomic)).toBe(false);
      expect(needsOf(sim, worker).hunger).toBe(0);
    },
  );

  it.each([0, -1500])(
    'permits a cost %i with frozen needs and permits free work with an empty reserve',
    (cost) => {
      const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank(cost) });
      const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
      if (worker === null) throw new Error('missing maker');
      setNeeds(sim, worker, { piety: ONE });
      if (cost < 0) setNeedsEnabled(sim.world, false);
      for (let i = 0; i < 5; i++) productionSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    },
  );

  it.each([1500, 3000])(
    'charges %i on the authored frame only, across display replans and completion',
    (cost) => {
      const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank(-cost) });
      const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
      if (worker === null) throw new Error('missing maker');
      sim.world.add(worker, Resting, { at: mill });
      productionSystem(sim.world, nextTickCtxOf(sim));
      for (let tick = 1; tick <= 4; tick++) {
        const ctx = nextTickCtxOf(sim);
        startCraftAtomic(sim.world, ctx, worker, mill);
        atomicSystem(sim.world, ctx);
        productionSystem(sim.world, ctx);
        const paid = tick >= FORGE_EVENT_TICK;
        expect(needsOf(sim, worker).piety).toBe(paid ? needBar(cost) : 0);
        expect(needsOf(sim, worker).hunger).toBe(paid ? needBar(100) : 0);
        expect(needsOf(sim, worker).fatigue).toBe(paid ? needBar(50) : 0);
      }
      expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    },
  );

  it.each([FORGE_EVENT_TICK - 1, FORGE_EVENT_TICK])(
    'resumes after tick %i with another worker without replaying paid events, including a saved batch',
    (ticks) => {
      const content = contentWithMilitaryPlank();
      const sim = new Simulation({ seed: 1, content });
      const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
      if (worker === null) throw new Error('missing maker');
      productionSystem(sim.world, nextTickCtxOf(sim));
      for (let i = 0; i < ticks; i++) productionSystem(sim.world, nextTickCtxOf(sim));
      sim.world.remove(worker, JobAssignment);
      sim.world.mut(worker, Position).x = fx.fromInt(8);
      for (let i = 0; i < 3; i++) productionSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.get(mill, Production).cycles[0]?.elapsed).toBe(ticks);
      const replacement = spawnSettler(sim, CARPENTER, 0, 0);
      sim.world.add(replacement, JobAssignment, { workplace: mill });
      const restored = restoreSimulation(exportSaveGame(sim), { content });
      for (const run of [sim, restored]) {
        for (let i = ticks; i < 4; i++) productionSystem(run.world, nextTickCtxOf(run));
        expect(needsOf(run, worker).piety).toBe(ticks >= FORGE_EVENT_TICK ? needBar(1500) : 0);
        expect(needsOf(run, replacement).piety).toBe(ticks < FORGE_EVENT_TICK ? needBar(1500) : 0);
        expect(run.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
      }
    },
  );

  it('does not charge frozen needs while the batch continues', () => {
    const sim = new Simulation({ seed: 1, content: contentWithMilitaryPlank() });
    const { worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('missing maker');
    setNeedsEnabled(sim.world, false);
    for (let i = 0; i < 5; i++) productionSystem(sim.world, nextTickCtxOf(sim));
    expect(needsOf(sim, worker).piety).toBe(0);
  });
});
