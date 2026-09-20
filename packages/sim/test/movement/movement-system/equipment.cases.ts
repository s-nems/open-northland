import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Carrying,
  Equipment,
  type EquipmentSlot,
  MISC_EQUIP_SLOTS,
  MISSION_BEHAVIOUR,
  MissionBehaviour,
  PathFollow,
  Settler,
  WalkFacing,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../../src/index.js';
import {
  NEED_DRAIN_UNITS_PER_TICK,
  NEED_DRIVE_THRESHOLD,
  needBar,
} from '../../../src/systems/lifecycle/needs/index.js';
import { testContent } from '../../fixtures/content.js';
import { settlerAt } from '../../fixtures/settler.js';
import { roughNodeMap } from '../../fixtures/terrain.js';
import {
  followerAt,
  grassMap,
  LAND_STEP_TICKS,
  LAND_STEP_TICKS_SHOD,
  ticksToArrive,
  waypointAt,
} from './support.js';

// Worn boots take two ticks off every step until the pair is spent, and every node left spends its
// roughness (doubled while hauling) of the pair's 10000 condition points. Departure charges happen after
// reading the current step's pace; the terminal destination also charges. Barefoot, food pays instead.

const SHOES = 8; // 10000 condition points, the fixture's `equip.uses`
const SHOE_POINTS = 10000;
const LAND_ROUGHNESS = 2;

function wearBoots(sim: Simulation, e: Entity, goodType: number, degreeOfUse = fx.fromInt(0)): void {
  sim.world.add(e, Equipment, {
    boots: { goodType, degreeOfUse },
    tool: null,
    weapon: null,
    armor: null,
    misc: new Array<EquipmentSlot | null>(MISC_EQUIP_SLOTS).fill(null),
  });
}

/** A three-cell E/W walk, six half-column steps. */
const WALK: Array<{ x: number; y: number }> = Array.from({ length: 7 }, (_, i) => ({ x: i / 2, y: 0 }));
const WALK_STEPS = WALK.length - 1;

/** The slot's spent condition points, the integer the fraction stands for. */
const spentPoints = (sim: Simulation, e: Entity): number =>
  Math.round((fx.toFloat(sim.world.get(e, Equipment).boots?.degreeOfUse ?? ONE) * SHOE_POINTS) / 1);

