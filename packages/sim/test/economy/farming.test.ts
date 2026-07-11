import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  ONE,
  Simulation,
  type TerrainMap,
  cellAnchorNode,
  fx,
  halfCellMapFromCells,
} from '../../src/index.js';
import {
  type SystemContext,
  WATERED_GROWTH_PER_TICK,
  aiSystem,
  applySow,
  applyWater,
  cropGrowthSystem,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

const { Building, Carrying, Crop, GroundDrop, JobAssignment, Position, Resource, Settler, Stockpile } =
  components;

/**
 * FIELD FARMING (packages/sim/src/systems/economy/farming.ts + agents/drives-farming.ts): the farm's
 * sow→grow→water→reap→carry loop. Fixture: good 6 = wheat (atomics plant 34 / cultivate 35 / harvest 29
 * — the original's own ids; farming: 5 stages × 10 ticks, yield 1, radius 8, max 4 fields), job 18 =
 * farmer, building 5 = farm (4 farmer slots, wheat-only store cap 25, produces wheat, NO recipe).
 * Unit tests pin the growth/effect mechanics; planner passes pin each drive decision; the end-to-end
 * run proves wheat lands in the farm's own store, deterministically.
 */

const GRASS = 0;
const WHEAT = 6;
const FARMER = 18;
const FARM = 5;
const VIKING = 1;
const SOW_ATOMIC = 34;
const WATER_ATOMIC = 35;
const REAP_ATOMIC = 29;
const PICKUP_ATOMIC = 22;
// The fixture's farming block (keep in sync with fixtures/content.ts).
const STAGES = 5;
const TICKS_PER_STAGE = 10;
const MAX_FIELDS = 4;

beforeEach(() => {
  // Component stores are module-level singletons — clear the WHOLE namespace between sims (AGENTS.md).
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) c.store.clear();
  }
});

/** A `width`×`height` CELL square of grass, upsampled to the half-cell navigation lattice. */
function grassMap(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(GRASS) });
}

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function farmerAt(sim: Simulation, x: number, y: number, boundTo?: Entity): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: FARMER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (boundTo !== undefined) sim.world.add(e, JobAssignment, { workplace: boundTo });
  return e;
}

function farmAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: FARM, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

/** Plant a field directly at tile (x, y) — the sow effect's output shape, for mid-lifecycle fixtures. */
function fieldAt(
  sim: Simulation,
  farm: Entity,
  x: number,
  y: number,
  opts: { stage?: number; watered?: boolean } = {},
): Entity {
  const stage = opts.stage ?? 1;
  const ripe = stage >= STAGES;
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WHEAT, remaining: ripe ? 1 : 0, harvestAtomic: REAP_ATOMIC });
  sim.world.add(e, Crop, {
    goodType: WHEAT,
    farm,
    stage,
    stages: STAGES,
    growth: 0,
    ticksPerStage: TICKS_PER_STAGE,
    watered: opts.watered ?? false,
    yieldUnits: 1,
  });
  return e;
}

describe('crop growth', () => {
  it('advances one stage per ticksPerStage ticks and ripens at the top stage', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const field = fieldAt(sim, farm, 2, 2);

    for (let i = 0; i < TICKS_PER_STAGE; i++) cropGrowthSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(field, Crop).stage).toBe(2);
    expect(sim.world.get(field, Resource).remaining).toBe(0); // still unripe — yields nothing

    for (let i = 0; i < TICKS_PER_STAGE * (STAGES - 2); i++) cropGrowthSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(field, Crop).stage).toBe(STAGES);
    expect(sim.world.get(field, Resource).remaining).toBe(1); // ripe — worth its yield to the scythe
  });

  it('grows a watered field at double pace', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(4, 4) });
    const farm = farmAt(sim, 0, 0);
    const field = fieldAt(sim, farm, 2, 2, { watered: true });

    const ticks = Math.ceil(TICKS_PER_STAGE / WATERED_GROWTH_PER_TICK);
    for (let i = 0; i < ticks; i++) cropGrowthSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(field, Crop).stage).toBe(2);
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

describe('planFarmer — the drive ladder', () => {
  it('sows: an idle bound farmer with no fields starts the plant atomic (or walks to the node)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    const farmer = farmerAt(sim, 4, 4, farm);

    aiSystem(sim.world, ctxOf(sim));

    // The nearest jittered-lattice node may or may not be underfoot — either it walks or it sows.
    const atomic = sim.world.tryGet(farmer, components.CurrentAtomic);
    const goal = sim.world.tryGet(farmer, components.MoveGoal);
    expect(atomic?.atomicId === SOW_ATOMIC || goal !== undefined).toBe(true);
  });

  it('reaps a ripe field before sowing more', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    const field = fieldAt(sim, farm, 4, 4, { stage: STAGES }); // ripe, underfoot
    const farmer = farmerAt(sim, 4, 4, farm);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.atomicId).toBe(REAP_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'harvest', resource: field, goodType: WHEAT });
  });

  it('waters a growing unwatered field once everything is sown', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    // Saturate the farm's field roster so the sow branch is closed and watering is next.
    const fields = [
      fieldAt(sim, farm, 4, 4),
      fieldAt(sim, farm, 3, 4),
      fieldAt(sim, farm, 5, 4),
      fieldAt(sim, farm, 4, 3),
    ];
    const farmer = farmerAt(sim, 4, 4, farm);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.atomicId).toBe(WATER_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'water', crop: fields[0] }); // the one underfoot is nearest
  });

  it('picks up a cut sheaf lying by the farm (then the delivery rung routes it home)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    const sheaf = sim.world.create();
    sim.world.add(sheaf, Position, { x: fx.fromInt(4), y: fx.fromInt(4) });
    sim.world.add(sheaf, Stockpile, { amounts: new Map([[WHEAT, 1]]) });
    sim.world.add(sheaf, GroundDrop, { goodType: WHEAT });
    const farmer = farmerAt(sim, 4, 4, farm);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.atomicId).toBe(PICKUP_ATOMIC);
    expect(atomic.effect).toMatchObject({ kind: 'pickup', goodType: WHEAT, from: sheaf });
  });

  it('a farmer carrying wheat delivers it into the farm store (the bound storage sink)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    const farmer = farmerAt(sim, 4, 4, farm);
    sim.world.add(farmer, Carrying, { goodType: WHEAT, amount: 1 });

    aiSystem(sim.world, ctxOf(sim));
    // Standing on the farm's interaction cell already → the deposit atomic starts at once.
    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'pileup', store: farm });
  });

  it('never sows past the farm max-fields cap', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 10) });
    farmAt(sim, 5, 5);
    farmerAt(sim, 5, 5); // unbound: adopted by the jobSystem's farm-adopt pass on tick 1
    // Growth is slow (10 ticks/stage × 5 stages) relative to this window, so nothing ripens and the
    // count below is the standing-roster max, not a harvested-and-resown churn.
    sim.run(TICKS_PER_STAGE * STAGES - 1);

    const fields = [...sim.world.query(Crop)];
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.length).toBeLessThanOrEqual(MAX_FIELDS);
  });
});

describe('end-to-end — the loop closes', () => {
  it('a bound farmer sows, waters, reaps and banks wheat in the farm store, deterministically', () => {
    const run = (): { wheat: number; hash: string } => {
      for (const c of Object.values(components)) {
        if (typeof c === 'object' && c !== null && 'store' in c && c.store instanceof Map) c.store.clear();
      }
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
