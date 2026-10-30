import { describe, expect, it } from 'vitest';
import { setMapPermission } from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import type { BuildOrderEntry } from '../../../../src/systems/computer-player/index.js';
import { buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BAKERY_TYPE,
  ctxOf,
  HOME_TYPE,
  oneLine,
  placeHq,
  SEAT,
  VIKING,
} from '../support.js';

/** The fixture's middle home tier, between `HOME_TYPE` and `HOME_TOP_TYPE`. */
const HOME_MIDDLE_TYPE = 3;

function placedType(steps: readonly BuildOrderEntry[], ban?: number): number | undefined {
  const sim = aiSim();
  placeHq(sim);
  sim.step();
  if (ban !== undefined)
    setMapPermission(sim.world, { player: SEAT, tribe: VIKING, kind: 'house', typeId: ban, allowed: false });
  const commands: readonly Command[] = buildOrderModule(oneLine(steps)).run(sim.world, ctxOf(sim), SEAT);
  const placed = commands.find((c) => c.kind === 'placeBuilding');
  return placed?.kind === 'placeBuilding' ? placed.buildingType : undefined;
}

describe('a placement raises the highest tier the seat may', () => {
  const bakery: BuildOrderEntry = { kind: 'place', building: 'work_bakery_00', count: 1 };

  it('places the enabled upper tier outright, the lower one while the upper is locked', () => {
    expect(placedType([bakery])).toBe(BAKERY_TOP_TYPE);
    expect(placedType([bakery], BAKERY_TOP_TYPE)).toBe(BAKERY_TYPE);
  });

  it('stays below the step cap', () => {
    expect(placedType([{ ...bakery, belowTier: 'work_bakery_01' }])).toBe(BAKERY_TYPE);
  });

  it('never jumps a locked tier of the chain', () => {
    expect(placedType([{ kind: 'place', building: 'home_level_00', count: 1 }], HOME_MIDDLE_TYPE)).toBe(
      HOME_TYPE,
    );
  });
});
