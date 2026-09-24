import { fx, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { tradeHousePick } from '../src/view/unit-controls/highlights/index.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const TRADER = 1;
const ON_ROUTE = 10;
const FOREIGN = 11;
const FOUNDATION = 12;
const HALF_BUILT = 13;
const OWN_PLAYER = 0;
const FOREIGN_PLAYER = 3;

const house = (id: number, player: number, built = ONE, extra: Record<string, unknown> = {}): Ent => ({
  id,
  components: { Building: { buildingType: 1, built }, Owner: { player }, ...extra },
});

const WORLD = snapshotOf([
  {
    id: TRADER,
    components: {
      Settler: { jobType: 1 },
      Owner: { player: OWN_PLAYER },
      TradeRoute: { stops: [{ house: ON_ROUTE }] },
    },
  },
  house(ON_ROUTE, OWN_PLAYER),
  house(FOREIGN, FOREIGN_PLAYER),
  house(FOUNDATION, FOREIGN_PLAYER, ONE, { UnderConstruction: { labor: fx.fromInt(0) } }),
  house(HALF_BUILT, FOREIGN_PLAYER, fx.fromInt(0)),
]);

describe('the trade-route house pick', () => {
  it('lights every finished house, whoever owns it, green unless the route names it', () => {
    expect(tradeHousePick.highlight(WORLD, [TRADER])).toEqual([
      { id: ON_ROUTE, ok: false },
      { id: FOREIGN, ok: true },
    ]);
  });

  it('adds only a finished house the route does not name yet', () => {
    expect(tradeHousePick.assignableAt(WORLD, FOREIGN, TRADER)).toBe(true);
    expect(tradeHousePick.assignableAt(WORLD, ON_ROUTE, TRADER)).toBe(false);
    expect(tradeHousePick.assignableAt(WORLD, FOUNDATION, TRADER)).toBe(false);
    expect(tradeHousePick.assignableAt(WORLD, HALF_BUILT, TRADER)).toBe(false);
  });
});
