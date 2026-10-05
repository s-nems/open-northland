import { formatMessage, messages } from '../../../i18n/index.js';
import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { DiplomacyGood, DiplomacyOffer, TributePanelRow } from './model.js';

function goodCell(good: DiplomacyGood, paint: GoodIconPainter): HTMLElement {
  const root = element('span', 'on-dip-good');
  const well = element('span', 'on-good-well', goodIconMarkup());
  const frame = well.querySelector('.on-good__frame');
  if (good.goodId !== undefined && frame instanceof HTMLElement) paint(frame, good.goodId, 25);
  const label = element('span', 'on-dip-good__label');
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

export function createTributes(paint: GoodIconPainter, onPay: (slot: number) => void) {
  const copy = messages().hud.diplomacyWindow;
  const root = element('section', 'on-dip-tributes');
  root.tabIndex = -1;
  const heading = createSection();
  const list = element('div', 'on-dip-tribute-list');
  setAttribute(list, 'role', 'group');
  setAttribute(list, 'aria-label', copy.tributes);
  const empty = element('p', 'on-dip-note');
  write(empty, copy.noTributes);
  const foot = element('div', 'on-dip-tribute__foot');
  const pay = button('on-button on-button--accent');
  foot.append(pay);
  root.append(heading.element, list, empty, foot);
  let selected: number | null = null;
  let shown = '';
  let rows: readonly TributePanelRow[] = [];
  let paying: (slot: number) => boolean = () => false;
  let readOnly = false;
  let buttons = new Map<number, HTMLButtonElement>();
  let cells = new Map<number, readonly DemandView[]>();
  const name = (index: number): string => `${messages().hud.tribute} ${index + 1}`;

  const refresh = (): void => {
    const tribute = rows.find((t) => t.slot === selected);
    for (const [slot, control] of buttons) setAttribute(control, 'aria-pressed', String(slot === selected));
    for (const row of rows) {
      const demands = cells.get(row.slot);
      for (const [index, demand] of row.demands.entries()) {
        const cell = demands?.[index];
        if (cell === undefined) continue;
        write(cell.stock, String(demand.onHand));
        const missing = Math.max(0, demand.amount - demand.onHand);
        write(cell.shortage, missing > 0 ? String(missing) : '—');
        setClass(cell.shortage, 'on-dip-costs__short', missing > 0);
      }
    }
    setHidden(foot, tribute === undefined);
    if (tribute === undefined) return;
    const pending = paying(tribute.slot);
    pay.disabled = readOnly || !tribute.payable || pending;
    write(pay, pending ? copy.paying : copy.pay);
    setAttribute(pay, 'aria-label', formatMessage(copy.payLabel, { tribute: name(rows.indexOf(tribute)) }));
  };
  pay.addEventListener('click', () => {
    if (!pay.disabled && selected !== null) onPay(selected);
  });

  return {
    element: root,
    update(
      tributes: readonly TributePanelRow[],
      isPaying: (slot: number) => boolean,
      observer: boolean,
    ): void {
      rows = tributes;
      paying = isPaying;
      readOnly = observer;
      const removed = selected !== null && !rows.some((t) => t.slot === selected);
      const recoverFocus = removed && root.contains(document.activeElement);
      if (selected === null || removed) selected = rows[0]?.slot ?? null;
      const key = JSON.stringify(
        rows.map((t) => [t.slot, t.demands.map((d) => [d.goodType, d.goodId, d.label, d.amount])]),
      );
      if (shown !== key) {
        const focused = [...buttons.entries()].find(([, control]) => control === document.activeElement)?.[0];
        shown = key;
        cells = new Map();
        buttons = new Map(
          rows.map((tribute, index) => {
            const control = button('on-dip-tribute-pick');
            const title = element('strong', '');
            write(title, name(index));
            const labels = element('span', 'on-dip-cost-row on-dip-cost-row--head');
            for (const label of [copy.good, copy.cost, copy.available, copy.missing]) {
              const cell = element('span', '');
              write(cell, label);
              if (label === copy.available) setTip(cell, copy.stockScope);
              labels.append(cell);
            }
            control.append(title, labels);
            cells.set(
              tribute.slot,
              tribute.demands.map((demand): DemandView => {
                const row = element('span', 'on-dip-cost-row');
                const cost = element('span', '');
                write(cost, String(demand.amount));
                const stock = element('span', '');
                const shortage = element('span', '');
                row.append(goodCell(demand, paint), cost, stock, shortage);
                control.append(row);
                return { stock, shortage };
              }),
            );
            control.addEventListener('click', () => {
              selected = tribute.slot;
              refresh();
            });
            return [tribute.slot, control];
          }),
        );
        list.replaceChildren(...buttons.values());
        if (focused !== undefined)
          (buttons.get(focused) ?? buttons.get(selected ?? -1) ?? root).focus({ preventScroll: true });
      }
      heading.update(tributes.length > 0 ? `${copy.tributes} · ${tributes.length}` : copy.tributes);
      setHidden(empty, tributes.length > 0);
      refresh();
      if (recoverFocus) (buttons.get(selected ?? -1) ?? root).focus({ preventScroll: true });
    },
  };
}
