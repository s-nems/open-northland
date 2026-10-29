import { describe, expect, it } from 'vitest';
import { Simulation } from '../../../../src/index.js';
import type { Trigger } from '../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import {
  ASSUMED_PEACE_TICKS,
  earliestDeadline,
  peaceDeadlineTick,
} from '../../../../src/systems/computer-player/military/deadline.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';
import { makeAiSeat, placeHq, SEAT } from '../support.js';

const LOBBY_PEACE_END = 1000;
const PEACE_END = 50_000;

describe('military deadline', () => {
  it('ends the peace at the seat lobby peace, else after the assumed peace', () => {
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(64, 32) });
    makeAiSeat(sim, SEAT);
    placeHq(sim);
    sim.step();
    expect(peaceDeadlineTick(sim.world, SEAT)).toBe(ASSUMED_PEACE_TICKS);
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: LOBBY_PEACE_END, players: [SEAT] });
    sim.step();
    expect(peaceDeadlineTick(sim.world, SEAT)).toBe(LOBBY_PEACE_END);
  });

  it('moves to the first forecast attack before the peace ends, past or ahead', () => {
    const exact: Trigger = { kind: 'atTick', tick: PEACE_END / 2, repeats: false };
    const window: Trigger = { kind: 'window', fromTick: PEACE_END / 4, toTick: PEACE_END, repeats: false };
    const later: Trigger = { kind: 'atTick', tick: 2 * PEACE_END, repeats: false };
    const waits: Trigger = { kind: 'conditional', match: 'all', conditions: [] };
    expect(earliestDeadline(PEACE_END, [later, waits])).toBe(PEACE_END);
    expect(earliestDeadline(PEACE_END, [exact, later])).toBe(PEACE_END / 2);
    expect(earliestDeadline(PEACE_END, [exact, window])).toBe(PEACE_END / 4);
  });
});
