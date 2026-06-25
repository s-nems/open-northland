import { beforeEach, describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Production,
  Resource,
  Settler,
  Stockpile,
} from '../src/components/index.js';
import type { Entity } from '../src/ecs/world.js';
import { type Fixed, ONE, Simulation, type TerrainMap, fx } from '../src/index.js';
import { type SystemContext, aiSystem, atomicSystem } from '../src/systems/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Unit + integration tests for the PRAY DRIVE — the planner choosing a `pray` atomic (id 12, the
 * original's `MAP_MOVEABLES_ATOMIC_ACTION_TYPE_PRAY`) when a settler's piety crosses the threshold,
 * WALKING TO A TEMPLE (the first target-bound need — unlike eat at a store / sleep in place) and
 * zeroing piety on completion, closing the NeedsSystem's rise→pray→reset loop.
 *
 * The viking tribe binds pray atomic 12 → "viking_pray" (length 7); the pray atomic id (12) is pinned
 * to the original `setatomic 6 12 "..._pray"` bindings + the `HOUSE_TYPE_WORK_TEMPLE` (logictype 37,
 * logicmaintype 3, no workers/stock/production) temple signature `isTemple` recognises; the ¾·ONE
 * threshold + the temple→pray-need inference are approximated (docs/FIDELITY.md).
 */

const GRASS = 0;
const WOOD = 1;
const WOODCUTTER = 1;
const VIKING = 1;
const TEMPLE_TYPE = 3;
const PRAY_ATOMIC = 12;
// Just over the ¾·ONE pray threshold — a settler this devout-overdue prays before any work.
const DEVOUT: Fixed = fx.add(fx.div(fx.fromInt(3), fx.fromInt(4)), fx.fromInt(1));
// Comfortably below the threshold — a piety-satisfied settler ignores the pray drive and works.
const PIOUS: Fixed = fx.div(ONE, fx.fromInt(2));

beforeEach(() => {
  for (const c of [
    Position,
    Settler,
    Resource,
    Building,
    Stockpile,
    Carrying,
    CurrentAtomic,
    MoveGoal,
    PathFollow,
    PathRequest,
    Production,
  ]) {
    c.store.clear();
  }
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

function settlerAt(
  sim: Simulation,
  x: number,
  y: number,
  piety: Fixed,
  fatigue = fx.fromInt(0),
  hunger = fx.fromInt(0),
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
    hunger,
    fatigue,
    piety,
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  return e;
}

function templeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: TEMPLE_TYPE, tribe: VIKING, built: ONE, level: 0 });
  return e;
}

function treeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
  return e;
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

describe('prayDrive — the planner choosing to pray (target-bound: walk to a temple)', () => {
  it('walks to the nearest temple when piety crosses the threshold (no atomic yet — must arrive)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    const temple = templeAt(sim, 4, 0);
    // A tree to harvest exists, but the devout settler heads for the temple instead.
    treeAt(sim, 2, 0);

    aiSystem(sim.world, ctxOf(sim));

    // Not on the temple yet: a MoveGoal to it, no atomic started.
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(sim.terrain?.cellAt(4, 0));
    // Temple is at (4,0); confirm the goal is the temple's cell, not the tree's.
    expect(sim.world.get(settler, MoveGoal).cell).toBe(
      sim.terrain?.cellAt(fx.toInt(sim.world.get(temple, Position).x), 0),
    );
  });

  it('starts a pray atomic (duration from content) once standing on the temple', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 3, 0, DEVOUT);
    templeAt(sim, 3, 0); // settler is already on the temple cell

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false); // already here — no walk
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(PRAY_ATOMIC);
    expect(atomic.duration).toBe(7); // viking setatomic 12 -> "viking_pray" length 7
    expect(atomic.effect).toEqual({ kind: 'pray' });
  });

  it('ignores the pray drive below the threshold (a satisfied settler works normally)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, PIOUS);
    templeAt(sim, 4, 0);
    treeAt(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    // Headed for the wood, not the temple — the pray drive did not fire.
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(sim.terrain?.cellAt(3, 0));
  });

  it('falls through to work when devout but no temple exists (piety has no satisfier)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    treeAt(sim, 3, 0); // wood but no temple anywhere

    aiSystem(sim.world, ctxOf(sim));

    // No temple to pray at: the settler works (heads for the tree) instead of stalling.
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(sim.terrain?.cellAt(3, 0));
  });

  it('sleeps before praying when both needs are over the threshold (sleep outranks pray)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    // Both devout AND tired; sleep is in place, so it resolves on the spot.
    const settler = settlerAt(sim, 3, 0, DEVOUT, DEVOUT);
    templeAt(sim, 3, 0);

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(8); // SLEEP — survival needs outrank devotion
    expect(atomic.effect.kind).toBe('sleep');
  });
});

describe('pray atomic — zeroing piety on completion (AtomicSystem)', () => {
  it('clears piety and consumes no goods', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, DEVOUT);
    sim.world.add(settler, CurrentAtomic, {
      atomicId: PRAY_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1, // completes the first tick
      effect: { kind: 'pray' },
      targetEntity: settler,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, Settler).piety).toBe(fx.fromInt(0)); // piety reset
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // atomic done
  });
});

describe('pray drive — closing the rise→pray→reset loop through the real schedule', () => {
  it('a settler grows devout, walks to the temple, prays, and its piety resets', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(4, 1) });
    // Start near the threshold so it crosses within a short headless run; temple a couple cells away.
    const settler = settlerAt(sim, 0, 0, fx.div(fx.fromInt(3), fx.fromInt(4)));
    templeAt(sim, 3, 0);

    let prayedAtLeastOnce = false;
    let peakPiety = sim.world.get(settler, Settler).piety;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const p = sim.world.get(settler, Settler).piety;
      if (p > peakPiety) peakPiety = p;
      // A reset to (near) zero after having been devout is the pray→reset signal.
      if (p < fx.div(ONE, fx.fromInt(4))) prayedAtLeastOnce = true;
    }

    expect(prayedAtLeastOnce).toBe(true); // the loop closed: piety rose, the settler prayed, it reset
    expect(peakPiety).toBeLessThanOrEqual(ONE); // never breached the pietyInRange ceiling
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const run = (): string => {
      for (const c of [
        Position,
        Settler,
        Building,
        Stockpile,
        Carrying,
        CurrentAtomic,
        MoveGoal,
        PathFollow,
        PathRequest,
      ]) {
        c.store.clear();
      }
      const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(4, 1) });
      settlerAt(sim, 0, 0, fx.div(fx.fromInt(3), fx.fromInt(4)));
      templeAt(sim, 3, 0);
      for (let i = 0; i < 400; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
