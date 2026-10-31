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

/** Iron and gold plentiful but short of rich. */
function nearDeposits(iron = 2_400, gold = 1_200): ReadonlyMap<string, number> {
  return new Map([
    ['stone', 1_000],
    ['mud', 1_000],
    ['iron', iron],
    ['gold', gold],
  ]);
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
    near: sums({ zones: 30, land: 28_000, free: 16_000, deposits: nearDeposits() }),
    continent: sums({ zones: 180, land: 170_000, free: 85_000 }),
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

  it('judges the room of a seat on its whole land, island or not', () => {
    const land = (free: number, island: boolean) =>
      selectEconomy(
        seat({
          continent: sums({ free }),
          ...(island ? { component: OTHER_LAND, others: [neighbour(false)] } : {}),
        }),
      );
    const islet = land(4_000, true);
    expect(islet.archetype).toBe('islands');
    expect(islet.sides).toContain('noRoom');
    expect(islet.evidence).toContain('landRoomSmall');
    expect(land(4_000, false).sides).toContain('noRoom');
    expect(land(30_000, true).sides).not.toContain('noRoom');
  });

  it('reads free ground with iron and gold to spare as rich', () => {
    const rich = (free: number, iron: number, gold: number) =>
      selectEconomy(seat({ near: sums({ free, deposits: nearDeposits(iron, gold) }) })).archetype;
    expect(rich(14_000, 2_600, 2_600)).toBe('rich');
    expect(rich(10_000, 2_600, 2_600)).toBe('standard');
    expect(rich(14_000, 2_600, 1_800)).toBe('standard');
  });

  it('forges weapons only and sews tunics where little iron lies within reach, counting a share of its land', () => {
    const armsWith = (nearIron: number, landIron: number) =>
      selectEconomy(
        seat({
          near: sums({ free: 16_000, deposits: nearDeposits(nearIron) }),
          continent: sums({ deposits: new Map([['iron', landIron]]) }),
        }),
      );
    const scarce = armsWith(600, 0);
    expect(scarce.sides).toContain('ironWeapons');
    expect(scarce.sides).not.toContain('ironArms');
    expect(scarce.evidence).toContain('ironScarce');
    // Two seats share the land, so half its 4000 iron counts.
    expect(armsWith(600, 4_000).sides).toContain('ironArms');
  });

  it('keeps to one mint where little gold lies within reach', () => {
    const gold = (units: number) =>
      selectEconomy(seat({ near: sums({ free: 16_000, deposits: nearDeposits(2_400, units) }) })).sides;
    expect(gold(600)).toContain('oneMint');
    expect(gold(1_200)).not.toContain('oneMint');
  });

  it('arms with iron or nature, never both, by how far the iron lies on its land', () => {
    const arms = (iron: GoodAccess) =>
      selectEconomy(seat({}, { iron })).sides.filter((s) => s.startsWith('iron') || s === 'naturalArms');
    expect(arms({ access: 'near', zones: 2 })).toEqual(['ironArms']);
    expect(arms({ access: 'continent', zones: 4 })).toEqual(['ironArms']);
    expect(arms({ access: 'continent', zones: 8 })).toEqual(['naturalArms']);
    expect(arms({ access: 'overSea', zones: 1 })).toEqual(['naturalArms']);
  });
});
