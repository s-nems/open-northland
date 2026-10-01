import { Simulation } from '@open-northland/sim';
import { expect, it, vi } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { inlineSessionHost } from '../src/session/inline-host.js';
import { createHostAnswers } from '../src/view/runtime/host-answers.js';

const SEAT = 0;
const VIKING = 1;
const FRANK = 2;
const HOUSE = 7;

it("answers the seat's build nations a tick, its own alone until the sim's list lands", async () => {
  const sim = new Simulation({ seed: 1, content: sandboxContent() });
  let tribes: readonly number[] = [VIKING];
  const read = vi.spyOn(sim, 'buildTribes').mockImplementation(() => tribes);
  const answers = createHostAnswers(inlineSessionHost(sim), () => VIKING);
  try {
    expect(answers.buildTribes(SEAT)).toEqual([VIKING]);
    await answers.settled();
    const landed = answers.buildTribes(SEAT);
    expect(landed).toEqual([VIKING]);

    // An unchanged list keeps its identity across ticks, so the window's switch is not rebuilt.
    sim.step();
    answers.buildTribes(SEAT);
    await answers.settled();
    expect(answers.buildTribes(SEAT)).toBe(landed);

    tribes = [VIKING, FRANK];
    sim.step();
    answers.buildTribes(SEAT);
    await answers.settled();
    expect(answers.buildTribes(SEAT)).toEqual([VIKING, FRANK]);
  } finally {
    answers.dispose();
    read.mockRestore();
  }
});

it("asks a house's availability in the nation the window lists", async () => {
  const sim = new Simulation({ seed: 1, content: sandboxContent() });
  const status = vi.spyOn(sim, 'unlockStatus');
  const answers = createHostAnswers(inlineSessionHost(sim), () => VIKING);
  try {
    answers.buildAvailability(SEAT, HOUSE, FRANK);
    await answers.settled();
    expect(status.mock.calls).toEqual([['house', HOUSE, FRANK, SEAT]]);
  } finally {
    answers.dispose();
    status.mockRestore();
  }
});
