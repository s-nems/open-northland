import { beforeEach, describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  Health,
  HerdMember,
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Settler,
  Velocity,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation, type TerrainMap, fx } from '../../src/index.js';
import { type SystemContext, herdingSystem } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Tests for the HerdingSystem — the follow-the-leader movement drive. A herding animal carries a
 * `HerdMember` pointing at its pack's leader (set at spawn by `spawnAnimalHerd`); a strayed follower
 * (farther than `maximumleaderdistance` from its leader) is sent back via a `MoveGoal` toward the
 * leader's cell. The leader itself (leader === self) and a solitary animal (no `HerdMember`) run no
 * drive. The fixture's BEAR (tribe 10) has `maximumLeaderDistance` 3 (see fixtures/content.ts).
 */

const BEAR = 10; // herd animal: searchForLeader, maximumLeaderDistance 3
const LEADER_DISTANCE = 3; // the fixture bear's maximumLeaderDistance

beforeEach(() => {
  Position.store.clear();
  Settler.store.clear();
  Health.store.clear();
  HerdMember.store.clear();
  CurrentAtomic.store.clear();
  MoveGoal.store.clear();
  PathFollow.store.clear();
  PathRequest.store.clear();
  Velocity.store.clear();
});

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(0) };
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

/** A herd animal at (x,y) following `leader` (or itself, the leader marker). */
function herderAt(sim: Simulation, x: number, y: number, leader: Entity | 'self'): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: BEAR,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, HerdMember, { leader: leader === 'self' ? e : leader });
  return e;
}

describe('herdingSystem — follow-the-leader cohesion', () => {
  it('sends a strayed follower back toward the leader cell with a MoveGoal', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const leader = herderAt(sim, 0, 0, 'self');
    const follower = herderAt(sim, 8, 0, leader); // 8 cells away — beyond maximumLeaderDistance 3

    herdingSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(follower, MoveGoal)).toBe(true);
    const goalCell = sim.world.get(follower, MoveGoal).cell;
    expect(goalCell).toBe(sim.terrain?.cellAt(0, 0)); // heading to the leader's cell
    expect(sim.world.has(leader, MoveGoal)).toBe(false); // the leader follows no one
  });

  it('leaves a follower already within maximumLeaderDistance alone (no MoveGoal)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const leader = herderAt(sim, 0, 0, 'self');
    const follower = herderAt(sim, LEADER_DISTANCE, 0, leader); // exactly at the radius — close enough

    herdingSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(follower, MoveGoal)).toBe(false);
  });

  it('the leader itself never gets a follow MoveGoal (leader === self)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const leader = herderAt(sim, 5, 0, 'self');

    herdingSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(leader, MoveGoal)).toBe(false);
  });

  it('does not interrupt a follower mid-atomic or already travelling', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const leader = herderAt(sim, 0, 0, 'self');
    const busy = herderAt(sim, 8, 0, leader);
    sim.world.add(busy, CurrentAtomic, {
      atomicId: 1,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 4,
      effect: null,
      targetEntity: null,
      targetTile: null,
    });
    const travelling = herderAt(sim, 9, 0, leader);
    sim.world.add(travelling, MoveGoal, { cell: sim.terrain?.cellAt(2, 0) ?? 0 }); // already headed elsewhere

    herdingSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(busy, CurrentAtomic)).toBe(true); // swing not interrupted
    // The pre-existing goal is untouched (not re-pointed at the leader).
    expect(sim.world.get(travelling, MoveGoal).cell).toBe(sim.terrain?.cellAt(2, 0));
  });

  it('does nothing if the leader has been reaped (no Position to return to)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const leader = herderAt(sim, 0, 0, 'self');
    const follower = herderAt(sim, 8, 0, leader);
    sim.world.destroy(leader); // leader killed — its components are gone

    expect(() => herdingSystem(sim.world, ctxOf(sim))).not.toThrow();
    expect(sim.world.has(follower, MoveGoal)).toBe(false); // nowhere to go
  });

  it('over a full step() schedule, a strayed follower walks back toward its leader', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 1) });
    const leader = herderAt(sim, 0, 0, 'self');
    const follower = herderAt(sim, 10, 0, leader); // far out

    const startX = fx.toInt(sim.world.get(follower, Position).x);
    // ~7 tiles back into the radius at the ⅛ tile/tick pace = ~56 move ticks + plan/path latency.
    for (let i = 0; i < 80; i++) sim.step(); // herding -> navigation -> pathfinding -> movement
    const endX = fx.toInt(sim.world.get(follower, Position).x);

    expect(endX).toBeLessThan(startX); // moved back toward the leader at (0,0)
    // It comes to rest within the cohesion radius and stops (no perpetual jitter).
    expect(endX).toBeLessThanOrEqual(LEADER_DISTANCE);
  });

  it('two same-seed runs herd identically (deterministic — no RNG)', () => {
    const run = (): string => {
      Position.store.clear();
      Settler.store.clear();
      HerdMember.store.clear();
      MoveGoal.store.clear();
      PathRequest.store.clear();
      PathFollow.store.clear();
      const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(20, 1) });
      const leader = herderAt(sim, 0, 0, 'self');
      herderAt(sim, 10, 0, leader);
      for (let i = 0; i < 12; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
