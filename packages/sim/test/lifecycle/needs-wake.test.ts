import { describe, expect, it } from 'vitest';
import { SettlerNeeds, type SettlerNeedsState } from '../../src/components/index.js';
import {
  exportSaveGame,
  fx,
  ONE,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { NEED_SATED_THRESHOLD, needBar, needsSystem } from '../../src/systems/index.js';
import { nextBandTick } from '../../src/systems/lifecycle/needs/levels.js';
import { needsWakeOf } from '../../src/systems/lifecycle/needs/wake.js';
import { testContent } from '../fixtures/content.js';
import { fixtureTick, nextTickCtxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';

const WOODCUTTER = 1;
const CROWD = 20;
/** Reserve units short of the sated mark: a few passes from a band. */
const NEAR_UNITS = 10;
const SETTLED_TICKS = 5;

function settledSim(): { sim: Simulation; near: ReturnType<typeof settlerAt> } {
  const sim = new Simulation({ seed: 1, content: testContent() });
  for (let i = 0; i < CROWD; i++) settlerAt(sim, { jobType: WOODCUTTER });
  const near = settlerAt(sim, {
    jobType: WOODCUTTER,
    needs: { hunger: fx.sub(NEED_SATED_THRESHOLD, needBar(NEAR_UNITS)) },
  });
  for (let i = 0; i < SETTLED_TICKS; i++) needsSystem(sim.world, nextTickCtxOf(sim));
  return { sim, near };
}

describe('needs wake list', () => {
  it('visits only the settler whose bar reaches a band on that tick', () => {
    const { sim, near } = settledSim();
    const due = nextBandTick(sim.world.get(near, SettlerNeeds), fixtureTick(sim) + 1);
    while (fixtureTick(sim) < due - 1) {
      needsSystem(sim.world, nextTickCtxOf(sim));
      expect(sim.world.verifyCaches()).toEqual([]);
    }
    expect(needsWakeOf(sim.world).take(due, sim.content, false)).toEqual([near]);
  });

  it('reports a bar written past the change feed to the cache verifier', () => {
    const { sim, near } = settledSim();
    expect(sim.world.verifyCaches()).toEqual([]);
    (sim.world.get(near, SettlerNeeds) as SettlerNeedsState).hunger = ONE;
    expect(sim.world.verifyCaches()).toEqual([
      'needsWake: 1 band tick(s) diverge from the stored bars',
      'needsWake: 1 starving or critical mark(s) diverge from the stored bars',
    ]);
  });

  it('reports a drain class changed past the change feed to the cache verifier', () => {
    const { sim, near } = settledSim();
    (sim.world.get(near, SettlerNeeds) as SettlerNeedsState).drain = 'body';
    expect(sim.world.verifyCaches()).toContain('needsWake: 1 drain(s) diverge from the drain class');
  });
});

describe('needs wake visit order', () => {
  it('visits a tick in ascending id however the bars were rescheduled into it', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    for (let i = 0; i < CROWD; i++) settlerAt(sim, { jobType: WOODCUTTER });
    const late = settlerAt(sim, { jobType: WOODCUTTER });
    const early = settlerAt(sim, {
      jobType: WOODCUTTER,
      needs: { hunger: fx.sub(NEED_SATED_THRESHOLD, needBar(NEAR_UNITS)) },
    });
    for (let i = 0; i < SETTLED_TICKS; i++) needsSystem(sim.world, nextTickCtxOf(sim));
    // The lower id joins the bucket after the higher one, as bars that moved later do in a long game.
    Object.assign(sim.world.mut(late, SettlerNeeds), sim.world.get(early, SettlerNeeds));
    const due = nextBandTick(sim.world.get(early, SettlerNeeds), fixtureTick(sim) + 1);
    while (fixtureTick(sim) < due - 1) needsSystem(sim.world, nextTickCtxOf(sim));
    expect(sim.world.verifyCaches()).toEqual([]);
    expect(needsWakeOf(sim.world).take(due, sim.content, false)).toEqual([late, early]);
  });
});

describe('needs pass after a restore', () => {
  it('folds the same digest as the live world on a tick two settlers share', () => {
    const live = new Simulation({ seed: 1, content: testContent() });
    for (let i = 0; i < CROWD; i++) settlerAt(live, { jobType: WOODCUTTER });
    const late = settlerAt(live, { jobType: WOODCUTTER });
    const early = settlerAt(live, {
      jobType: WOODCUTTER,
      needs: { hunger: fx.sub(NEED_SATED_THRESHOLD, needBar(NEAR_UNITS)) },
    });
    live.run(SETTLED_TICKS);
    Object.assign(live.world.mut(late, SettlerNeeds), live.world.get(early, SettlerNeeds));
    const due = nextBandTick(live.world.get(early, SettlerNeeds), live.tick + 1);
    live.run(due - 1 - live.tick);
    // The live wake list stands with both settlers queued for `due`; the restored world rebuilds it.
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(live)))), {
      content: live.content,
    });
    live.setSyncDigest(true);
    restored.setSyncDigest(true);
    live.step();
    restored.step();
    expect(live.tick).toBe(due);
    expect(restored.syncDigest()?.domains).toEqual(live.syncDigest()?.domains);
    expect(restored.hashState()).toBe(live.hashState());
  });
});
