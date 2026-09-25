import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { tradeHousePick } from '../src/view/unit-controls/highlights/index.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * The trade-house pick lights what the sim's trade-stop rule takes and marks the route's own houses,
 * so another tribe's houses without an agreement stay unlit.
 */

const TRADER = 1;
const OWN_WAREHOUSE = 10;
const ON_ROUTE = 11;
const TRADING_POST = 20;
const FOREIGN_TOWER = 21;

function house(id: number): Ent {
  return { id, components: { Building: { buildingType: 1, built: ONE, tribe: 1 } } };
}

const trader: Ent = {
  id: TRADER,
  components: { TradeRoute: { stops: [{ house: ON_ROUTE, foreign: false, imports: [] }] } },
};

describe('tradeHousePick', () => {
  it('lights the houses the rule takes, marks the route red and leaves the rest unlit', () => {
    const snap = snapshotOf([
      trader,
      house(OWN_WAREHOUSE),
      house(ON_ROUTE),
      house(TRADING_POST),
      house(FOREIGN_TOWER),
    ]);
    const takes = new Set([OWN_WAREHOUSE, TRADING_POST]);

    expect(tradeHousePick.highlight(snap, [TRADER], (_trader, h) => takes.has(h))).toEqual([
      { id: OWN_WAREHOUSE, ok: true },
      { id: ON_ROUTE, ok: false },
      { id: TRADING_POST, ok: true },
    ]);
    expect(tradeHousePick.onRoute(snap, ON_ROUTE, TRADER)).toBe(true);
  });
});
