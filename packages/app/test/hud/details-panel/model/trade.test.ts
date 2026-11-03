import { type Entity, TRADE_LIMIT_NONE, type TraderShipState, type TraderView } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { VEHICLE_SHIP_SMALL } from '../../../../src/game/sandbox/index.js';
import { tradePanelModel } from '../../../../src/hud/details-panel/model/trade.js';
import { messages } from '../../../../src/i18n/index.js';
import { sandboxCtx, snapshotOf } from '../../../support/sandbox.js';

const ctx = sandboxCtx();
const TRADER = 1;
const SHIP = 2 as Entity;
const GOOD_WOOD_UNITS = 3;

/** A route with no stops, whose ship row reads the view alone. */
function shipRow(view: Partial<TraderView>) {
  const route: TraderView = {
    stops: [],
    current: 0,
    agreement: 0,
    agreementHolds: false,
    given: 0,
    received: 0,
    giveKeep: TRADE_LIMIT_NONE,
    takeUpTo: TRADE_LIMIT_NONE,
    cart: null,
    cargo: [],
    ship: { entity: SHIP, vehicleType: VEHICLE_SHIP_SMALL },
    shipCargo: [],
    shipState: 'ready',
    ...view,
  };
  return tradePanelModel({ ...ctx, traderView: () => route }, snapshotOf([]), TRADER)?.ship;
}

describe('the Trade section’s ship row', () => {
  it('offers the pin and says why on a crossing with no ship', () => {
    const copy = messages().hud.settlerPanel;
    expect(shipRow({ ship: null, shipState: 'needed' })).toEqual({
      ship: null,
      note: { label: copy.tradeShipNeeded, tooltip: copy.tradeShipNeededTooltip },
    });
  });

  it('explains a ship only when it cannot serve the route', () => {
    const copy = messages().hud.settlerPanel;
    const noteFor = (shipState: TraderShipState) => shipRow({ shipState })?.note;
    expect(noteFor('unreachable')).toEqual({
      label: copy.tradeShipUnreachable,
      tooltip: copy.tradeShipUnreachableTooltip,
    });
    expect(noteFor('ready')).toBeNull();
    expect(noteFor('notNeeded')).toBeNull();
  });

  it('keeps the pinned ship with its hold on a route that no longer needs it', () => {
    const wood = ctx.goods.find((good) => good.id === 'wood')?.typeId ?? -1;
    const row = shipRow({ shipState: 'notNeeded', shipCargo: [{ good: wood, amount: GOOD_WOOD_UNITS }] });
    expect(row?.ship?.entity).toBe(SHIP);
    expect(row?.ship?.load).toBe(
      `${messages().goods.ship_small}: ${GOOD_WOOD_UNITS} ${messages().goods.wood}`,
    );
  });
});
