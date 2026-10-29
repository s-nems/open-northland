import { describe, expect, it } from 'vitest';
import { setMapPermission } from '../../../../src/components/index.js';
import { type BuildOrderEntry, entryStatuses } from '../../../../src/systems/computer-player/index.js';
import { aiSim, ctxOf, MILLER, placeHq, SEAT, technologyContent, VIKING } from '../support.js';

const MILL_STEP: BuildOrderEntry = { kind: 'place', building: 'work_mill_00', count: 1 };

describe('technology reach', () => {
  it('skips a step whose discovery can never come, and waits on one that can', () => {
    const content = technologyContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.step();
    const ctx = { ...ctxOf(sim), content };
    // No farmer has earned the miller yet, but a farmer could: the step is passed over, not skipped.
    expect(entryStatuses(sim.world, ctx, SEAT, [MILL_STEP])).toEqual(['unmet']);
    setMapPermission(sim.world, { player: SEAT, tribe: VIKING, kind: 'job', typeId: MILLER, allowed: false });
    expect(entryStatuses(sim.world, ctx, SEAT, [MILL_STEP])).toEqual(['skip']);
  });
});
