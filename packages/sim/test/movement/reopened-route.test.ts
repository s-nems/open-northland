import { describe, expect, it } from 'vitest';
import {
  addPerson,
  MoveGoal,
  Owner,
  Palisade,
  PathFollow,
  PathRequest,
  Position,
  Stranded,
  UnreachableGoals,
} from '../../src/components/index.js';
import { fx, positionOfNode, Simulation } from '../../src/index.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/index.js';
import { pathfindingSystem } from '../../src/systems/movement/routing.js';
import { movementSystem } from '../../src/systems/movement/system.js';
import { placePalisade, setPalisadeGate } from '../../src/systems/palisades/index.js';
import { navigationPlanner } from '../../src/systems/settlers/planner/navigation.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf, nextTickCtxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

describe('pending failed routes', () => {
  it.each(['open', 'demolish', 'closed', 'unrelated'] as const)(
    'revalidates pending failure when topology changes: %s',
    (change) => {
      const span = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));
      const wall = { maxHitpoints: 100, repairPerStrike: 1, construction: [{ goodType: 5, amount: 1 }] };
      const sim = new Simulation({
        seed: 1,
        content: testContent(),
        map: {
          ...grassNodeMap(16, 16),
          landscapes: {
            placements: [],
            types: [
              { typeId: 691, walk: [{ dx: 0, dy: 0 }], build: [{ dx: 0, dy: 0 }], groups: [], wall },
              {
                typeId: 696,
                walk: span,
                build: span,
                groups: [],
                wall: {
                  ...wall,
                  gate: { open: false, counterpartGfxIndex: 700 },
                },
              },
              {
                typeId: 700,
                walk: [
                  { dx: -2, dy: 0 },
                  { dx: 2, dy: 0 },
                ],
                build: span,
                groups: [],
                wall: { ...wall, gate: { open: true, counterpartGfxIndex: 696 } },
              },
            ],
          },
        },
      });
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('expected terrain');
      for (let x = 0; x < 16; x++) {
        if (Math.abs(x - 8) <= 2) continue;
        placePalisade(sim.world, ctxOf(sim), {
          kind: 'placePalisade',
          gfxIndex: 691,
          x,
          y: 8,
          tribe: 1,
          owner: 0,
        });
      }
      placePalisade(sim.world, ctxOf(sim), {
        kind: 'placePalisade',
        gfxIndex: 696,
        x: 8,
        y: 8,
        tribe: 1,
        owner: 0,
      });
      const gate = [...sim.world.query(Palisade)].find((e) => sim.world.get(e, Palisade).gate !== null);
      if (gate === undefined) throw new Error('expected gate');
      const e = sim.world.create();
      addPerson(sim.world, e, {
        tribe: 1,
        jobType: 1,
        hunger: fx.fromInt(0),
        fatigue: fx.fromInt(0),
        piety: fx.fromInt(0),
        enjoyment: fx.fromInt(0),
      });
      sim.world.add(e, Owner, { player: 0 });
      sim.world.add(e, Position, positionOfNode(8, 2));
      const start = terrain.nodeAt(8, 2);
      const goal = terrain.nodeAt(8, 14);
      sim.world.add(e, MoveGoal, { cell: goal });
      navigationPlanner(sim.world, terrain);
      pathfindingSystem(sim.world, ctxOf(sim));
      expect(sim.world.get(e, PathRequest).failed).toBe(true);
      sim.step();
      expect(sim.world.has(e, Stranded)).toBe(true);
      if (change === 'open')
        expect(
          setPalisadeGate(sim.world, ctxOf(sim), { kind: 'setPalisadeGate', palisade: gate, open: true }),
        ).toBe(true);
      if (change === 'demolish') sim.enqueueSetup({ kind: 'demolishPalisade', palisade: gate });
      if (change === 'unrelated') {
        placePalisade(sim.world, ctxOf(sim), {
          kind: 'placePalisade',
          gfxIndex: 691,
          x: 1,
          y: 1,
          tribe: 1,
          owner: 0,
        });
        const other = [...sim.world.query(Palisade)].at(-1);
        if (other === undefined) throw new Error('wall');
        sim.enqueueSetup({ kind: 'demolishPalisade', palisade: other });
      }
      const opens = change === 'open' || change === 'demolish';
      let lost = false;
      for (let tick = 0; tick < 150; tick++) {
        sim.step();
        lost ||= sim.events.current().some((event) => event.kind === 'settlerLost' && event.entity === e);
      }
      expect(lost).toBe(!opens);
      expect(
        sim.world.tryGet(e, UnreachableGoals)?.entries.some((entry) => entry.cell === goal) ?? false,
      ).toBe(!opens);
      expect(
        findPath(terrain, start, goal, dynamicBlockOverlay(sim.world, ctxOf(sim), terrain)) !== null,
      ).toBe(opens);
      if (opens) expect(sim.world.get(e, Position)).toEqual(positionOfNode(8, 14));
      expect(sim.checkInvariants()).toEqual([]);
    },
  );
});

