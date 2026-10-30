import { describe, expect, it } from 'vitest';
import { fx } from '../../../../src/core/fixed.js';
import {
  type GoodAccess,
  type SeatBrief,
  type SeatNeighbour,
  selectEconomy,
  type ZoneSums,
} from '../../../../src/systems/computer-player/index.js';

const HOME_LAND = 8_000;
const OWN_LAND = 0;
const OTHER_LAND = 1;

function sums(over: Partial<ZoneSums> = {}): ZoneSums {
  return {
    zones: 8,
    land: HOME_LAND,
    water: 0,
    free: 6_000,
    clearable: 1_000,
    blocked: 0,
    plantable: 5_000,
    fish: 0,
    deposits: new Map([
      ['stone', 1_000],
      ['mud', 1_000],
    ]),
    ...over,
  };
}

function neighbour(sameLand: boolean): SeatNeighbour {
  return { player: 1, anchor: { hx: 200, hy: 80 }, direction: 'e', distance: fx.fromInt(80), sameLand };
}

const HOME: GoodAccess = { access: 'home', zones: 1 };

/** A roomy seat sharing its land with one rival, iron, gold and mushroom at home and no fish. */
function seat(over: Partial<SeatBrief> = {}, access: Record<string, GoodAccess> = {}): SeatBrief {
  return {
    player: 0,
    anchor: { hx: 80, hy: 80 },
    zone: 0,
    component: OWN_LAND,
    home: sums(),
    near: sums({ zones: 30, land: 28_000, free: 16_000 }),
    continent: sums(),
    access: new Map(
      Object.entries({
        iron: HOME,
        gold: HOME,
        mushroom: HOME,
        fish: { access: 'none', zones: null },
        ...access,
      }),
    ),
    others: [neighbour(true)],
    ...over,
  };
}

describe('economic strategy selector', () => {
  it('reads a roomy shared start as standard with iron, gold and herbs', () => {
    expect(selectEconomy(seat())).toEqual({
      archetype: 'standard',
      sides: ['ironArms', 'goldLine', 'herbs'],
      evidence: ['ironInReach', 'goldAndMushroomOnLand', 'grassAtHome'],
    });
  });

  it('reads a start no rival shares, with rivals on other land, as islands', () => {
    expect(selectEconomy(seat({ component: OTHER_LAND, others: [neighbour(false)] })).archetype).toBe(
      'islands',
    );
  });

  it.each([
    ['homeFreeShareLow', { free: 4_500, land: HOME_LAND + 2_000 }],
    ['homeClearableDominant', { clearable: 4_000 }],
    ['homeRoomSmall', { free: 3_500, land: 6_000 }],
  ] as const)('reads %s as cramped', (rule, home) => {
    const choice = selectEconomy(seat({ home: sums(home) }));
    expect(choice.archetype).toBe('cramped');
    expect(choice.evidence).toContain(rule);
  });

  it('reads plenty of free ground and building deposits near as rich', () => {
    const near = sums({
      free: 22_000,
      deposits: new Map([
        ['stone', 3_000],
        ['mud', 1_500],
      ]),
    });
    expect(selectEconomy(seat({ near })).archetype).toBe('rich');
  });

  it('arms with iron or nature, never both, by how far the iron lies on its land', () => {
    const arms = (iron: GoodAccess) =>
      selectEconomy(seat({}, { iron })).sides.filter((s) => s.endsWith('Arms'));
    expect(arms({ access: 'near', zones: 2 })).toEqual(['ironArms']);
    expect(arms({ access: 'continent', zones: 4 })).toEqual(['ironArms']);
    expect(arms({ access: 'continent', zones: 8 })).toEqual(['naturalArms']);
    expect(arms({ access: 'overSea', zones: 1 })).toEqual(['naturalArms']);
  });
});
