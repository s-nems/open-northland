import { describe, expect, it } from 'vitest';
import { tradeShipPick } from '../../../../src/view/unit-controls/highlights/index.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

const TRADER = 1;
const FREE_SHIP = 10;
const PINNED_SHIP = 11;
const CART = 12;

const vehicle = (id: number): Ent => ({ id, components: { Vehicle: { vehicleType: 1 } } });

describe('tradeShipPick', () => {
  it('lights what the rule takes, refuses the trader’s own ship and leaves the rest unjudged', () => {
    const snap = snapshotOf([
      { id: TRADER, components: { TradeShip: { vehicle: PINNED_SHIP } } },
      vehicle(FREE_SHIP),
      vehicle(PINNED_SHIP),
      vehicle(CART),
    ]);

    expect(tradeShipPick.highlight(snap, TRADER, (_trader, ship) => ship === FREE_SHIP)).toEqual([
      { id: FREE_SHIP, tone: 'candidate' },
      { id: PINNED_SHIP, tone: 'refused' },
    ]);
  });
});
