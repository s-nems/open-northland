import { describe, expect, it } from 'vitest';
import {
  Equipment,
  type EquipmentSlot,
  MISC_EQUIP_SLOTS,
  ProductionBonus,
  Settler,
  Stockpile,
} from '../../../src/components/index.js';
import { ZERO } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import { accrueBonusOutput } from '../../../src/systems/economy/production/bonus-output.js';
import { wearStepOf } from '../../../src/systems/equipment/index.js';
import { experienceBonus, productionSystem, recipesByProductOf } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { CYCLE_TICKS, ctxOf, PLANK, sawmill, spawnSettler, WOOD } from './support.js';

// The worn tool's ADDITIVE per-cycle credit (a sum with the experience bonus fraction, never a
// product) + its one wear step per completed cycle. Fixture: tool_wooden 11 (+30%), tool_iron 12
// (+60%), both rated 100 cycles; carrier job 24.

const TOOL_WOODEN = 11;
const TOOL_IRON = 12;
const CARRIER = 24;
const CARPENTER_GENERAL_TRACK = 3;
const CARPENTER_XP_PER_BATCH = 100;

/** The tool's credit fraction, minted exactly as the effects read does (integer percent / 100). */
const toolFraction = (pct: number) => fx.div(fx.fromInt(pct), fx.fromInt(100));

function wearTool(sim: Simulation, e: Entity, goodType: number): void {
  sim.world.add(e, Equipment, {
    boots: null,
    tool: { goodType, degreeOfUse: fx.fromInt(0) },
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
}

/** One retired cycle, for driving accrueBonusOutput directly (the shape productionSystem passes). */
const doneCycle = () => [{ elapsed: CYCLE_TICKS, duration: CYCLE_TICKS, goodType: PLANK }];

describe('productionSystem credits a worn tool additively and wears it per cycle', () => {
  it('a fresh carpenter with an iron tool banks its own first-repeat bonus PLUS the tool credit', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    wearTool(sim, worker, TOOL_IRON);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // the base plank landed
    // The batch's own XP grant lands first (0 → 1 repeat), then the credit: curve(1) + 0.6 - a SUM,
    // not a product.
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(
      fx.add(experienceBonus(1), toolFraction(60)),
    );
    // And the tool wore one cycle's step.
    expect(sim.world.get(worker, Equipment).tool?.degreeOfUse).toBe(wearStepOf(ctxOf(sim), TOOL_IRON));
  });

  it('a trained carpenter with a wooden tool: curve(5) + 0.3 (the user example, 4 seeded repeats)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    sim.world.mut(worker, Settler).experience.set(CARPENTER_GENERAL_TRACK, 4 * CARPENTER_XP_PER_BATCH);
    wearTool(sim, worker, TOOL_WOODEN);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(
      fx.add(experienceBonus(5), toolFraction(30)),
    );
  });

  it('two iron-tool cycles flush one whole bonus plank, keeping the exact 0.2 remainder', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, []);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    const ctx = ctxOf(sim);
    wearTool(sim, worker, TOOL_IRON);
    const recipes = recipesByProductOf(sim.world, ctx, mill);
    const staffed = { kind: 'staffed', operators: [worker] } as const;
    accrueBonusOutput(sim.world, ctx, mill, doneCycle(), staffed, recipes);
    accrueBonusOutput(sim.world, ctx, mill, doneCycle(), staffed, recipes);
    // A fresh worker earns no XP through the direct call (the grant is productionSystem's), so the
    // credit is purely the tool's: 0.6 + 0.6 = one whole plank + the truncation-exact 0.2.
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(
      fx.sub(fx.add(toolFraction(60), toolFraction(60)), ONE),
    );
  });

  it('the 100th cycle breaks the tool: the slot clears and later cycles credit nothing', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, []);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    const ctx = ctxOf(sim);
    wearTool(sim, worker, TOOL_WOODEN);
    const recipes = recipesByProductOf(sim.world, ctx, mill);
    const staffed = { kind: 'staffed', operators: [worker] } as const;
    for (let i = 0; i < 99; i++) accrueBonusOutput(sim.world, ctx, mill, doneCycle(), staffed, recipes);
    expect(sim.world.get(worker, Equipment).tool).not.toBeNull(); // one rated cycle left
    const before = sim.world.get(mill, ProductionBonus).remainders.get(PLANK) ?? ZERO;
    accrueBonusOutput(sim.world, ctx, mill, doneCycle(), staffed, recipes);
    expect(sim.world.get(worker, Equipment).tool).toBeNull(); // broke on its 100th cycle
    const banked = sim.world.tryGet(mill, ProductionBonus)?.remainders.get(PLANK);
    // The breaking cycle is still a cycle the tool worked: a tool rated for 100 uses credits 100 of
    // them, not 99 (crediting after the wear step would read the already-cleared slot and bank
    // nothing). 99 credits of 0.3 leave 0.699 banked, so this hundredth one flushes no whole unit.
    expect(banked).toBe(fx.add(before, toolFraction(30)));
    accrueBonusOutput(sim.world, ctx, mill, doneCycle(), staffed, recipes);
    expect(sim.world.tryGet(mill, ProductionBonus)?.remainders.get(PLANK)).toBe(banked); // no tool, no credit
  });

  it('a carrier operator neither credits nor wears its tool (mirrors the XP exclusion)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill } = sawmill(sim, [], false);
    const ctx = ctxOf(sim);
    const carrier = spawnSettler(sim, CARRIER, 0, 0);
    wearTool(sim, carrier, TOOL_IRON);
    const recipes = recipesByProductOf(sim.world, ctx, mill);
    accrueBonusOutput(sim.world, ctx, mill, doneCycle(), { kind: 'staffed', operators: [carrier] }, recipes);
    expect(sim.world.has(mill, ProductionBonus)).toBe(false); // hauling is not crafting - no credit
    expect(sim.world.get(carrier, Equipment).tool).toEqual({
      goodType: TOOL_IRON,
      degreeOfUse: fx.fromInt(0), // and the tool did not wear
    });
  });
});
