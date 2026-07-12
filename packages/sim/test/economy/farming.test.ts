import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  cellAnchorNode,
  fx,
  halfCellMapFromCells,
  nodeOfPosition,
  ONE,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import {
  aiSystem,
  applySow,
  applyWater,
  cropGrowthSystem,
  type SystemContext,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { clearComponentStores } from '../fixtures/stores.js';

const { Building, Carrying, Crop, GroundDrop, JobAssignment, Position, Resource, Settler, Stockpile } =
  components;

/**
 * FIELD FARMING (packages/sim/src/systems/economy/farming.ts + agents/drives-farming.ts): the farm's
 * sow→grow→water→reap→carry loop. Fixture: good 6 = wheat (atomics plant 34 / cultivate 35 / harvest 29
 * — the original's own ids; farming: 5 stages × 10 ticks, yield 1, radius 8, field cap 2 + 4/farmer),
 * job 18 = farmer, building 5 = farm (4 farmer slots, wheat-only store cap 25, produces wheat, NO recipe).
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
/** The fixture's field-cap formula: `fieldsBase + fieldsPerFarmer × bound field-farmers`. */
const FIELDS_BASE = 2;
const FIELDS_PER_FARMER = 4;
const SOLO_FIELD_CAP = FIELDS_BASE + FIELDS_PER_FARMER; // 6
const PAIR_FIELD_CAP = FIELDS_BASE + FIELDS_PER_FARMER * 2; // 10 — sublinear, not 2× the solo cap

// Component stores are module-level singletons — clear the WHOLE namespace between sims (AGENTS.md).
beforeEach(clearComponentStores);

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

  it('waters a thirsty field once the roster is at its cap (the can circles between sowings)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    // A full one-farmer roster (cap 2 + 4 = 6), the underfoot field thirsty — the sow branch is
    // closed, so the drive reaches for the can. (Under the cap it sows FIRST — per-stage watering
    // keeps some field thirsty almost always, and a water-first farmer would never expand the plot.)
    const field = fieldAt(sim, farm, 4, 4);
    fieldAt(sim, farm, 3, 3, { watered: true });
    fieldAt(sim, farm, 5, 3, { watered: true });
    fieldAt(sim, farm, 3, 5, { watered: true });
    fieldAt(sim, farm, 2, 4, { watered: true });
    fieldAt(sim, farm, 6, 4, { watered: true });
    const farmer = farmerAt(sim, 4, 4, farm);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(farmer, components.CurrentAtomic);
    expect(atomic.atomicId).toBe(WATER_ATOMIC);
    expect(atomic.effect).toEqual({ kind: 'water', crop: field });
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

  it('never sows past the crew-scaled cap: one farmer works fieldsPerFarmer fields', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(10, 10) });
    farmAt(sim, 5, 5);
    farmerAt(sim, 5, 5); // unbound: adopted by the jobSystem's farm-adopt pass on tick 1
    // Growth is slow (10 ticks/stage × 5 stages) relative to this window, so nothing ripens and the
    // count below is the standing-roster max, not a harvested-and-resown churn.
    sim.run(TICKS_PER_STAGE * STAGES - 1);

    const fields = [...sim.world.query(Crop)];
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.length).toBeLessThanOrEqual(SOLO_FIELD_CAP);
  });

  it('the field roster SCALES with the crew: a second farmer raises the sow cap sublinearly', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 12) });
    const farm = farmAt(sim, 6, 6);
    farmerAt(sim, 6, 6, farm);
    farmerAt(sim, 6, 6, farm);
    // Long enough for the pair to saturate the roster; per-stage watering keeps consuming their time,
    // so track the PEAK standing-field count across the run.
    let peak = 0;
    for (let t = 0; t < 400; t++) {
      sim.run(1);
      let fields = 0;
      for (const _e of sim.world.query(Crop)) fields++;
      if (fields > peak) peak = fields;
    }
    expect(peak).toBeGreaterThan(SOLO_FIELD_CAP); // beyond a lone farmer's plot…
    expect(peak).toBeLessThanOrEqual(PAIR_FIELD_CAP); // …never past the pair's (base counted ONCE)
  });

  it('a spawned farmer is farm-bound, NOT a flag gatherer (no auto work flag)', () => {
    // The spawn auto-plant (`syncWorkFlagToJob`) flags every job that can harvest a FLAG-GATHERED
    // good; the farmer's only harvestable good is FIELD-FARMED (a `farming` block), so it must stay
    // flagless — a flag would hijack every sheaf delivery to the flag instead of the farm's store.
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    sim.enqueue({ kind: 'spawnSettler', jobType: FARMER, x: 8, y: 8, tribe: VIKING });
    sim.run(1);
    const spawned = [...sim.world.query(Settler)];
    expect(spawned).toHaveLength(1);
    expect(sim.world.tryGet(spawned[0] as Entity, components.WorkFlag)).toBeUndefined();
  });

  it('a farm still under construction fields no crew (jobtypes.ini mustHaveFinishedWorkHouseFlag 1)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    sim.world.add(farm, components.UnderConstruction, { labor: fx.fromInt(0) });
    const farmer = farmerAt(sim, 4, 4, farm);

    aiSystem(sim.world, ctxOf(sim));

    // The field loop never engages a foundation: no claim, no sow/water/reap swing.
    expect(sim.world.tryGet(farmer, components.FarmTask)).toBeUndefined();
    const atomic = sim.world.tryGet(farmer, components.CurrentAtomic)?.atomicId;
    expect([SOW_ATOMIC, WATER_ATOMIC, REAP_ATOMIC]).not.toContain(atomic);
    expect([...sim.world.query(Crop)]).toHaveLength(0);
  });

  it('an idle farmer waits INSIDE the farm (Resting) and steps back out when a field thirsts', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 8) });
    const farm = farmAt(sim, 4, 4);
    // Every slot taken: a full watered roster (nothing to reap/carry/water/sow for a crew of ONE).
    const fields = [
      fieldAt(sim, farm, 3, 3, { watered: true }),
      fieldAt(sim, farm, 5, 3, { watered: true }),
      fieldAt(sim, farm, 3, 5, { watered: true }),
      fieldAt(sim, farm, 5, 5, { watered: true }),
      fieldAt(sim, farm, 2, 4, { watered: true }),
      fieldAt(sim, farm, 6, 4, { watered: true }),
    ];
    const farmer = farmerAt(sim, 4, 4, farm); // standing at the farm's own cell (the door)
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(farmer, components.Resting)).toBe(true); // went inside — no loitering
    expect(sim.world.tryGet(farmer, components.CurrentAtomic)).toBeUndefined();

    // A field turns thirsty → the very next plan leaves the house for the can.
    sim.world.get(fields[0] as Entity, Crop).watered = false;
    aiSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(farmer, components.Resting)).toBe(false);
    const atomic = sim.world.tryGet(farmer, components.CurrentAtomic);
    const goal = sim.world.tryGet(farmer, components.MoveGoal);
    expect(atomic?.atomicId === WATER_ATOMIC || goal !== undefined).toBe(true);
  });
});

