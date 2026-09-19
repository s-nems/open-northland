import { describe, expect, it } from 'vitest';
import {
  AI_MODULE_IDS,
  type AiModuleId,
  type DiplomacyState,
  diplomacyStance,
  setDiplomacyLock,
} from '../../src/components/index.js';
import { Simulation } from '../../src/index.js';
import { AI_HANDLER_ROUND_TICKS } from '../../src/systems/ai-player/cadence.js';
import { grassMap } from '../conflict/melee-engagement/support.js';
import { testContent } from '../fixtures/content.js';

/**
 * A computer seat's answer to another player's stance toward it, one slot per handler turn: the seat on
 * slot 1 looks at slot 0 on round 0, at slot 2 on round 2, and at itself on no round.
 */

const HUMAN = 0;
const COMPUTER = 1;
const THIRD = 2;
/** The rounds in which the computer's cursor has reached the third slot. */
const ROUNDS_TO_THIRD = 3;

function stances(
  rows: readonly { from: number; to: number; state: DiplomacyState }[],
  ai: { scripted?: boolean; modules?: Partial<Record<AiModuleId, boolean>> } = {},
): Simulation {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
  sim.enqueueSetup({ kind: 'setPlayerAi', player: COMPUTER, enabled: true, ...ai });
  for (const row of rows) sim.enqueueSetup({ kind: 'setDiplomacy', ...row });
  return sim;
}

describe('the computer seat answering a stance', () => {
  it('turns a neutral seat enemy toward a player that declared it an enemy', () => {
    const sim = stances([
      { from: COMPUTER, to: HUMAN, state: 'neutral' },
      { from: HUMAN, to: COMPUTER, state: 'enemy' },
    ]);
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('enemy');
  });

  it("lowers a friendly seat to the other's stance, and keeps a friendship both sides hold", () => {
    const lowered = stances([
      { from: COMPUTER, to: HUMAN, state: 'friend' },
      { from: HUMAN, to: COMPUTER, state: 'neutral' },
    ]);
    const kept = stances([
      { from: COMPUTER, to: HUMAN, state: 'friend' },
      { from: HUMAN, to: COMPUTER, state: 'friend' },
    ]);
    lowered.run(AI_HANDLER_ROUND_TICKS);
    kept.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(lowered.world, COMPUTER, HUMAN)).toBe('neutral');
    expect(diplomacyStance(kept.world, COMPUTER, HUMAN)).toBe('friend');
  });

  it('never makes peace from an enemy stance, and leaves a neutral seat neutral toward a neutral player', () => {
    const sim = stances([
      { from: COMPUTER, to: HUMAN, state: 'enemy' },
      { from: HUMAN, to: COMPUTER, state: 'friend' },
      { from: COMPUTER, to: THIRD, state: 'neutral' },
      { from: THIRD, to: COMPUTER, state: 'neutral' },
    ]);
    sim.run(ROUNDS_TO_THIRD * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('enemy');
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('neutral');
  });

  it('looks at one slot per turn and answers past a lock', () => {
    const sim = stances([
      { from: COMPUTER, to: THIRD, state: 'neutral' },
      { from: THIRD, to: COMPUTER, state: 'enemy' },
    ]);
    setDiplomacyLock(sim.world, COMPUTER, THIRD, true);
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('neutral'); // round 0 looked at slot 0
    sim.run((ROUNDS_TO_THIRD - 1) * AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, THIRD)).toBe('enemy');
  });

  it.each([
    ['its whole AI (`AI_Disable`)', { scripted: false }],
    [
      'its strategic handler (`HAI_Disable`)',
      { modules: Object.fromEntries(AI_MODULE_IDS.map((id) => [id, false])) },
    ],
  ])('stays silent on a seat whose map disabled %s', (_, ai) => {
    const sim = stances(
      [
        { from: COMPUTER, to: HUMAN, state: 'neutral' },
        { from: HUMAN, to: COMPUTER, state: 'enemy' },
      ],
      ai,
    );
    sim.run(AI_HANDLER_ROUND_TICKS);
    expect(diplomacyStance(sim.world, COMPUTER, HUMAN)).toBe('neutral');
  });
});
