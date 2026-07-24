import { describe, expect, it } from 'vitest';
import { Equipment, type EquipmentSlot, MISC_EQUIP_SLOTS } from '../../src/components/index.js';
import { fx, ONE, ZERO } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { applyEquipWear, wearStepOf } from '../../src/systems/equipment/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

// The wear seam: a wearing item spends its content-rated `uses` in divCeil steps and breaks (slot
// clears) at ONE. Fixture goods: shoes 8 (6000 uses), tool_wooden 11 (100), mead 13 (2 sips),
// sword 9 (permanent - no uses).

const SHOES = 8;
const SWORD = 9;
const TOOL_WOODEN = 11;
const MEAD = 13;

function simWithWearer(): { sim: Simulation; e: Entity } {
  const sim = new Simulation({ seed: 1, content: testContent() });
  const e = sim.world.create();
  sim.world.add(e, Equipment, {
    boots: null,
    tool: null,
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
  return { sim, e };
}

describe('equipment wear', () => {
  it('mints divCeil wear steps so an item never outlives its rated uses', () => {
    const ctx = ctxOf(simWithWearer().sim);
    // 2 uses divide ONE exactly; 100 do not (655.36) - divCeil rounds up so the 100th use lands >= ONE.
    expect(wearStepOf(ctx, MEAD)).toBe(fx.divCeil(ONE, fx.fromInt(2)));
    expect(wearStepOf(ctx, TOOL_WOODEN)).toBe(fx.divCeil(ONE, fx.fromInt(100)));
    const toolStep = wearStepOf(ctx, TOOL_WOODEN);
    expect(toolStep * 99).toBeLessThan(ONE);
    expect(toolStep * 100).toBeGreaterThanOrEqual(ONE);
    // A permanent good (no wears/uses) mints no step.
    expect(wearStepOf(ctx, SWORD)).toBe(ZERO);
  });

  it('accrues wear on a direct slot and breaks the item at ONE', () => {
    const { sim, e } = simWithWearer();
    const ctx = ctxOf(sim);
    const eq = sim.world.get(e, Equipment);
    eq.boots = { goodType: SHOES, degreeOfUse: fx.fromInt(0) };
    const step = wearStepOf(ctx, SHOES);
    applyEquipWear(sim.world, e, 'boots', 0, step);
    expect(eq.boots).toEqual({ goodType: SHOES, degreeOfUse: step });
    eq.boots = { goodType: SHOES, degreeOfUse: fx.sub(ONE, step) }; // one use left on the rating
    applyEquipWear(sim.world, e, 'boots', 0, step);
    expect(eq.boots).toBeNull(); // the last rated use breaks the pair
  });

  it('replaces the misc array on wear and clears only the addressed slot at breakage', () => {
    const { sim, e } = simWithWearer();
    const ctx = ctxOf(sim);
    const eq = sim.world.get(e, Equipment);
    eq.misc = [
      { goodType: MEAD, degreeOfUse: fx.div(ONE, fx.fromInt(2)) }, // one sip left
      { goodType: MEAD, degreeOfUse: fx.fromInt(0) },
      null,
      null,
    ];
    const before = eq.misc;
    applyEquipWear(sim.world, e, 'misc', 0, wearStepOf(ctx, MEAD));
    expect(eq.misc).not.toBe(before); // replaced, never mutated in place
    expect(eq.misc[0]).toBeNull(); // the last sip emptied the bottle
    expect(eq.misc[1]).toEqual({ goodType: MEAD, degreeOfUse: fx.fromInt(0) }); // neighbour untouched
  });

  it('no-ops on an empty slot, a ZERO step, and an already-spent unit', () => {
    const { sim, e } = simWithWearer();
    const ctx = ctxOf(sim);
    const eq = sim.world.get(e, Equipment);
    applyEquipWear(sim.world, e, 'boots', 0, wearStepOf(ctx, SHOES)); // empty slot
    expect(eq.boots).toBeNull();
    eq.boots = { goodType: SWORD, degreeOfUse: fx.fromInt(0) };
    applyEquipWear(sim.world, e, 'boots', 0, wearStepOf(ctx, SWORD)); // permanent good: ZERO step
    expect(eq.boots).toEqual({ goodType: SWORD, degreeOfUse: fx.fromInt(0) });
    eq.tool = { goodType: TOOL_WOODEN, degreeOfUse: ONE }; // stamped fully spent (a scene can)
    applyEquipWear(sim.world, e, 'tool', 0, wearStepOf(ctx, TOOL_WOODEN));
    expect(eq.tool).toEqual({ goodType: TOOL_WOODEN, degreeOfUse: ONE }); // stays inert, not broken
  });
});
