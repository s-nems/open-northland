import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { setMapPermission } from '../../../../../src/components/index.js';
import type { Command } from '../../../../../src/core/commands/index.js';
import type { BuildOrderEntry } from '../../../../../src/systems/computer-player/index.js';
import { buildOrderModule } from '../../../../../src/systems/computer-player/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
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
} from '../../support.js';

/** A third bakery tier over the fixture's two, so the chain has a middle tier to lock. */
const BAKERY_THIRD_TYPE = 92;

/** The fixture with {@link BAKERY_THIRD_TYPE} above its upper bakery. */
function threeTierBakeries(): ContentSet {
  const base = aiContent();
  const upper = base.buildings.find((b) => b.typeId === BAKERY_TOP_TYPE);
  if (upper === undefined) throw new Error('fixture: no upper bakery');
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings.map((b) =>
        b.typeId === BAKERY_TOP_TYPE ? { ...b, upgradeTarget: BAKERY_THIRD_TYPE } : b,
      ),
      { ...upper, typeId: BAKERY_THIRD_TYPE, id: 'work_bakery_02' },
    ],
  });
}

function placedType(
  steps: readonly BuildOrderEntry[],
  ban?: number,
  content: ContentSet = aiContent(),
): number | undefined {
  const sim = aiSim(1, content);
  placeHq(sim);
  sim.step();
  if (ban !== undefined)
    setMapPermission(sim.world, { player: SEAT, tribe: VIKING, kind: 'house', typeId: ban, allowed: false });
  const commands: readonly Command[] = buildOrderModule(oneLine(steps)).run(
    sim.world,
    { ...ctxOf(sim), content },
    SEAT,
  );
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
    const content = threeTierBakeries();
    expect(placedType([bakery], undefined, content)).toBe(BAKERY_THIRD_TYPE);
    expect(placedType([bakery], BAKERY_TOP_TYPE, content)).toBe(BAKERY_TYPE);
  });

  it("keeps a home step at its own tier, the housing lane's to pace", () => {
    expect(placedType([{ kind: 'place', building: 'home_level_00', count: 1 }])).toBe(HOME_TYPE);
  });
});
