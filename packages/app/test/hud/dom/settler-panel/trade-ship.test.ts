// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import type { TraderSubject } from '../../../../src/hud/details-panel/model/index.js';
import type { TradeShipModel } from '../../../../src/hud/details-panel/model/trade.js';
import { createTradeShipRow } from '../../../../src/hud/dom/settler-panel/trade-ship.js';
import { ownRoute } from '../../../support/trade-route.js';

const TRADER = 4;
const SHIP = 9;

afterEach(() => document.body.replaceChildren());

/** The row for a trader with `ship`, and the actions its presses took. */
function shipRow(ship: TradeShipModel) {
  const pressed: string[] = [];
  const subject: TraderSubject = { entityId: TRADER, name: 'Ragnar', trade: { ...ownRoute(), ship } };
  const row = createTradeShipRow(
    {
      pinTradeShip: (id) => pressed.push(`pin ${id}`),
      show: (id) => pressed.push(`show ${id}`),
      unpinTradeShip: (id) => pressed.push(`unpin ${id}`),
    },
    () => subject,
  );
  document.body.append(row.element);
  row.update(subject.trade ?? ownRoute());
  const press = (selector: string) => row.element.querySelector<HTMLElement>(selector)?.click();
  return { pressed, press };
}

it('arms the pin pick from the link while no ship is pinned', () => {
  const { pressed, press } = shipRow({ ship: null, note: null });
  press('.on-ledger__link');
  press('.on-round');
  expect(pressed).toEqual([`pin ${TRADER}`]);
});

it('shows the pinned ship from the link, and the detach unpins it', () => {
  const { pressed, press } = shipRow({
    ship: { entity: SHIP, label: 'Small ship', load: 'Small ship: empty' },
    note: null,
  });
  press('.on-ledger__link');
  press('.on-round');
  expect(pressed).toEqual([`show ${SHIP}`, `unpin ${TRADER}`]);
});
