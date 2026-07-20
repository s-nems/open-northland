import { describe, expect, it } from 'vitest';
import * as components from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, nodeOfPosition, Simulation } from '../../../src/index.js';
import { aiSystem, applySow } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  Carrying,
  Crop,
  ctxOf,
  FARM_WHEAT_CAP,
  FIELD_CAP,
  farmAt,
  farmerAt,
  fieldAt,
  granaryAt,
  grassMap,
  mapWithBarren,
  Position,
  REAP_ATOMIC,
  STAGES,
  Stockpile,
  WHEAT,
} from './support.js';

describe('work division — two farmers never share a target', () => {
  it('the second farmer skips the field the first is already reaping', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    const near = fieldAt(sim, farm, 4, 4, { stage: STAGES }); // underfoot — the first farmer's pick
    fieldAt(sim, farm, 2, 2, { stage: STAGES }); // the second-nearest ripe field
    const f1 = farmerAt(sim, 4, 4, farm);
    const f2 = farmerAt(sim, 4, 4, farm);

    aiSystem(sim.world, ctxOf(sim));

    // f1 (planned first) reaps the field underfoot; f2 must NOT shadow it — it claims the OTHER field.
    expect(sim.world.get(f1, components.CurrentAtomic).effect).toEqual({
      kind: 'harvest',
      resource: near,
      goodType: WHEAT,
    });
    const farNode = cellAnchorNode(2, 2);
    expect(sim.world.get(f2, components.FarmTask).node).toBe(sim.terrain?.nodeAt(farNode.hx, farNode.hy));
    expect(sim.world.tryGet(f2, components.MoveGoal)).toBeDefined(); // walking to the far field
  });

  it('an in-flight claim persists across ticks: a later planner avoids the walking farmer’s target', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 10) });
    const farm = farmAt(sim, 5, 5);
    fieldAt(sim, farm, 4, 4, { stage: STAGES }); // nearer to the door
    fieldAt(sim, farm, 8, 8, { stage: STAGES }); // farther
    const f1 = farmerAt(sim, 5, 5, farm);
    aiSystem(sim.world, ctxOf(sim)); // tick 1: f1 sets off toward the near field (MoveGoal + FarmTask)
    expect(sim.world.tryGet(f1, components.MoveGoal)).toBeDefined();
    const nearNode = cellAnchorNode(4, 4);
    expect(sim.world.get(f1, components.FarmTask).node).toBe(sim.terrain?.nodeAt(nearNode.hx, nearNode.hy));

    // A SECOND farmer appears a tick later, while f1 is still walking — it must claim the far field.
    const f2 = farmerAt(sim, 5, 5, farm);
    aiSystem(sim.world, ctxOf(sim));
    const farNode = cellAnchorNode(8, 8);
    expect(sim.world.get(f2, components.FarmTask).node).toBe(sim.terrain?.nodeAt(farNode.hx, farNode.hy));
  });

  it('holds the no-shared-target invariant through a full run', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(10, 10) });
    const farm = farmAt(sim, 5, 5);
    farmerAt(sim, 5, 5, farm);
    farmerAt(sim, 5, 5, farm);
    for (let t = 0; t < 300; t++) {
      sim.run(1);
      const nodes = [...sim.world.query(components.FarmTask)].map(
        (e) => sim.world.get(e, components.FarmTask).node,
      );
      expect(new Set(nodes).size).toBe(nodes.length); // pairwise-distinct in-flight targets, every tick
    }
  });

  it('a second farmer roughly doubles the banked wheat', () => {
    const run = (farmers: number): number => {
      const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(10, 10) });
      const farm = farmAt(sim, 5, 5);
      for (let i = 0; i < farmers; i++) farmerAt(sim, 5, 5, farm);
      sim.run(450);
      return sim.world.get(farm, Stockpile).amounts.get(WHEAT) ?? 0;
    };

    const solo = run(1);
    const pair = run(2);
    expect(solo).toBeGreaterThan(0);
    // Deterministic fixture ratio: with divided work the pair must clearly out-produce the solo run
    // (the old shadowing bug pinned this at ~1×). 1.5× is the safety margin under walk-path noise.
    expect(pair).toBeGreaterThanOrEqual(Math.ceil(solo * 1.5));
    // The farm's 25-cap must not be what limits the pair — otherwise the ratio measures the store.
    expect(pair).toBeLessThan(FARM_WHEAT_CAP);
  });
});

