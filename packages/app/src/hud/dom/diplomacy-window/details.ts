import { formatMessage, messages } from '../../../i18n/index.js';
import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setClass, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { DiplomacyGood, DiplomacyOffer, TributePanelRow } from './model.js';

function goodCell(good: DiplomacyGood, paint: GoodIconPainter): HTMLElement {
  const root = element('span', 'on-dip-good');
  const well = element('span', 'on-good-well', goodIconMarkup());
  const frame = well.querySelector('.on-good__frame');
  if (good.goodId !== undefined && frame instanceof HTMLElement) paint(frame, good.goodId, 25);
  const label = element('span', '');
  write(label, good.label);
  root.append(well, label);
  return root;
}

export function createOffers(paint: GoodIconPainter) {
  const copy = messages().hud.diplomacyWindow;
  const root = element('section', 'on-dip-offers');
  const heading = createSection();
  heading.update(copy.offers);
  const empty = element('p', 'on-dip-note');
  write(empty, copy.noOffers);
  const availability = element('p', 'on-dip-note');
  const list = element('div', 'on-parchment on-dip-offer-list');
  const header = element('div', 'on-dip-offer-head');
  for (const title of [copy.give, '', copy.take]) {
    const cell = element('span', '');
    write(cell, title);
    header.append(cell);
  }
  const body = element('ul', '');
  list.append(header, body);
  root.append(heading.element, availability, list, empty);
  let shown = '';
  return {
    element: root,
    update(offers: readonly DiplomacyOffer[], friendly: boolean): void {
      const key = JSON.stringify(offers);
      if (shown !== key) {
        shown = key;
        body.replaceChildren(
          ...offers.map((offer) => {
            const row = element('li', 'on-dip-offer');
            for (const [index, good] of [offer.give, offer.take].entries()) {
              if (index === 1) row.append(element('span', 'on-dip-exchange', GLYPH.arrow));
              const cell = element('span', 'on-dip-exchange-good');
              const amount = element('b', '');
              write(amount, String(good.amount));
              cell.append(goodCell(good, paint), amount);
              row.append(cell);
            }
            return row;
          }),
        );
      }
      setHidden(list, offers.length === 0);
      setHidden(empty, offers.length > 0);
      setHidden(availability, offers.length === 0 || friendly);
      write(availability, copy.tradeBlocked);
    },
  };
}

interface DemandView {
  readonly stock: HTMLElement;
  readonly shortage: HTMLElement;
}

interface TributeView {
  readonly element: HTMLElement;
  readonly title: HTMLElement;
  readonly demands: readonly DemandView[];
  readonly pay: HTMLButtonElement;
  readonly reason: HTMLElement;
}

export function createTributes(paint: GoodIconPainter, onPay: (slot: number) => void) {
  const copy = messages().hud.diplomacyWindow;
  const root = element('section', 'on-dip-tributes');
  const heading = createSection();
  const list = element('div', '');
  const empty = element('p', 'on-dip-note');
  write(empty, copy.noTributes);
  root.append(heading.element, list, empty);
  let shown = '';
  let views = new Map<number, TributeView>();

  const create = (tribute: TributePanelRow): TributeView => {
    const card = element('article', 'on-dip-tribute');
    const title = element('h4', 'on-dip-tribute__title');
    const sheet = element('div', 'on-parchment');
    const table = element('table', 'on-dip-costs');
    const head = element('thead', '');
    const labels = element('tr', '');
    for (const label of [copy.good, copy.cost, copy.available, copy.missing]) {
      const cell = element('th', '');
      cell.scope = 'col';
      write(cell, label);
      if (label === copy.available) setTip(cell, copy.stockScope);
      labels.append(cell);
    }
    head.append(labels);
    const body = element('tbody', '');
    const demands = tribute.demands.map((demand): DemandView => {
      const row = element('tr', '');
      const good = element('td', '');
      good.append(goodCell(demand, paint));
      const cost = element('td', '');
      write(cost, String(demand.amount));
      const stock = element('td', '');
      const shortage = element('td', '');
      row.append(good, cost, stock, shortage);
      body.append(row);
      return { stock, shortage };
    });
    table.append(head, body);
    sheet.append(table);
    const foot = element('div', 'on-dip-tribute__foot');
    const reason = element('span', 'on-dip-note');
    const pay = button('on-button on-button--accent');
    pay.addEventListener('click', () => {
      if (!pay.disabled) onPay(tribute.slot);
    });
    foot.append(reason, pay);
    card.append(title, sheet, foot);
    return { element: card, title, demands, pay, reason };
  };

  return {
    element: root,
    update(tributes: readonly TributePanelRow[], paying: (slot: number) => boolean, readOnly: boolean): void {
      const key = JSON.stringify(
        tributes.map((t) => [t.slot, t.demands.map((d) => [d.goodType, d.goodId, d.label, d.amount])]),
      );
      if (shown !== key) {
        const focused = document.activeElement;
        const lostFocus = focused !== null && list.contains(focused);
        shown = key;
        views = new Map(tributes.map((t) => [t.slot, create(t)]));
        list.replaceChildren(...[...views.values()].map((view) => view.element));
        if (lostFocus) {
          root.tabIndex = -1;
          root.focus({ preventScroll: true });
        }
      }
      heading.update(tributes.length > 0 ? `${copy.tributes} · ${tributes.length}` : copy.tributes);
      setHidden(empty, tributes.length > 0);
      for (const tribute of tributes) {
        const view = views.get(tribute.slot);
        if (view === undefined) continue;
        write(view.title, tribute.text?.trim() || `${messages().hud.tribute} ${tribute.slot}`);
        for (const [index, demand] of tribute.demands.entries()) {
          const cells = view.demands[index];
          if (cells === undefined) continue;
          write(cells.stock, String(demand.onHand));
          const missing = Math.max(0, demand.amount - demand.onHand);
          write(cells.shortage, missing > 0 ? String(missing) : '—');
          setClass(cells.shortage, 'on-dip-costs__short', missing > 0);
        }
        const pending = paying(tribute.slot);
        view.pay.disabled = readOnly || !tribute.payable || pending;
        write(view.pay, pending ? copy.paying : copy.pay);
        view.pay.setAttribute(
          'aria-label',
          formatMessage(copy.payLabel, { tribute: view.title.textContent ?? '' }),
        );
        write(
          view.reason,
          readOnly ? copy.readOnly : pending ? '' : tribute.payable ? '' : copy.insufficient,
        );
      }
    },
  };
}
