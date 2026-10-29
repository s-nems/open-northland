import { describe, expect, it } from 'vitest';
import { setMapPermission } from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Simulation } from '../../../../src/index.js';
import {
  type BuildOrder,
  type BuildOrderEntry,
  buildOrderModule,
  entryStatuses,
} from '../../../../src/systems/computer-player/index.js';
import {
  aiSim,
  ctxOf,
  HOME_TYPE,
  MILLER,
  placeHq,
  SEAT,
  technologyContent,
  VIKING,
  WELL_TYPE,
} from '../support.js';

const MILL_STEP: BuildOrderEntry = { kind: 'place', building: 'work_mill_00', count: 1 };
const HOME_STEP: BuildOrderEntry = { kind: 'place', building: 'home_level_00', count: 1 };
const WELL_STEP: BuildOrderEntry = { kind: 'place', building: 'work_well_00', count: 1 };

describe('technology reach', () => {
  it('skips a step whose discovery can never come, and waits on one that can', () => {
    const content = technologyContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.step();
    const ctx = { ...ctxOf(sim), content };
    // No farmer has earned the miller yet, but a farmer could: the step waits, not skipped.
    expect(entryStatuses(sim.world, ctx, SEAT, [MILL_STEP])).toEqual(['unmet']);
    banMiller(sim);
    expect(entryStatuses(sim.world, ctx, SEAT, [MILL_STEP])).toEqual(['skip']);
  });

  it("holds a locked step's line while its discovery can come, but never another line", () => {
    const content = technologyContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.step();
    const decide = (order: BuildOrder): PlayerCommand | undefined =>
      [...buildOrderModule(order).run(sim.world, { ...ctxOf(sim), content }, SEAT)][0];
    const bread: BuildOrder['lines'][number] = { id: 'bread', steps: [MILL_STEP, HOME_STEP] };
    // The mill waits on the miller a farmer could earn: its home waits behind it, the other line acts.
    expect(decide({ lines: [bread], priority: ['bread'] })).toBeUndefined();
    expect(
      decide({ lines: [bread, { id: 'homes', steps: [WELL_STEP] }], priority: ['bread', 'homes'] }),
    ).toMatchObject({ buildingType: WELL_TYPE });
    // A miller the map bans never comes: the mill is skipped and the line goes on.
    banMiller(sim);
    expect(decide({ lines: [bread], priority: ['bread'] })).toMatchObject({ buildingType: HOME_TYPE });
  });
});

function banMiller(sim: Simulation): void {
  setMapPermission(sim.world, { player: SEAT, tribe: VIKING, kind: 'job', typeId: MILLER, allowed: false });
}
