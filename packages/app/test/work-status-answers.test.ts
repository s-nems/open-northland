import { Simulation, type WorkStatus } from '@open-northland/sim';
import { expect, it, vi } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { inlineSessionHost } from '../src/session/inline-host.js';
import { createHostAnswers } from '../src/view/runtime/host-answers.js';

it('refreshes a nested ingredient shortage and clears a stale diagnosis when the answer lands', async () => {
  const sim = new Simulation({ seed: 1, content: sandboxContent() });
  const entity = sim.world.create();
  let answer: WorkStatus | undefined = {
    kind: 'waitingInput',
    goodType: 3,
    missingInputs: [{ goodType: 1, required: 3, available: 0, missing: 3 }],
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
      missingInputs: [{ goodType: 1, required: 3, available: 2, missing: 1 }],
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