describe('movementSystem - worn boots', () => {
  it('a booted walker takes two ticks fewer per step: 12 a cell on land against 16 bare', () => {
    const bare = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    expect(ticksToArrive(bare, followerAt(bare, 0, 0, WALK))).toBe(WALK_STEPS * LAND_STEP_TICKS);

    const booted = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(booted, 0, 0, WALK);
    wearBoots(booted, e, SHOES);
    expect(ticksToArrive(booted, e)).toBe(WALK_STEPS * LAND_STEP_TICKS_SHOD);
  });

  it('spends the roughness of every departure and the destination, doubled while hauling', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK);
    wearBoots(sim, e, SHOES);
    ticksToArrive(sim, e);
    expect(spentPoints(sim, e)).toBe((WALK_STEPS + 1) * LAND_ROUGHNESS);

    const laden = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const c = followerAt(laden, 0, 0, WALK);
    wearBoots(laden, c, SHOES);
    laden.world.add(c, Carrying, { goodType: 1, amount: 1 });
    ticksToArrive(laden, c);
    expect(spentPoints(laden, c)).toBe((WALK_STEPS + 1) * LAND_ROUGHNESS * 2);
  });

  it('wears nothing off a roughness-0 node and five points off snow', () => {
    const map = roughNodeMap(8, 1, (hx) => (hx === 0 ? 0 : 5));
    const sim = new Simulation({ seed: 1, content: testContent(), map });
    const e = followerAt(sim, 0, 0, WALK.slice(0, 3)); // two steps: off node 0 (r 0), off node 1 (r 5)
    wearBoots(sim, e, SHOES);
    ticksToArrive(sim, e);
    expect(spentPoints(sim, e)).toBe(10); // middle departure and terminal destination
  });

  it('charges at departure before an interrupted leg can discard its cost', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK);
    wearBoots(sim, e, SHOES);
    sim.step();
    expect(spentPoints(sim, e)).toBe(2);
    sim.world.remove(e, PathFollow);
    sim.step();
    expect(spentPoints(sim, e)).toBe(2);
  });

  it('charges each endpoint using its own roughness and the carrying state at that callback', () => {
    const sim = new Simulation({
      seed: 1,
      content: testContent(),
      map: roughNodeMap(4, 1, (hx) => (hx === 0 ? 1 : 5)),
    });
    const e = followerAt(sim, 0, 0, WALK.slice(0, 2));
    wearBoots(sim, e, SHOES);
    sim.step();
    expect(spentPoints(sim, e)).toBe(1);
    sim.world.add(e, Carrying, { goodType: 1, amount: 1 });
    ticksToArrive(sim, e);
    expect(spentPoints(sim, e)).toBe(11); // departure 1, destination 5 doubled by the new load
  });

  it('charges a same-node destination only once', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK.slice(0, 1));
    wearBoots(sim, e, SHOES);
    expect(ticksToArrive(sim, e)).toBe(1);
    expect(spentPoints(sim, e)).toBe(2);
  });

  it('reads pace before spending the last shoe point and charges the destination as barefoot', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = settlerAt(sim, { jobType: 1, position: { x: fx.fromInt(0), y: fx.fromInt(0) } });
    sim.world.add(e, WalkFacing, { direction: 0, target: 0 });
    sim.world.add(e, PathFollow, {
      waypoints: WALK.slice(0, 2).map((w) => waypointAt(sim, w.x, w.y)),
      index: 1,
      legTicks: 0,
      legCost: 0,
    });
    wearBoots(sim, e, SHOES, fx.div(fx.fromInt(SHOE_POINTS - 1), fx.fromInt(SHOE_POINTS)));
    sim.step();
    expect(sim.world.get(e, Equipment).boots).toBeNull();
    expect(sim.world.get(e, PathFollow).legCost).toBe(LAND_STEP_TICKS_SHOD);
    expect(ticksToArrive(sim, e)).toBe(LAND_STEP_TICKS_SHOD - 1);
    expect(sim.world.get(e, Settler).hunger).toBe(
      fx.add(fx.mul(needBar(NEED_DRAIN_UNITS_PER_TICK), fx.fromInt(LAND_STEP_TICKS_SHOD)), needBar(2)),
    );
  });

  it('honors the shoe-protection flag, including the terminal node', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK);
    wearBoots(sim, e, SHOES);
    sim.world.add(e, MissionBehaviour, { flags: MISSION_BEHAVIOUR.SHOES_DO_NOT_WEAR });
    expect(ticksToArrive(sim, e)).toBe(WALK_STEPS * LAND_STEP_TICKS_SHOD);
    expect(spentPoints(sim, e)).toBe(0);
  });

  it('breaks the pair at its last point mid-walk: the slot clears and the tail walks barefoot', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK);
    // Three points left on the pair: the second step's two points empty it (the count is exact,
    // so a pair never outlives its rating by a rounding ulp).
    wearBoots(sim, e, SHOES, fx.div(fx.fromInt(SHOE_POINTS - 3), fx.fromInt(SHOE_POINTS)));
    const ticks = ticksToArrive(sim, e);
    expect(sim.world.get(e, Equipment).boots).toBeNull();
    // Two shod steps, then four barefoot ones.
    expect(ticks).toBe(2 * LAND_STEP_TICKS_SHOD + (WALK_STEPS - 2) * LAND_STEP_TICKS);
  });

  it('a spent pair grants no pace (and wears no further)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
    const e = followerAt(sim, 0, 0, WALK);
    wearBoots(sim, e, SHOES, ONE); // stamped fully spent
    expect(ticksToArrive(sim, e)).toBe(WALK_STEPS * LAND_STEP_TICKS);
    expect(sim.world.get(e, Equipment).boots).toEqual({ goodType: SHOES, degreeOfUse: ONE });
  });

  it('a walker due for sleep takes two ticks more a step, shod or not', () => {
    const tired = (shod: boolean): number => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
      const e = followerAt(sim, 0, 0, WALK);
      addPerson(sim.world, e, {
        tribe: 0,
        jobType: null,
        hunger: fx.fromInt(0),
        fatigue: NEED_DRIVE_THRESHOLD,
        piety: fx.fromInt(0),
        enjoyment: fx.fromInt(0),
        experience: new Map(),
      });
      if (shod) wearBoots(sim, e, SHOES);
      return ticksToArrive(sim, e);
    };
    expect(tired(false)).toBe(WALK_STEPS * (LAND_STEP_TICKS + 2));
    expect(tired(true)).toBe(WALK_STEPS * (LAND_STEP_TICKS_SHOD + 2));
  });

  it('barefoot, every node left costs its roughness in food instead, doubled while hauling', () => {
    const walked = (carrying: boolean, shod: boolean, flags = 0): number => {
      const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(8, 1) });
      const e = settlerAt(sim, { jobType: 1, position: { x: fx.fromInt(0), y: fx.fromInt(0) } });
      sim.world.add(e, PathFollow, {
        waypoints: WALK.map((w) => waypointAt(sim, w.x, w.y)),
        index: 1,
        legTicks: 0,
        legCost: 0,
      });
      if (carrying) sim.world.add(e, Carrying, { goodType: 1, amount: 1 });
      if (shod) wearBoots(sim, e, SHOES);
      if (flags !== 0) sim.world.add(e, MissionBehaviour, { flags });
      const ticks = ticksToArrive(sim, e);
      // Net of the bar's own rise over the walk (one truncated quantum a tick), which every walker pays alike.
      return fx.sub(
        sim.world.get(e, Settler).hunger,
        fx.mul(needBar(NEED_DRAIN_UNITS_PER_TICK), fx.fromInt(ticks)),
      );
    };
    // Each step moves the bar by its own truncated quantum, so the sum is `steps` quanta, not one.
    expect(walked(false, false)).toBe(fx.mul(needBar(LAND_ROUGHNESS), fx.fromInt(WALK_STEPS + 1)));
    expect(walked(true, false)).toBe(fx.mul(needBar(LAND_ROUGHNESS * 2), fx.fromInt(WALK_STEPS + 1)));
    expect(walked(false, true)).toBe(fx.fromInt(0)); // shod: the pair pays, not the bar
    expect(walked(false, false, MISSION_BEHAVIOUR.SHOES_DO_NOT_WEAR)).toBe(walked(false, false));
  });
});
