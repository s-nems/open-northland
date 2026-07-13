import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, Simulation } from '../../../src/index.js';
import { applySow, applyWater, cropGrowthSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  Crop,
  ctxOf,
  farmAt,
  fieldAt,
  grassMap,
  REAP_ATOMIC,
  Resource,
  STAGES,
  TICKS_PER_STAGE,
  WHEAT,
} from './support.js';

describe('crop growth', () => {
  it('every stage CONSUMES its watering — a field ripens only under repeated tending', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const field = fieldAt(sim, farm, 2, 2, { watered: true });

    for (let i = 0; i < TICKS_PER_STAGE; i++) cropGrowthSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(field, Crop).stage).toBe(2);
    expect(sim.world.get(field, Crop).watered).toBe(false); // the stage drank its watering
    expect(sim.world.get(field, Resource).remaining).toBe(0); // still unripe — yields nothing

    // Thirsty — it stands still however long, until the can comes back.
    for (let i = 0; i < TICKS_PER_STAGE * STAGES; i++) cropGrowthSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(field, Crop).stage).toBe(2);

    // One watering per remaining stage step carries it to ripeness — growth is farmer-fueled.
    for (let stage = 2; stage < STAGES; stage++) {
      applyWater(sim.world, field);
      for (let i = 0; i < TICKS_PER_STAGE; i++) cropGrowthSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(field, Crop).stage).toBe(stage + 1);
    }
    expect(sim.world.get(field, Resource).remaining).toBe(1); // ripe — worth its yield to the scythe
  });

  it('an UNWATERED field stands still — watering is the growth fuel', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const field = fieldAt(sim, farm, 2, 2); // sown, never watered

    for (let i = 0; i < TICKS_PER_STAGE * STAGES * 2; i++) cropGrowthSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(field, Crop).stage).toBe(1); // bare ground until a farmer waters it
    expect(sim.world.get(field, Resource).remaining).toBe(0);
  });

  it('growth is RENDER-visible through a primed snapshot cache — in-place writes are touch-logged', () => {
    // A Crop carries Resource, so the snapshot's scenery-clone cache holds its clone until the entity
    // is World.touch'ed. The browser snapshots every frame, so the cache primes on the crop's very
    // first (freshly-sown, invisible) state — an un-touched water/growth write then renders the field
    // frozen at that stage forever (the user-observed "wheat never grows" while the sim ripens it fine).
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const field = fieldAt(sim, farm, 2, 2);
    const snapCrop = (): { stage: number; watered: boolean } =>
      sim.snapshot().entities.find((e) => e.id === (field as number))?.components.Crop as {
        stage: number;
        watered: boolean;
      };

    expect(snapCrop().watered).toBe(false); // prime the scenery-clone cache on the sown state

    applyWater(sim.world, field);
    expect(snapCrop().watered).toBe(true); // the water write was logged → re-cloned

    for (let i = 0; i < TICKS_PER_STAGE; i++) cropGrowthSystem(sim.world, ctxOf(sim));
    expect(snapCrop().stage).toBe(2); // the growth writes were logged → re-cloned
  });
});

describe('sow / water effects', () => {
  it('sow plants a stage-1 field with a zero-yield resource at the target node', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const node = cellAnchorNode(2, 2);

    applySow(sim.world, ctxOf(sim), { farm, goodType: WHEAT, x: node.hx, y: node.hy });

    const fields = [...sim.world.query(Crop)];
    expect(fields).toHaveLength(1);
    const field = fields[0] as Entity;
    expect(sim.world.get(field, Crop)).toMatchObject({ farm, stage: 1, stages: STAGES, watered: false });
    expect(sim.world.get(field, Resource)).toMatchObject({
      goodType: WHEAT,
      remaining: 0,
      harvestAtomic: REAP_ATOMIC,
    });
  });

  it('sow plants nothing on a node taken since the planner chose it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const node = cellAnchorNode(2, 2);
    applySow(sim.world, ctxOf(sim), { farm, goodType: WHEAT, x: node.hx, y: node.hy });

    applySow(sim.world, ctxOf(sim), { farm, goodType: WHEAT, x: node.hx, y: node.hy }); // the raced twin

    expect([...sim.world.query(Crop)]).toHaveLength(1); // the second swing struck ploughed ground
  });

  it('water marks a growing field watered and ignores a ripe one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const growing = fieldAt(sim, farm, 1, 1);
    const ripe = fieldAt(sim, farm, 2, 2, { stage: STAGES });

    applyWater(sim.world, growing);
    applyWater(sim.world, ripe);

    expect(sim.world.get(growing, Crop).watered).toBe(true);
    expect(sim.world.get(ripe, Crop).watered).toBe(false); // the water hit stubble
  });
});
