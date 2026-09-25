import { expect, it } from 'vitest';
import { sandboxPalisadeTypes } from '../../src/game/sandbox/palisades.js';
import {
  firstTravellerCrossed,
  PALISADE_GATE_CLOSE_TICK,
  PALISADE_GATE_REOPEN_TICK,
  palisadeGateIsOpen,
  palisadeScene,
  secondTravellerCrossed,
} from '../../src/scenes/palisade.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(palisadeScene, import.meta.url);

it('uses the source repair deltas for wall and gate records', () => {
  const types = sandboxPalisadeTypes();
  expect(
    types.filter((type) => type.wall?.gate !== undefined).map((type) => type.wall?.repairPerStrike),
  ).toEqual([1, 1, 1, 1, 1, 1]);
  expect(
    types.filter((type) => type.wall?.gate === undefined).map((type) => type.wall?.repairPerStrike),
  ).toEqual([3, 3, 3, 3, 3, 3]);
});

it('places adjacent wall anchors through ordinary commands', () => {
  const sim = createSceneSim(palisadeScene);
  sim.step();

  const ordinaryPlacements = sim.commands.log
    .map((entry) => entry.command)
    .filter((command) => command.kind === 'placePalisade')
    .filter((command) => command.force !== true);
  expect(ordinaryPlacements.map((command) => [command.x, command.y])).toEqual([
    [30, 36],
    [31, 36],
    [32, 36],
  ]);
});

it('a closed gate holds the second traveller until the commanded reopen', () => {
  const sim = createSceneSim(palisadeScene);
  sim.run(PALISADE_GATE_CLOSE_TICK + 80);
  expect(firstTravellerCrossed(sim)).toBe(true);
  expect(palisadeGateIsOpen(sim)).toBe(false);
  expect(secondTravellerCrossed(sim)).toBe(false);

  sim.run(PALISADE_GATE_REOPEN_TICK + 270 - sim.tick);
  expect(palisadeGateIsOpen(sim)).toBe(true);
  expect(secondTravellerCrossed(sim)).toBe(true);
});
