import {
  cellAnchorNode,
  components,
  fx,
  HALF_COLUMN,
  playerCommand,
  worldDistance,
} from '@open-northland/sim';
import { expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { movementContinuityScene } from '../../src/scenes/movement-continuity.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(movementContinuityScene, import.meta.url);

it('keeps a moving diagonal walker at its actual position through rapid orders', () => {
  const sim = createSceneSim(movementContinuityScene);
  const { MoveGoal, Owner, Position, Settler } = components;
  const walker = [...sim.world.query(Owner, Position, Settler)].find((e) => {
    const p = sim.world.get(e, Position);
    return p.x === fx.fromInt(3) && p.y === fx.fromInt(14);
  });
  expect(walker).toBeDefined();
  if (walker === undefined) return;

  sim.run(18);
  const targets = [
    cellAnchorNode(25, 16),
    cellAnchorNode(23, 4),
    cellAnchorNode(27, 15),
    cellAnchorNode(22, 5),
    cellAnchorNode(25, 16),
  ];
  const maxWalkDelta = fx.add(fx.div(HALF_COLUMN, fx.fromInt(3)), fx.div(fx.fromInt(1), fx.fromInt(100)));
  for (const target of targets) {
    const before = { ...sim.world.get(walker, Position) };
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, { kind: 'moveUnit', entity: walker, x: target.hx, y: target.hy }),
    );
    sim.step();
    const after = sim.world.get(walker, Position);
    expect(worldDistance(before.x, before.y, after.x, after.y)).toBeLessThanOrEqual(maxWalkDelta);
    expect(sim.world.get(walker, MoveGoal).cell).toBe(sim.terrain?.nodeAt(target.hx, target.hy));
  }
  const afterRetargets = { ...sim.world.get(walker, Position) };
  sim.run(120);
  const later = sim.world.get(walker, Position);
  expect(worldDistance(afterRetargets.x, afterRetargets.y, later.x, later.y)).toBeGreaterThan(fx.fromInt(1));
});
