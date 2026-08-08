import { describe, expect, it } from 'vitest';
import {
  Anger,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  HerdMember,
  Livestock,
  MoveGoal,
  Owner,
  PathRequest,
  Position,
  StayPoint,
  Stranded,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, fx, nodeOfPosition, positionOfNode, Simulation } from '../../src/index.js';
import {
  ANIMAL_SPACING_NODES,
  ANIMAL_WANDER_PERIOD_TICKS,
  ANIMAL_WANDER_STEP_NODES,
  animalWanderSystem,
  LIVESTOCK_GRAZE_LEASH_NODES,
  LIVESTOCK_WANDER_PERIOD_TICKS,
  manhattan,
} from '../../src/systems/index.js';
import { SYSTEM_ORDER } from '../../src/systems/schedule.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { addSettlerOfTribe } from '../fixtures/settler.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Tests for the AnimalWanderSystem, the grazing drive that stops spawned wildlife standing frozen.
 * Scenarios use the fixture bear (stayPointRange 6, see fixtures/content.ts) and all coordinates are
 * half-cell node coords.
 */

const BEAR = 10; // the fixture animal: stayPointRange 6, searchForLeader, maximumLeaderDistance 3
const BEE = 11; // a solitary fixture animal: no maximumDistanceToStayPoint at all
const STAY_RANGE = 6;
/** How far one step may aim from where the bear stands, the drive's own clamp against its territory. */
const STEP_BUDGET = Math.min(ANIMAL_WANDER_STEP_NODES, STAY_RANGE);
/** The fixture bear's `maximumLeaderDistance`, the herdingSystem cohesion radius. */
const LEADER_DISTANCE = 3;
/** Many roll periods over, so a frozen creature cannot pass by luck. */
const SETTLE_TICKS = 400;