const BARREN = 2;
const GRANARY = 6;
/** The fixture farm's wheat-slot ceiling (`stock` capacity 25 — keep in sync with fixtures/content.ts). */
const FARM_WHEAT_CAP = 25;

/** A `width`×`height` CELL map where `isGrass(x, y)` cells are plantable grass and the rest is BARREN
 *  (walkable + buildable, but the plough is rejected — the sand/desert class). */
function mapWithBarren(
  width: number,
  height: number,
  isGrass: (x: number, y: number) => boolean,
): TerrainMap {
  const typeIds: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) typeIds.push(isGrass(x, y) ? GRASS : BARREN);
  }
  return halfCellMapFromCells({ width, height, typeIds });
}

function granaryAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: GRANARY, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

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
      clearComponentStores();
      const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(10, 10) });
      const farm = farmAt(sim, 5, 5);
      for (let i = 0; i < farmers; i++) farmerAt(sim, 5, 5, farm);
      sim.run(300);
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
    expect([...sim.world.query(Crop)]).toHaveLength(SOLO_FIELD_CAP); // the fields stand ripe, unreaped
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
    sim.run(200);
    expect(sim.world.get(granary, Stockpile).amounts.get(WHEAT) ?? 0).toBeGreaterThan(0);
    expect(sim.world.get(farm, Stockpile).amounts.get(WHEAT)).toBe(FARM_WHEAT_CAP);
  });
});

describe('end-to-end — the loop closes', () => {
  it('a bound farmer sows, waters, reaps and banks wheat in the farm store, deterministically', () => {
    const run = (): { wheat: number; hash: string } => {
      clearComponentStores();
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
