import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { BUILDING_TEMPLE } from '../../../../src/game/sandbox/ids/index.js';
import { buildingDef } from '../../../../src/hud/details-panel/model/context.js';
import { templeFireModel } from '../../../../src/hud/details-panel/model/temple-fire.js';
import { buildingEntity, sandboxCtx } from '../../../support/sandbox.js';

const TEMPLE = 100;
const BURN = systems.TEMPLE_FUEL_BURN_SECONDS;

describe('templeFireModel - the burning unit of a temple oil', () => {
  const ctx = sandboxCtx();
  const def = buildingDef(ctx, BUILDING_TEMPLE);
  const fuel = def?.stock[0]?.goodType ?? -1;
  const temple = (units: number, burnedSeconds: number, blessing: boolean) =>
    buildingEntity(TEMPLE, BUILDING_TEMPLE, {
      components: {
        Stockpile: { amounts: [[fuel, units]] },
        TempleFire: { burnedSeconds, blessing },
      },
    });

  it('empties the rule as the unit burns and counts the whole store down', () => {
    const quarter = BURN / 4;
    const model = templeFireModel(ctx, def, temple(3, quarter, true));
    expect(model).toMatchObject({ pct: 75, unitSecondsLeft: BURN - quarter, burning: true });
    expect(model?.storeSecondsLeft).toBe(3 * BURN - quarter);
  });

  it('shows an empty, unlit rule on a temple without oil', () => {
    expect(templeFireModel(ctx, def, temple(0, 0, false))).toMatchObject({
      pct: 0,
      unitSecondsLeft: 0,
      burning: false,
    });
  });

  it('shows nothing for a house that keeps no temple fire', () => {
    expect(templeFireModel(ctx, def, buildingEntity(TEMPLE, BUILDING_TEMPLE))).toBeNull();
  });
});
