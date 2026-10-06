import { expect, it } from 'vitest';
import {
  Engagement,
  Health,
  MoveGoal,
  PathFollow,
  PathRequest,
  PathRoute,
  PlayerOrder,
  Weapon,
} from '../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  serializeSaveGame,
} from '../../src/index.js';
import { fighterAt } from '../conflict/melee-engagement/support.js';
import { COUNT, DESTINATION_SHIFT, geometry, makeArmy, report, translated } from './army-geometry/support.js';

it.each(['moveUnitGroup', 'attackMoveUnitGroup'] as const)(
  'keeps a 1000-soldier %s spread through an open march and distinct arrival slots',
  (kind) => {
    const { sim, members } = makeArmy(false);
    const reports = [geometry(sim, translated(members))];
    sim.enqueue(
      playerCommand(0, {
        kind,
        members: translated(members),
      }),
    );
    sim.step();
    expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toHaveLength(0);
    expect(members.filter(({ entity }) => sim.world.has(entity, PathFollow))).toHaveLength(COUNT);
    const goalNodes = members.map(({ entity }) => sim.world.get(entity, PathRoute).waypoints.at(-1)?.node);
    expect(new Set(goalNodes).size).toBe(COUNT);
    for (const tick of [128, 512, 1024, 2048]) {
      while (sim.tick < tick) sim.step();
      reports.push(geometry(sim, translated(members)));
    }
    report(kind, reports);
    expect(reports[0]?.nearPairs).toBe(0);
    expect(reports[0]?.exactStacked).toBe(0);
    expect(reports[2]?.width90).toBeGreaterThan((reports[0]?.width90 ?? 0) * 0.8);
    expect(reports[2]?.nearPairs).toBe(0);
    expect(reports.at(-1)?.arrived).toBe(COUNT);
    expect(reports.at(-1)?.exactStacked).toBe(0);
    expect(reports.at(-1)?.nearPairs).toBe(0);
  },
);

it('lets 1000 soldiers narrow through a gap and recover distinct destination slots', () => {
  const { sim, members } = makeArmy(true);
  const reports = [geometry(sim, translated(members))];
  sim.enqueue(
    playerCommand(0, {
      kind: 'attackMoveUnitGroup',
      members: translated(members),
    }),
  );
  sim.step();
  expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toHaveLength(0);
  expect(members.filter(({ entity }) => sim.world.has(entity, PathFollow))).toHaveLength(COUNT);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('army terrain missing');
  for (const { entity, x, y } of members) {
    const stops = sim.world.get(entity, PathRoute).waypoints;
    expect(stops.at(-1)?.node).toBe(terrain.nodeAt(x + DESTINATION_SHIFT, y));
    // Diagonal pacing stops name a node whose centre is elsewhere; only actual lattice centres
    // describe the path's crossings, as opposed to movement timing annotations.
    const crossing = stops.filter(({ node, x: px, y: py }) => {
      const centre = positionOfNode(terrain.xOf(node), terrain.yOf(node));
      return terrain.xOf(node) === 150 && px === centre.x && py === centre.y;
    });
    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.every(({ node }) => terrain.yOf(node) >= 52 && terrain.yOf(node) <= 64)).toBe(true);
  }
  for (const tick of [512, 1024, 2048, 4096]) {
    while (sim.tick < tick) sim.step();
    reports.push(geometry(sim, translated(members)));
  }
  report('gap', reports);
  expect(reports.at(-1)?.arrived).toBe(COUNT);
  expect(reports.at(-1)?.exactStacked).toBe(0);
  expect(reports.at(-1)?.nearPairs).toBe(0);
});

it('redirects a marching 1000-soldier army without retaining the old shared lane', () => {
  const { sim, members } = makeArmy(false);
  sim.enqueue(
    playerCommand(0, {
      kind: 'attackMoveUnitGroup',
      members: translated(members),
    }),
  );
  while (sim.tick < 256) sim.step();
  const reports = [geometry(sim, translated(members))];
  const redirected = translated(members, 100, 48);
  sim.enqueue(
    playerCommand(0, {
      kind: 'attackMoveUnitGroup',
      members: redirected,
    }),
  );
  sim.step();
  expect(members.filter(({ entity }) => sim.world.has(entity, PathRequest))).toHaveLength(0);
  for (const { entity, x, y } of redirected) {
    const goal = sim.terrain?.nodeAt(x, y);
    expect(sim.world.get(entity, MoveGoal).cell).toBe(goal);
    expect(sim.world.get(entity, PathRoute).waypoints.at(-1)?.node).toBe(goal);
  }
  for (const tick of [512, 1024, 2048]) {
    while (sim.tick < tick) sim.step();
    reports.push(geometry(sim, redirected));
  }
  report('redirect', reports);
  expect(reports.at(-1)?.arrived).toBe(COUNT);
  expect(reports.at(-1)?.exactStacked).toBe(0);
});

it('continues a saved 256-soldier march and redirect identically after rebuilding movement caches', () => {
  const { sim, members, map } = makeArmy(true, 256);
  sim.enqueue(playerCommand(0, { kind: 'attackMoveUnitGroup', members: translated(members) }));
  sim.run(128);
  const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
  const restored = restoreSimulation(save, { content: sim.content, map });
  expect(restored.hashState()).toBe(sim.hashState());
  for (const world of [sim, restored]) {
    world.run(16);
    world.enqueue(
      playerCommand(0, {
        kind: 'attackMoveUnitGroup',
        members: translated(members, 120, 48),
      }),
    );
    world.run(48);
  }
  expect(restored.hashState()).toBe(sim.hashState());
});

it('keeps each original destination when a 128-soldier attack-move group meets an enemy and resumes', () => {
  const { sim, members } = makeArmy(false, 128);
  for (const { entity } of members) {
    sim.world.add(entity, Health, { hitpoints: 1000, max: 1000 });
    sim.world.add(entity, Weapon, { weaponTypeId: 7 });
  }
  const enemy = fighterAt(sim, 45, 5, 1, 1, { owner: 1, hitpoints: 1000 });
  const destinations = translated(members);
  sim.enqueue(playerCommand(0, { kind: 'attackMoveUnitGroup', members: destinations }));
  sim.run(2);
  const engaged = destinations.filter(({ entity }) => sim.world.has(entity, Engagement));
  expect(engaged.length).toBeGreaterThan(0);
  for (const { entity, x, y } of engaged)
    expect(sim.world.get(entity, PlayerOrder).attackMove?.goal).toBe(sim.terrain?.nodeAt(x, y));
  sim.world.mut(enemy, Health).hitpoints = 0;
  sim.run(5);
  for (const { entity, x, y } of engaged) {
    expect(sim.world.has(entity, Engagement)).toBe(false);
    expect(sim.world.get(entity, MoveGoal).cell).toBe(sim.terrain?.nodeAt(x, y));
    expect(sim.world.get(entity, PathRoute).waypoints.at(-1)?.node).toBe(sim.terrain?.nodeAt(x, y));
  }
});
