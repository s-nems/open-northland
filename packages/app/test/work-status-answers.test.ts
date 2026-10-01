import { Simulation, type WorkStatus } from '@open-northland/sim';
import { expect, it, vi } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { SNAPSHOT_SWEEP_INTERVAL_TICKS } from '../src/hud/tool-panel/messages/from-snapshot.js';
import { WORK_STATUS_ASKS_PER_SWEEP } from '../src/hud/tool-panel/messages/work-asks.js';
import { inlineSessionHost } from '../src/session/inline-host.js';
import { createHostAnswers } from '../src/view/runtime/host-answers.js';

it('refreshes a nested ingredient shortage and clears a stale diagnosis when the answer lands', async () => {
  const sim = new Simulation({ seed: 1, content: sandboxContent() });
  const entity = sim.world.create();
  let answer: WorkStatus | undefined = {
    kind: 'waitingInput',
    goodType: 3,
    missingInputs: [{ goodType: 1, required: 3, available: 0, missing: 3, outOfReach: false }],
  };
  const read = vi.spyOn(sim, 'workStatus').mockImplementation(() => answer);
  const host = inlineSessionHost(sim);
  const answers = createHostAnswers(host, () => 1);
  try {
    expect(answers.workStatus(entity)).toBeUndefined();
    const initialVersion = answers.versions.unitPanel();
    await answers.settled();
    expect(answers.workStatus(entity)).toMatchObject({ missingInputs: [{ available: 0, missing: 3 }] });
    expect(answers.versions.unitPanel()).toBeGreaterThan(initialVersion);

    answer = {
      kind: 'waitingInput',
      goodType: 3,
      missingInputs: [{ goodType: 1, required: 3, available: 2, missing: 1, outOfReach: false }],
    };
    sim.step();
    answers.workStatus(entity);
    const beforeLanding = answers.versions.unitPanel();
    await answers.settled();
    expect(host.tick).toBe(1);
    expect(answers.workStatus(entity)).toMatchObject({ missingInputs: [{ available: 2, missing: 1 }] });
    expect(answers.versions.unitPanel()).toBeGreaterThan(beforeLanding);

    answer = undefined;
    sim.step();
    answers.workStatus(entity);
    const beforeClear = answers.versions.unitPanel();
    await answers.settled();
    expect(answers.workStatus(entity)).toBeUndefined();
    expect(answers.versions.unitPanel()).toBeGreaterThan(beforeClear);
  } finally {
    answers.dispose();
    read.mockRestore();
  }
});

it("keeps the notice sweeps' answers by ask across ticks and asks again only for a new ask", async () => {
  const sim = new Simulation({ seed: 1, content: sandboxContent() });
  const read = vi.spyOn(sim, 'workStatus').mockImplementation(() => undefined);
  const host = inlineSessionHost(sim);
  const answers = createHostAnswers(host, () => 1);
  // More workers than one sweep may ask about, read once a sweep as the notice sweeps do.
  const workers = Array.from({ length: 2 * WORK_STATUS_ASKS_PER_SWEEP }, (_, i) => i + 1);
  const ASKED = 0;
  try {
    expect(workers.map((entity) => answers.noticeWorkStatus(entity, ASKED))).toEqual(
      workers.map(() => undefined),
    );
    await answers.settled();
    for (let i = 0; i < SNAPSHOT_SWEEP_INTERVAL_TICKS; i++) sim.step();
    expect(workers.map((entity) => answers.noticeWorkStatus(entity, ASKED))).toEqual(
      workers.map(() => ({ status: undefined, asked: ASKED })),
    );
    expect(read).toHaveBeenCalledTimes(workers.length);
    answers.noticeWorkStatus(1, ASKED + SNAPSHOT_SWEEP_INTERVAL_TICKS);
    expect(read).toHaveBeenCalledTimes(workers.length + 1);
  } finally {
    answers.dispose();
    read.mockRestore();
  }
});
