import { describe, expect, it } from 'vitest';
import { FarmTask } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { cellAnchorNode, Simulation } from '../../../src/index.js';
import { applySow, applyWater, plannerSystem } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';

import {
  Crop,
  ctxOf,
  farmAt,
  farmerAt,
  fieldAt,
  fieldAtNode,
  grassMap,
  REAP_ATOMIC,
  Resource,
  STAGES,
  WHEAT,
} from './support.js';

/** The six lattice neighbours of an even-row node: E, W and the adjacent rows' nodes at dx -1 and 0, the
 *  odd rows sitting half a node to +x. */
const RING_EVEN_ROW = [
  [1, 0],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [-1, 1],
  [0, 1],
] as const;
/** The same ring for an odd-row node: the adjacent even rows' nodes at dx 0 and +1. */
const RING_ODD_ROW = [
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, -1],
  [0, 1],
  [1, 1],
] as const;
/** Nodes one step outside either ring: the wrong-parity adjacent-row pair and the straight and diagonal
 *  two-row steps the pathfinder walks. */
const BEYOND_EVEN_ROW = [
  [1, -1],
  [1, 1],
  [0, -2],
  [0, 2],
  [2, 0],
  [-2, 0],
  [1, -2],
  [-1, -2],
  [1, 2],
  [-1, 2],
] as const;
const BEYOND_ODD_ROW = [
  [-1, -1],
  [-1, 1],
  [0, -2],
  [0, 2],
  [2, 0],
  [-2, 0],
  [1, -2],
  [-1, -2],
  [1, 2],
  [-1, 2],
] as const;
/** Targets deep enough inside the 12-cell map for every offset above to stay in bounds, one per row parity. */
const EVEN_TARGET = { hx: 10, hy: 10 } as const;
const ODD_TARGET = { hx: 10, hy: 11 } as const;
/** Long enough for any timer the sim might still carry to show. */
const IDLE_TICKS = 1000;

