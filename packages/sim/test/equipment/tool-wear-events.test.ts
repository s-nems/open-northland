import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Carrying,
  Equipment,
  type EquipmentSlot,
  MISC_EQUIP_SLOTS,
  Position,
  SettlerProgress,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { wearStepOf } from '../../src/systems/equipment/index.js';
import { applyEffect } from '../../src/systems/settlers/atomics/effects/apply.js';
import {
  BUILDER,
  ctxOf,
  HOUSE,
  placeSite,
  TOOL_IRON as SITE_TOOL_IRON,
  WOOD as SITE_WOOD,
  STONE,
  tooledBuilderContent,
} from '../economy/construction-system/support.js';
import { testContent } from '../fixtures/content.js';

// Which completed work events spend a tool's rated use. Original behavior: a build swing and a watering
// wear it (the gathering strokes, casts and workshop cycles are proven beside their own rules); sowing
// and a pickup do not.

const VIKING = 1;
const FARMER = 18;
const TOOL_IRON = 12; // the shared fixture's iron tool: work factor 175, 100 uses
const WOOD = 1;
const HOUSE_STEPS = 90; // the construction fixture's 3-unit home

function toolBearer(sim: Simulation, jobType: number, tool: number, degreeOfUse = fx.fromInt(0)): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Equipment, {
    boots: null,
    tool: { goodType: tool, degreeOfUse },
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
  return e;
}

/** Apply one completed atomic of `effect` for `settler` (duration 1, the executor's shape). */
function complete(sim: Simulation, settler: Entity, effect: Parameters<typeof applyEffect>[3]['effect']) {
  return applyEffect(sim.world, ctxOf(sim), settler, { atomicId: 1, duration: 1, effect });
}

describe('tool wear per work event', () => {
  it('a build swing counts the tool before wearing it, so the breaking swing still installs its steps', () => {
    const sim = new Simulation({ seed: 1, content: tooledBuilderContent() });
    const site = placeSite(sim, HOUSE, { [STONE]: 2, [SITE_WOOD]: 1 });
    const step = wearStepOf(ctxOf(sim), SITE_TOOL_IRON);
    const builder = toolBearer(sim, BUILDER, SITE_TOOL_IRON, fx.sub(ONE, step)); // one rated use left
    complete(sim, builder, { kind: 'construct', site });
    // Two steps, an iron-tool novice's swing: the tool counted, then broke.
    expect(sim.world.get(site, UnderConstruction).labor).toBe(
      fx.mul(fx.div(ONE, fx.fromInt(HOUSE_STEPS)), fx.fromInt(2)),
    );
    expect(sim.world.get(builder, Equipment).tool).toBeNull();
  });

  it('a swing capped by the delivered material still wears the tool and trains nothing', () => {
    const sim = new Simulation({ seed: 1, content: tooledBuilderContent() });
    const site = placeSite(sim, HOUSE, {}); // nothing delivered: the cap is zero
    const builder = toolBearer(sim, BUILDER, SITE_TOOL_IRON);
    complete(sim, builder, { kind: 'construct', site });
    expect(sim.world.get(site, UnderConstruction).labor).toBe(fx.fromInt(0));
    expect(sim.world.get(builder, Equipment).tool?.degreeOfUse).toBe(wearStepOf(ctxOf(sim), SITE_TOOL_IRON));
    expect(sim.world.get(builder, SettlerProgress).experience.size).toBe(0);
  });

  it('a watering wears the tool; a sowing and a pickup do not', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const farmer = toolBearer(sim, FARMER, TOOL_IRON);
    const step = wearStepOf(ctxOf(sim), TOOL_IRON);
    complete(sim, farmer, { kind: 'water', crop: sim.world.create() });
    expect(sim.world.get(farmer, Equipment).tool?.degreeOfUse).toBe(step);
    complete(sim, farmer, { kind: 'sow', farm: sim.world.create(), goodType: WOOD, x: 0, y: 0 });
    expect(sim.world.get(farmer, Equipment).tool?.degreeOfUse).toBe(step);
    complete(sim, farmer, { kind: 'pickup', goodType: WOOD, amount: 1, from: null });
    expect(sim.world.get(farmer, Equipment).tool?.degreeOfUse).toBe(step);
    expect(sim.world.get(farmer, Carrying).amount).toBe(1); // the pickup itself landed
  });
});