/** An animal standing at half-cell node (x, y), anchored to a stay point at node `anchor`. */
function grazerAt(sim: Simulation, x: number, y: number, anchor = { x, y }, tribe = BEAR): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  addSettlerOfTribe(sim, e, {
    tribe,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
  sim.world.add(e, StayPoint, { cell: terrain.nodeAt(anchor.x, anchor.y) });
  return e;
}

/** Run the wander pass until it hands `e` a goal, up to `ticks` rolls. */
function rollUntilGoal(sim: Simulation, e: Entity, ticks = SETTLE_TICKS): boolean {
  for (let i = 0; i < ticks; i++) {
    animalWanderSystem(sim.world, ctxOf(sim));
    if (sim.world.has(e, MoveGoal)) return true;
  }
  return false;
}

describe('animalWanderSystem: the grazing drive', () => {
  it('eventually sends an idle animal to a node a step away', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const bear = grazerAt(sim, 10, 10);

    expect(rollUntilGoal(sim, bear)).toBe(true);
    const goal = sim.world.get(bear, MoveGoal).cell;
    // Within one step budget of where it stands (min(4, the bear's stayPointRange 6) = 4 nodes).
    expect(manhattan(terrain, goal, terrain.nodeAt(10, 10))).toBeLessThanOrEqual(STEP_BUDGET);
  });

  it('never aims past the territory leash (maximumDistanceToStayPoint from the anchor)', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(30, 30) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const anchorCell = terrain.nodeAt(15, 15);
    const bear = grazerAt(sim, 15, 15);

    // Every goal the drive hands out over a long run stays inside the leash, including the ones it
    // picks after earlier steps have already drifted the creature away from its anchor.
    for (let i = 0; i < 2000; i++) {
      animalWanderSystem(sim.world, ctxOf(sim));
      const goal = sim.world.tryGet(bear, MoveGoal);
      if (goal === undefined) continue;
      expect(manhattan(terrain, goal.cell, anchorCell)).toBeLessThanOrEqual(STAY_RANGE);
      // Teleport onto the goal and clear it, standing in for the walk the movement systems would run.
      const c = terrain.coordsOf(goal.cell);
      const p = sim.world.mut(bear, Position);
      const centre = positionOfNode(c.x, c.y);
      p.x = centre.x;
      p.y = centre.y;
      sim.world.remove(bear, MoveGoal);
    }
  });

  it('keeps a CLAIMED animal on the short grazing leash, not its species territory', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(30, 30) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const anchorCell = terrain.nodeAt(15, 15);
    // The fixture bear stands in for any claimed creature: the claim (Livestock + Owner), not the
    // species, is what shrinks the leash from its territory radius (6) to the grazing leash.
    const claimed = grazerAt(sim, 15, 15);
    sim.world.add(claimed, Livestock, {});
    sim.world.add(claimed, Owner, { player: 0 });

    let goals = 0;
    // Many calm-cadence periods over, so a frozen creature cannot pass by luck.
    for (let i = 0; i < 20 * LIVESTOCK_WANDER_PERIOD_TICKS; i++) {
      animalWanderSystem(sim.world, ctxOf(sim));
      const goal = sim.world.tryGet(claimed, MoveGoal);
      if (goal === undefined) continue;
      goals++;
      expect(manhattan(terrain, goal.cell, anchorCell)).toBeLessThanOrEqual(LIVESTOCK_GRAZE_LEASH_NODES);
      const c = terrain.coordsOf(goal.cell);
      const p = sim.world.mut(claimed, Position);
      const centre = positionOfNode(c.x, c.y);
      p.x = centre.x;
      p.y = centre.y;
      sim.world.remove(claimed, MoveGoal);
    }
    expect(goals).toBeGreaterThan(0); // it still grazes - the calm cadence idles, it doesn't freeze
  });

  it('sidesteps standers off a shared node - the lowest id keeps the spot, the rest fan out', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const shared = terrain.nodeAt(10, 10);
    const keeper = grazerAt(sim, 10, 10);
    const second = grazerAt(sim, 10, 10);
    const third = grazerAt(sim, 10, 10);

    animalWanderSystem(sim.world, ctxOf(sim)); // one pass: the sidestep is immediate, no rng roll

    expect(sim.world.has(keeper, MoveGoal)).toBe(false); // the keeper holds the spot
    const secondGoal = sim.world.get(second, MoveGoal).cell;
    const thirdGoal = sim.world.get(third, MoveGoal).cell;
    for (const goal of [secondGoal, thirdGoal]) {
      expect(manhattan(terrain, goal, shared)).toBeGreaterThanOrEqual(ANIMAL_SPACING_NODES);
      expect(manhattan(terrain, goal, shared)).toBeLessThanOrEqual(2);
    }
    // Distinct fields, not merely distinct nodes - the spots themselves hold the spacing.
    expect(manhattan(terrain, secondGoal, thirdGoal)).toBeGreaterThanOrEqual(ANIMAL_SPACING_NODES);
  });

  it('sidesteps an animal standing half a cell from another - adjacent nodes read as one field', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const keeper = grazerAt(sim, 10, 10);
    const crowding = grazerAt(sim, 11, 10); // Manhattan 1: inside the keeper's field

    animalWanderSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(keeper, MoveGoal)).toBe(false); // the keeper holds the field
    const goal = sim.world.get(crowding, MoveGoal).cell;
    expect(manhattan(terrain, goal, terrain.nodeAt(10, 10))).toBeGreaterThanOrEqual(ANIMAL_SPACING_NODES);
  });

  it("never grazes into a standing animal's field (the node or its half-cell surroundings)", () => {
    const sim = new Simulation({ seed: 11, content: testContent(), map: grassMap(30, 30) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    // The fixture BEE holds its node forever (no territory), a permanent stander in the bear's range.
    const post = grazerAt(sim, 12, 10, { x: 12, y: 10 }, BEE);
    const bear = grazerAt(sim, 10, 10);
    const postNode = terrain.nodeAt(12, 10);

    for (let i = 0; i < 2000; i++) {
      animalWanderSystem(sim.world, ctxOf(sim));
      expect(sim.world.has(post, MoveGoal)).toBe(false);
      const goal = sim.world.tryGet(bear, MoveGoal);
      if (goal === undefined) continue;
      expect(manhattan(terrain, goal.cell, postNode)).toBeGreaterThanOrEqual(ANIMAL_SPACING_NODES);
      const c = terrain.coordsOf(goal.cell);
      const p = sim.world.mut(bear, Position);
      const centre = positionOfNode(c.x, c.y);
      p.x = centre.x;
      p.y = centre.y;
      sim.world.remove(bear, MoveGoal);
    }
  });

  it('lets a creature displaced past its leash step back toward the anchor', () => {
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(30, 30) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const anchorCell = terrain.nodeAt(10, 10);
    // Pushed well past the 6-node leash: every in-range step is refused, so only a homeward one is left.
    const bear = grazerAt(sim, 24, 10, { x: 10, y: 10 });
    const startGap = manhattan(terrain, terrain.nodeAt(24, 10), anchorCell);

    expect(rollUntilGoal(sim, bear)).toBe(true);
    const goal = sim.world.get(bear, MoveGoal).cell;
    expect(manhattan(terrain, goal, anchorCell)).toBeLessThan(startGap);
  });

  it('leaves an animal with no territory (stayPointRange 0) standing', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
    // The fixture BEE is a solitary animal whose record sets no maximumDistanceToStayPoint.
    const bee = grazerAt(sim, 10, 10, { x: 10, y: 10 }, BEE);

    expect(rollUntilGoal(sim, bee)).toBe(false);
  });

  it('does not interrupt a creature mid-atomic or already travelling', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const busy = grazerAt(sim, 5, 5);
    sim.world.add(busy, CurrentAtomic, {
      atomicId: 1,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 4,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
    const travelling = grazerAt(sim, 12, 12);
    const elsewhere = terrain.nodeAt(14, 12);
    sim.world.add(travelling, MoveGoal, { cell: elsewhere });

    for (let i = 0; i < SETTLE_TICKS; i++) animalWanderSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(busy, MoveGoal)).toBe(false); // swing not interrupted
    expect(sim.world.get(travelling, MoveGoal).cell).toBe(elsewhere); // walk not re-aimed
  });

  it('holds a fight against the graze roll (an engaged, provoked or ordered creature is left alone)', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
    const engaged = grazerAt(sim, 5, 5);
    sim.world.add(engaged, Engagement, { repathAt: 0 });
    const provoked = grazerAt(sim, 12, 12);
    sim.world.add(provoked, Anger, { until: 10_000 });
    const ordered = grazerAt(sim, 16, 4);
    sim.world.add(ordered, AttackOrder, { target: engaged });

    for (let i = 0; i < SETTLE_TICKS; i++) animalWanderSystem(sim.world, ctxOf(sim));

    // combatSystem skips acquisition for a travelling unit, so a graze goal here would walk a
    // creature out of its own fight.
    expect(sim.world.has(engaged, MoveGoal)).toBe(false);
    expect(sim.world.has(provoked, MoveGoal)).toBe(false);
    expect(sim.world.has(ordered, MoveGoal)).toBe(false);
  });

  it('runs the herd recall ahead of the graze roll, so a strayed follower is never grazed away', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 30) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const leader = grazerAt(sim, 10, 10);
    sim.world.add(leader, HerdMember, { leader });
    const follower = grazerAt(sim, 20, 10); // 10 nodes out, past maximumLeaderDistance 3
    sim.world.add(follower, HerdMember, { leader });
    const leaderCell = terrain.nodeAt(10, 10);

    // Driven in the order SYSTEM_ORDER declares, so swapping the two slots fails this test rather than
    // silently changing behaviour: grazing first would hand this idle follower a step AWAY from its
    // leader on roughly one tick in ANIMAL_WANDER_PERIOD_TICKS, which over this many trials is certain.
    const drives = SYSTEM_ORDER.filter((s) => s.name === 'herding' || s.name === 'animalWander').map(
      (s) => s.system,
    );
    expect(drives).toHaveLength(2);
    expect(SETTLE_TICKS).toBeGreaterThan(ANIMAL_WANDER_PERIOD_TICKS);

    for (let i = 0; i < SETTLE_TICKS; i++) {
      for (const drive of drives) drive(sim.world, ctxOf(sim));
      // Recalled beside the leader (inside the cohesion radius), and grazing never re-aimed it.
      expect(manhattan(terrain, sim.world.get(follower, MoveGoal).cell, leaderCell)).toBeLessThanOrEqual(
        LEADER_DISTANCE,
      );
      sim.world.remove(follower, MoveGoal); // stand it back up, still out of range, for a fresh trial
    }
  });

  it('keeps a strayed follower closing on its leader over the real step() schedule', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(30, 30) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const leader = grazerAt(sim, 10, 10);
    sim.world.add(leader, HerdMember, { leader });
    const follower = grazerAt(sim, 20, 10); // 10 nodes out, past maximumLeaderDistance 3
    sim.world.add(follower, HerdMember, { leader });

    // The integration twin of the slot-order test above: through the real schedule the recall is not
    // only issued but routed and walked, and grazing does not undo it.
    let recalls = 0;
    for (let i = 0; i < SETTLE_TICKS; i++) {
      sim.step();
      const goal = sim.world.tryGet(follower, MoveGoal);
      if (goal !== undefined && manhattan(terrain, goal.cell, terrain.nodeAt(10, 10)) <= LEADER_DISTANCE) {
        recalls++;
      }
    }
    expect(recalls).toBeGreaterThan(0); // the recall actually ran
    // It closed on the leader instead of grazing off. The steady state is the cohesion radius plus one
    // graze step: herding recalls the follower inside the radius, and a later step can carry it back
    // out by at most the step budget before the next recall.
    const p = sim.world.get(follower, Position);
    const n = nodeOfPosition(p.x, p.y);
    expect(manhattan(terrain, terrain.nodeAtClamped(n.hx, n.hy), terrain.nodeAt(10, 10))).toBeLessThanOrEqual(
      LEADER_DISTANCE + STEP_BUDGET,
    );
  });

  it('walks every creature of a spawned herd off its birth point over a full step() schedule', () => {
    const sim = new Simulation({ seed: 9, content: testContent(), map: grassMap(30, 30) });
    const birth = cellAnchorNode(8, 8);
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: BEAR, x: birth.hx, y: birth.hy });
    sim.step(); // the command lands the herd (each member stamped with its StayPoint)

    const herd = [...sim.world.query(StayPoint, Position)];
    expect(herd.length).toBeGreaterThan(0);
    // Tracked ACROSS the run, not sampled at the end: grazing is undirected, so a creature can walk a
    // loop and be standing back on its birth node when the last tick lands.
    const everMoved = new Set<Entity>();
    for (let i = 0; i < SETTLE_TICKS; i++) {
      sim.step();
      for (const e of herd) {
        const p = sim.world.get(e, Position);
        const n = nodeOfPosition(p.x, p.y);
        if (sim.terrain?.nodeAtClamped(n.hx, n.hy) !== sim.world.get(e, StayPoint).cell) everMoved.add(e);
      }
    }
    expect(everMoved.size).toBe(herd.length); // every creature roamed, none stayed frozen
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('two same-seed runs graze identically (seeded rng only)', () => {
    const run = (): string => {
      const sim = new Simulation({ seed: 21, content: testContent(), map: grassMap(30, 30) });
      const birth = cellAnchorNode(8, 8);
      sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: BEAR, x: birth.hx, y: birth.hy });
      for (let i = 0; i < 200; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('a creature whose route the router refused', () => {
  it('sheds the dead route and grazes again - wildlife runs the same stranded recovery as a settler', () => {
    // The grazing and herding drives both skip a travelling creature, and nothing on the nav side
    // retries a failed request, so the planner's stale-intent janitor is what un-parks the animal
    // (`settlers/planner/replan.ts`). It sweeps `Settler`, not `Person`: a creature left out of that
    // sweep would stand frozen for the rest of the game.
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(20, 20) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture sim needs a terrain graph');
    const bear = grazerAt(sim, 10, 10);
    sim.world.add(bear, MoveGoal, { cell: terrain.nodeAt(12, 10) });
    sim.world.add(bear, PathRequest, {
      start: terrain.nodeAt(10, 10),
      goal: terrain.nodeAt(12, 10),
      failed: true,
    });

    // Well past the planner's stranded retry window, so the park-then-shed has had its turn.
    for (let i = 0; i < SETTLE_TICKS; i++) sim.step();

    expect(sim.world.has(bear, PathRequest)).toBe(false);
    expect(sim.world.has(bear, Stranded)).toBe(false);
  });
});