it('does not promote an ordinary retained route to a topology safe prefix on reopening', () => {
  const span = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));
  const wall = { maxHitpoints: 100, repairPerStrike: 1, construction: [{ goodType: 5, amount: 1 }] };
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: {
      ...grassNodeMap(16, 16),
      landscapes: {
        placements: [],
        types: [
          { typeId: 691, walk: [{ dx: 0, dy: 0 }], build: [{ dx: 0, dy: 0 }], groups: [], wall },
          {
            typeId: 696,
            walk: span,
            build: span,
            groups: [],
            wall: { ...wall, gate: { open: false, counterpartGfxIndex: 700 } },
          },
          {
            typeId: 700,
            walk: [
              { dx: -2, dy: 0 },
              { dx: 2, dy: 0 },
            ],
            build: span,
            groups: [],
            wall: { ...wall, gate: { open: true, counterpartGfxIndex: 696 } },
          },
        ],
      },
    },
  });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('terrain');
  for (let x = 0; x < 16; x++)
    if (Math.abs(x - 8) > 2)
      placePalisade(sim.world, ctxOf(sim), {
        kind: 'placePalisade',
        gfxIndex: 691,
        x,
        y: 8,
        tribe: 1,
        owner: 0,
      });
  placePalisade(sim.world, ctxOf(sim), {
    kind: 'placePalisade',
    gfxIndex: 696,
    x: 8,
    y: 8,
    tribe: 1,
    owner: 0,
  });
  const gate = [...sim.world.query(Palisade)].find((e) => sim.world.get(e, Palisade).gate !== null);
  if (gate === undefined) throw new Error('gate');
  const e = sim.world.create();
  addPerson(sim.world, e, {
    tribe: 1,
    jobType: 1,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: 0 });
  sim.world.add(e, Position, positionOfNode(2, 2));
  const oldGoal = terrain.nodeAt(14, 2);
  const newGoal = terrain.nodeAt(8, 14);
  sim.world.add(e, MoveGoal, { cell: oldGoal });
  navigationPlanner(sim.world, terrain);
  pathfindingSystem(sim.world, ctxOf(sim));
  movementSystem(sim.world, nextTickCtxOf(sim));
  movementSystem(sim.world, nextTickCtxOf(sim));
  sim.world.add(e, MoveGoal, { cell: newGoal });
  navigationPlanner(sim.world, terrain);
  pathfindingSystem(sim.world, ctxOf(sim));
  expect(sim.world.get(e, PathRequest).failed).toBe(true);
  expect(sim.world.get(e, PathRequest).retainRoute).toBeUndefined();
  expect(sim.world.has(e, PathFollow)).toBe(true);
  expect(
    setPalisadeGate(sim.world, ctxOf(sim), { kind: 'setPalisadeGate', palisade: gate, open: true }),
  ).toBe(true);
  const retry = { ...sim.world.get(e, PathRequest) };
  pathfindingSystem(sim.world, ctxOf(sim));
  let visitsOldGoal = false;
  for (let i = 0; i < 130; i++) {
    movementSystem(sim.world, nextTickCtxOf(sim));
    const p = sim.world.get(e, Position);
    const old = positionOfNode(14, 2);
    visitsOldGoal ||= p.x === old.x && p.y === old.y;
  }
  expect(retry.retainRoute).toBeUndefined();
  expect(visitsOldGoal).toBe(false);
  expect(sim.world.get(e, Position)).toEqual(positionOfNode(8, 14));
  expect(sim.checkInvariants()).toEqual([]);
});
