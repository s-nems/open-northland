import { describe, expect, it } from 'vitest';
import {
  Equipment,
  type EquipmentSlot,
  MISC_EQUIP_SLOTS,
  ProductionBonus,
  SettlerProgress,
  Stockpile,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, Simulation } from '../../../src/index.js';
import {
  accrueBonusOutput,
  accrueDepositBonus,
} from '../../../src/systems/economy/production/bonus-output.js';
import { wearStepOf } from '../../../src/systems/equipment/index.js';
import {
  EXPERIENCE_XP_PER_POINT,
  experienceBonusTenths,
  experiencePercent,
  productionSystem,
  recipesByProductOf,
  toolBonusTenths,
} from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { CYCLE_TICKS, ctxOf, PLANK, sawmill, spawnSettler, WOOD } from './support.js';

// The worn tool's ADDITIVE per-cycle credit (a sum with the experience tenths, never a product) + its
// one wear step per completed cycle. Fixture: tool_wooden 11 (+20%, 2 tenths), tool_iron 12 (+70%,
// 7 tenths), both rated 100 cycles; carrier job 24.

const TOOL_WOODEN = 11;
const TOOL_IRON = 12;
const CARRIER = 24;
const CARPENTER_PLANK_TRACK = 4;
const PLANK_XP_PER_BATCH = 7;
/** Curve points the seeded worker stands on: 51 percent, so the tenths read as a sum, not a product. */
const FIVE_POINTS = 5;

const WOODEN_TENTHS = toolBonusTenths(20);
const IRON_TENTHS = toolBonusTenths(70);

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
  it('a fresh carpenter with an iron tool banks the tool credit alone (no points yet)', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    wearTool(sim, worker, TOOL_IRON);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1); // the base plank landed
    // The batch's own XP grant lands first (7 raw XP: still 0 points), then the credit: the tool's 7
    // tenths and nothing from the curve.
    expect(IRON_TENTHS).toBe(7);
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(IRON_TENTHS);
    // And the tool wore one cycle's step.
    expect(sim.world.get(worker, Equipment).tool?.degreeOfUse).toBe(wearStepOf(ctxOf(sim), TOOL_IRON));
  });

  it('a trained carpenter with a wooden tool: the curve at 5 points plus the tool, a SUM', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, [[WOOD, 1]]);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    sim.world
      .mut(worker, SettlerProgress)
      .experience.set(CARPENTER_PLANK_TRACK, FIVE_POINTS * EXPERIENCE_XP_PER_POINT - PLANK_XP_PER_BATCH);
    wearTool(sim, worker, TOOL_WOODEN);
    for (let t = 0; t <= CYCLE_TICKS; t++) productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(
      experienceBonusTenths(experiencePercent(FIVE_POINTS)) + WOODEN_TENTHS,
    );
    expect(experienceBonusTenths(experiencePercent(FIVE_POINTS)) + WOODEN_TENTHS).toBe(9);
  });

  it('two iron-tool cycles flush one whole bonus plank, keeping the four tenths', () => {
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
    // credit is purely the tool's: 7 + 7 tenths = one whole plank + 4 tenths.
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(4);
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
    // 99 credits of 2 tenths: 19 planks shelved, 8 tenths banked.
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(19);
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(8);
    accrueBonusOutput(sim.world, ctx, mill, doneCycle(), staffed, recipes);
    expect(sim.world.get(worker, Equipment).tool).toBeNull(); // broke on its 100th cycle
    // The breaking cycle is still a cycle the tool worked: a tool rated for 100 uses credits 100 of
    // them, not 99 (crediting after the wear step would read the already-cleared slot and bank
    // nothing). Its 2 tenths complete the twentieth plank.
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20);
    expect(sim.world.has(mill, ProductionBonus)).toBe(false);
    accrueBonusOutput(sim.world, ctx, mill, doneCycle(), staffed, recipes);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(20); // no tool, no credit
    expect(sim.world.has(mill, ProductionBonus)).toBe(false);
  });

  it('a slaughter deposit banks the same tenths as a cycle, without wearing the tool', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const { mill, worker } = sawmill(sim, []);
    if (worker === null) throw new Error('staffed sawmill should have a worker');
    const ctx = ctxOf(sim);
    sim.world
      .mut(worker, SettlerProgress)
      .experience.set(CARPENTER_PLANK_TRACK, FIVE_POINTS * EXPERIENCE_XP_PER_POINT);
    wearTool(sim, worker, TOOL_IRON);
    accrueDepositBonus(sim.world, ctx, mill, worker, PLANK);
    // 7 tenths from the curve plus the iron tool's 7: one whole plank shelved, 4 tenths banked.
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(1);
    expect(sim.world.get(mill, ProductionBonus).remainders.get(PLANK)).toBe(4);
    expect(sim.world.get(worker, Equipment).tool?.degreeOfUse).toBe(fx.fromInt(0)); // no wear
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