describe('crop growth', () => {
  it('a watering steps the field one stage, and nothing else does - until the top stage frees its yield', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const field = fieldAt(sim, farm, 2, 2);

    sim.run(IDLE_TICKS);
    expect(sim.world.get(field, Crop).stage).toBe(1); // bare ground until a farmer waters it

    applyWater(sim.world, field);
    expect(sim.world.get(field, Crop).stage).toBe(2);
    expect(sim.world.get(field, Resource).remaining).toBe(0); // still unripe - yields nothing
    sim.run(IDLE_TICKS);
    expect(sim.world.get(field, Crop).stage).toBe(2); // stands there however long

    for (let stage = 2; stage < STAGES; stage++) applyWater(sim.world, field);
    expect(sim.world.get(field, Crop).stage).toBe(STAGES);
    expect(sim.world.get(field, Resource).remaining).toBe(1); // ripe - worth its yield to the scythe
  });

  it('a watering reaches the six lattice neighbours of its target, parity shift included, and nothing farther', () => {
    const cases = [
      { target: EVEN_TARGET, ring: RING_EVEN_ROW, beyond: BEYOND_EVEN_ROW },
      { target: ODD_TARGET, ring: RING_ODD_ROW, beyond: BEYOND_ODD_ROW },
    ] as const;
    for (const { target, ring, beyond } of cases) {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 12) });
      const farm = farmAt(sim, 0, 0);
      const watered = fieldAtNode(sim, farm, target.hx, target.hy);
      const reached = ring.map(([dx, dy]) => fieldAtNode(sim, farm, target.hx + dx, target.hy + dy));
      const missed = beyond.map(([dx, dy]) => fieldAtNode(sim, farm, target.hx + dx, target.hy + dy));

      applyWater(sim.world, watered);

      expect(sim.world.get(watered, Crop).stage).toBe(2);
      for (const e of reached) expect(sim.world.get(e, Crop).stage, `row ${target.hy}`).toBe(2);
      for (const e of missed) expect(sim.world.get(e, Crop).stage, `row ${target.hy}`).toBe(1);
    }
  });

  it('a ripe field in reach stands as it is, and a target reaped meanwhile waters nothing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 12) });
    const farm = farmAt(sim, 0, 0);
    const target = fieldAtNode(sim, farm, EVEN_TARGET.hx, EVEN_TARGET.hy, { stage: STAGES - 1 });
    const ripe = fieldAtNode(sim, farm, EVEN_TARGET.hx + 1, EVEN_TARGET.hy, { stage: STAGES });
    const growing = fieldAtNode(sim, farm, EVEN_TARGET.hx - 1, EVEN_TARGET.hy);

    applyWater(sim.world, target);
    expect(sim.world.get(target, Crop).stage).toBe(STAGES);
    expect(sim.world.get(target, Resource).remaining).toBe(1);
    expect(sim.world.get(ripe, Crop).stage).toBe(STAGES);
    expect(sim.world.get(ripe, Resource).remaining).toBe(1); // not doubled
    expect(sim.world.get(growing, Crop).stage).toBe(2);

    sim.world.destroy(target); // the raced case: a colleague's scythe took it during the clip
    applyWater(sim.world, target);
    expect(sim.world.get(growing, Crop).stage).toBe(2);
  });

  it('growth is RENDER-visible through a primed snapshot cache - in-place writes are logged', () => {
    // A Crop carries Resource, so the snapshot's scenery-clone cache holds its clone until the entity
    // is written through `World.write`. The browser snapshots every frame, so the cache primes on the
    // crop's very first (freshly-sown) state - an unlogged growth write then renders the field frozen
    // at that stage forever (observation: the field renders frozen while the sim ripens it).
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const field = fieldAt(sim, farm, 2, 2);
    const snapStage = (): number | undefined => {
      const crop = sim.snapshot().entities.find((e) => e.id === (field as number))?.components.Crop;
      return (crop as { stage?: number } | undefined)?.stage;
    };

    expect(snapStage()).toBe(1); // prime the scenery-clone cache on the sown state

    applyWater(sim.world, field);
    expect(snapStage()).toBe(2); // the growth write was logged → re-cloned
  });
});

describe('the sow effect', () => {
  it('sow plants a stage-1 field with a zero-yield resource at the target node', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const node = cellAnchorNode(2, 2);

    applySow(sim.world, ctxOf(sim), { farm, goodType: WHEAT, x: node.hx, y: node.hy });

    const fields = [...sim.world.query(Crop)];
    expect(fields).toHaveLength(1);
    const field = fields[0] as Entity;
    expect(sim.world.get(field, Crop)).toEqual({
      goodType: WHEAT,
      farm,
      stage: 1,
      stages: STAGES,
      yieldUnits: 1,
    });
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

  it('the first sowing lands on one of the nearest free nodes, drawn from the seeded stream', () => {
    // The anchor holds the farm's own store, so the fresh plot's five nearest free nodes are its four
    // distance-1 neighbours and the first at distance 2; across seeds the pick is not always the same node.
    const firstSowNode = (seed: number): { dist: number; node: number } => {
      const sim = new Simulation({ seed, content: testContent(), map: grassMap(8, 8) });
      const farm = farmAt(sim, 4, 4);
      const farmer = farmerAt(sim, 4, 4, farm);
      plannerSystem(sim.world, ctxOf(sim));
      const task = sim.world.get(farmer, FarmTask);
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('scene sim has terrain');
      const anchor = cellAnchorNode(4, 4);
      const at = terrain.coordsOf(task.node);
      expect(task.sow).toBe(true);
      return { dist: Math.abs(at.x - anchor.hx) + Math.abs(at.y - anchor.hy), node: task.node };
    };
    const picks = [1, 2, 3, 4, 5, 6, 7, 8].map(firstSowNode);
    for (const pick of picks) expect(pick.dist).toBeLessThanOrEqual(2);
    expect(new Set(picks.map((p) => p.node)).size).toBeGreaterThan(1);
  });
});