describe('grass-only sowing (the plantable-ground gate)', () => {
  it('a sow swing on barren ground plants nothing', () => {
    const sim = new Simulation({
      seed: 1,
      content: testContent(),
      map: mapWithBarren(4, 4, () => false), // all barren
    });
    const farm = farmAt(sim, 0, 0);
    const node = cellAnchorNode(2, 2);

    applySow(sim.world, ctxOf(sim), { farm, goodType: WHEAT, x: node.hx, y: node.hy });

    expect([...sim.world.query(Crop)]).toHaveLength(0);
  });

  it('the drive sows the grass pocket and never the barren ring', () => {
    // Grass only in the 3×3 block around the farm — every field, over the WHOLE run, must land there.
    // (Checked per tick: the tiny pocket makes the crop cycles synchronize, so a single end-of-run
    // snapshot can land in the everything-just-reaped window and see zero standing fields.)
    const sim = new Simulation({
      seed: 7,
      content: testContent(),
      map: mapWithBarren(10, 10, (x, y) => x >= 4 && x <= 6 && y >= 4 && y <= 6),
    });
    const farm = farmAt(sim, 5, 5);
    farmerAt(sim, 5, 5, farm);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('scene sim has terrain');

    let fieldsSeen = 0;
    for (let t = 0; t < 150; t++) {
      sim.run(1);
      for (const e of sim.world.query(Crop, Position)) {
        fieldsSeen++;
        const p = sim.world.get(e, Position);
        const n = nodeOfPosition(p.x, p.y);
        expect(terrain.isPlantable(terrain.nodeAtClamped(n.hx, n.hy))).toBe(true);
      }
    }
    expect(fieldsSeen).toBeGreaterThan(0);
  });
});

describe('store-full pause and overflow', () => {
  /** A farm whose wheat slot is FULL, its field roster maxed and every field ripe — the reap/carry
   *  gate is the only thing left to decide. */
  function fullFarmWorld(sim: Simulation): { farm: Entity; farmer: Entity } {
    const farm = farmAt(sim, 4, 4);
    sim.world.get(farm, Stockpile).amounts.set(WHEAT, FARM_WHEAT_CAP);
    fieldAt(sim, farm, 4, 4, { stage: STAGES });
    fieldAt(sim, farm, 3, 3, { stage: STAGES });
    fieldAt(sim, farm, 5, 3, { stage: STAGES });
    fieldAt(sim, farm, 3, 5, { stage: STAGES });
    fieldAt(sim, farm, 2, 4, { stage: STAGES });
    fieldAt(sim, farm, 6, 4, { stage: STAGES });
    const farmer = farmerAt(sim, 4, 4, farm);
    return { farm, farmer };
  }

  it('with every wheat sink full the farmer waits INSIDE — ripe fields stand, nothing is reaped', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const { farmer } = fullFarmWorld(sim);

    aiSystem(sim.world, ctxOf(sim));

    // No reap swing, no walk — the farmer steps inside the farm until store room frees.
    expect(sim.world.tryGet(farmer, components.CurrentAtomic)).toBeUndefined();
    expect(sim.world.tryGet(farmer, components.MoveGoal)).toBeUndefined();
    expect(sim.world.has(farmer, components.Resting)).toBe(true);
    expect([...sim.world.query(Crop)]).toHaveLength(FIELD_CAP); // the fields stand ripe, unreaped
  });

  it('a farmer stuck with a load (every sink full) waits INSIDE the farm holding it, then deposits', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const { farm, farmer } = fullFarmWorld(sim);
    sim.world.add(farmer, Carrying, { goodType: WHEAT, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));
    // Nowhere to put the sheaf — the farmer steps inside with it instead of freezing at the door.
    expect(sim.world.has(farmer, components.Resting)).toBe(true);
    expect(sim.world.tryGet(farmer, components.CurrentAtomic)).toBeUndefined();
    expect(sim.world.get(farmer, Carrying).amount).toBe(1); // the load stays in hand

    // Room frees (the player spends a unit) → the very next plan walks back out and deposits.
    sim.world.get(farm, Stockpile).amounts.set(WHEAT, FARM_WHEAT_CAP - 1);
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(farmer, components.Resting)).toBe(false);
    expect(sim.world.get(farmer, components.CurrentAtomic).effect).toEqual({ kind: 'pileup', store: farm });
  });

  it('a granary with room re-opens the scythe and receives the overflow', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const { farm, farmer } = fullFarmWorld(sim);
    const granary = granaryAt(sim, 2, 2);

    aiSystem(sim.world, ctxOf(sim));
    // The sink exists again → the ripe field underfoot is reaped at once.
    expect(sim.world.get(farmer, components.CurrentAtomic).atomicId).toBe(REAP_ATOMIC);

    // And the full loop routes the overflow into the granary (the farm's own slot stays full).
    sim.run(300);
    expect(sim.world.get(granary, Stockpile).amounts.get(WHEAT) ?? 0).toBeGreaterThan(0);
    expect(sim.world.get(farm, Stockpile).amounts.get(WHEAT)).toBe(FARM_WHEAT_CAP);
  });
});

describe('end-to-end — the loop closes', () => {
  it('a bound farmer sows, waters, reaps and banks wheat in the farm store, deterministically', () => {
    const run = (): { wheat: number; hash: string } => {
      const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(10, 10) });
      const farm = farmAt(sim, 5, 5);
      farmerAt(sim, 5, 5, farm);
      // Sow (walk + 3 ticks) → grow (≤ 50 ticks unwatered, less once watered) → reap → carry: 400
      // ticks is comfortably past several full cycles.
      sim.run(400);
      return { wheat: sim.world.get(farm, Stockpile).amounts.get(WHEAT) ?? 0, hash: sim.hashState() };
    };

    const a = run();
    const b = run();
    expect(a.wheat).toBeGreaterThan(0); // the loop closed: wheat reached the farm's own store
    expect(a.hash).toBe(b.hash); // same seed + same setup ⇒ byte-identical state
  });
});
