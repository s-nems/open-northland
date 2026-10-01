import { formatMessage, messages } from '../../../i18n/index.js';
import type { VehicleCargoGood } from '../../details-panel/model/index.js';
import { stockTabLabels } from '../../good-categories.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH, STOCK_TAB_GLYPHS } from '../icons.js';
import { createCategoryTabs } from '../parts/category-tabs.js';
import { button, element, setAttribute, setHidden, setTip, write } from '../parts/dom.js';
import { createRoundButton } from '../parts/round-button.js';
import type { VehiclePanelDeps } from './actions.js';

/** Design px of a good's icon in a picker cell (foundation.css `.on-cargo-picker__grid`). */
const PICKER_ICON_PX = 24;

/** The tab the picker opens on: the first category the hold may carry anything of. */
export function firstCarriedTab(goods: readonly VehicleCargoGood[], tabs: number): number {
  for (let tab = 0; tab < tabs; tab++) if (goods.some((good) => good.category === tab)) return tab;
  return 0;
}

/**
 * "Add a good": the stock categories over the goods of the open one that the hold may carry, a listed
 * good ticked. A press adds the good to the manifest (a press on one the player added and left at zero
 * takes it off again), and the picker stays open for the next.
 */
export interface CargoPicker {
  readonly element: HTMLElement;
  open(goods: readonly VehicleCargoGood[]): void;
  close(): void;
  isOpen(): boolean;
  /** Repaint the ticks against the goods the manifest lists now. */
  update(goods: readonly VehicleCargoGood[], listed: ReadonlySet<number>): void;
}

export function createCargoPicker(
  deps: VehiclePanelDeps,
  onPick: (goodType: number) => void,
  onClose: () => void,
): CargoPicker {
  const root = element('div', 'on-cargo-picker');
  root.hidden = true;
  const head = element('div', 'on-cargo-picker__title', '<span></span>');
  const title = head.firstElementChild;
  if (title === null) throw new Error('cargo picker: title');
  const closer = createRoundButton('ledger', () => onClose());
  head.append(closer.element);
  let tab = 0;
  let goods: readonly VehicleCargoGood[] = [];
  let listed: ReadonlySet<number> = new Set();
  const tabs = createCategoryTabs(STOCK_TAB_GLYPHS, messages().hud.vehiclePanel.pickerTabs, (index) => {
    tab = index;
    paint();
  });
  const grid = element('div', 'on-cargo-picker__grid');
  root.append(head, tabs.element, grid);

  let cells: { good: number; element: HTMLButtonElement }[] = [];
  let shownKey = '';
  const paint = (): void => {
    const copy = messages().hud.vehiclePanel;
    const labels = stockTabLabels();
    write(title, formatMessage(copy.picker, { category: labels[tab] ?? '' }));
    closer.update({ face: { glyph: GLYPH.close }, label: copy.pickerClose, tooltip: copy.pickerClose });
    tabs.update(
      labels.map((label, index) => ({
        label,
        empty: !goods.some((good) => good.category === index),
        marked: goods.some((good) => good.category === index && listed.has(good.goodType)),
      })),
      tab,
    );
    const shown = goods.filter((good) => good.category === tab);
    const key = shown.map((good) => good.goodType).join();
    if (key !== shownKey) {
      shownKey = key;
      cells = shown.map((good) => {
        const cell = button('', goodIconMarkup(PICKER_ICON_PX));
        const frame = cell.querySelector('.on-good__frame');
        if (good.goodId !== undefined && frame instanceof HTMLElement)
          deps.icons(frame, good.goodId, PICKER_ICON_PX);
        cell.addEventListener('click', () => onPick(good.goodType));
        return { good: good.goodType, element: cell };
      });
      if (cells.length === 0)
        grid.replaceChildren(element('span', 'on-cargo-picker__empty', copy.pickerEmpty));
      else grid.replaceChildren(...cells.map((cell) => cell.element));
    }
    for (const cell of cells) {
      const good = shown.find((candidate) => candidate.goodType === cell.good);
      if (good === undefined) continue;
      const on = listed.has(cell.good);
      setAttribute(cell.element, 'aria-pressed', String(on));
      setAttribute(cell.element, 'aria-label', good.label);
      setTip(cell.element, formatMessage(on ? copy.pickerListed : copy.pickerAdd, { good: good.label }));
    }
  };

  return {
    element: root,
    open(next): void {
      goods = next;
      tab = firstCarriedTab(next, STOCK_TAB_GLYPHS.length);
      setHidden(root, false);
      paint();
    },
    close(): void {
      setHidden(root, true);
    },
    isOpen: () => !root.hidden,
    update(next, nextListed): void {
      goods = next;
      listed = nextListed;
      if (!root.hidden) paint();
    },
  };
}
