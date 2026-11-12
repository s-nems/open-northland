import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { BUILDING_TEMPLE } from '../../../../src/game/sandbox/ids/index.js';
import { buildingDef } from '../../../../src/hud/details-panel/model/context.js';
import { templeBlessing, templeFireModel } from '../../../../src/hud/details-panel/model/temple-fire.js';
import { buildingEntity, sandboxCtx } from '../../../support/sandbox.js';

const TEMPLE = 100;
const BURN = systems.TEMPLE_FUEL_BURN_SECONDS;

describe('templeFireModel - the burning unit of a temple oil', () => {
  const ctx = sandboxCtx();
  const def = buildingDef(ctx, BUILDING_TEMPLE);
  const fuel = def?.stock[0]?.goodType ?? -1;
  const temple = (units: number, burnedSeconds: number, blessing: boolean, doused = false) =>
    buildingEntity(TEMPLE, BUILDING_TEMPLE, {
      components: {
        Stockpile: { amounts: [[fuel, units]] },
        TempleFire: { burnedSeconds, blessing, doused },
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

  it('keeps the unit of a fire put out, unburning', () => {
    const half = BURN / 2;
    expect(templeFireModel(ctx, def, temple(2, half, false, true))).toMatchObject({
      pct: 50,
      burning: false,
      doused: true,
    });
    expect(templeBlessing(def, temple(2, half, false, true))).toEqual({ state: 'doused' });
  });

  it('shows nothing for a house that keeps no temple fire', () => {
    expect(templeFireModel(ctx, def, buildingEntity(TEMPLE, BUILDING_TEMPLE))).toBeNull();
  });
});
