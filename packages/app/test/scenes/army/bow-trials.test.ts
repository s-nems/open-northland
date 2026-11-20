import {
  adminCommand,
  components,
  nodeOfPosition,
  playerCommand,
  type Simulation,
} from '@open-northland/sim';
import { expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../../src/game/rules.js';
import {
  BOW_TRIAL_ARENAS,
  bowTrialArenaAt,
  bowTrialsScene,
  startEveryArena,
} from '../../../src/scenes/army/bow-trials.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { sceneAcceptance } from '../scene-case.js';

sceneAcceptance(bowTrialsScene, import.meta.url);

/** Long enough for the slowest opening, short bows walking up to a catapult, to land its first blows. */
const FIGHT_TICKS = 480;

const { Health, Position, Settler } = components;

/** Per arena: its living settlers, and whether anything on its ground is wounded. */
function tally(sim: Simulation): { living: number[]; wounded: boolean[] } {
  const living = BOW_TRIAL_ARENAS.map(() => 0);
  const wounded = BOW_TRIAL_ARENAS.map(() => false);
  for (const e of sim.world.query(Health, Position)) {
    const health = sim.world.get(e, Health);
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    const arena = bowTrialArenaAt(node.hx, node.hy);
    if (arena === null || health.hitpoints <= 0) continue;
    if (sim.world.has(e, Settler)) living[arena] = (living[arena] ?? 0) + 1;
    if (health.hitpoints < health.max) wounded[arena] = true;
  }
  return { living, wounded };
}

it('starts a fight on every arena from the overview button', { timeout: 300_000 }, () => {
  const sim = createSceneSim(bowTrialsScene);
  sim.run(bowTrialsScene.runTicks);
  const before = tally(sim);
  for (const order of startEveryArena(sim.snapshot())) {
    sim.enqueue(
      order.by === 'viewer' ? playerCommand(HUMAN_PLAYER, order.command) : adminCommand(order.command),
    );
  }
  sim.run(FIGHT_TICKS);
  const after = tally(sim);
  const quiet = BOW_TRIAL_ARENAS.filter(
    (_, i) => !after.wounded[i] && after.living[i] === before.living[i],
  ).map((a) => a.id);
  expect(quiet).toEqual([]);
});
