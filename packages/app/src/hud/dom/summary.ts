import type { HudModel } from '@open-northland/render';
import { diag } from '../../diag/index.js';
import { formatMessage, messages } from '../../i18n/index.js';
import {
  SUMMARY_CATEGORIES,
  type SummaryCategoryId,
  type SummaryRow,
  summaryPopulation,
  summaryStocks,
} from '../summary/model.js';
import { GOOD_ICON_BOX_PX, goodIconSource, goodIconStyle } from './good-art.js';
import { FIGURE } from './icons.js';

export interface HudSummaryDeps {
  /** A stock entry's good by its content type id; `undefined` when the catalog has no such good. */
  readonly goodIdOf: (goodType: number) => string | undefined;
  /** A good's localized name by string id. */
  readonly goodLabel: (goodId: string) => string;
}

/** The counters left of the clock: the residents and the five stock categories, each with a breakdown
 *  that opens on hover or focus and stays while the pointer moves into it. */
export interface HudSummary {
  readonly element: HTMLElement;
  /** Show the model as it stands; the same model twice costs nothing. */
  update(model: HudModel): void;
  dispose(): void;
}

/** The counters near the screen's right edge hang their breakdown to the left instead. */
const FLIPPED_CATEGORIES: ReadonlySet<SummaryCategoryId> = new Set(['armament', 'equipment', 'other']);

interface CountButton {
  readonly button: HTMLButtonElement;
  readonly figure: HTMLElement;
  readonly name: string;
  shown: number;
}

interface TipRow {
  readonly goodId: string;
  readonly row: HTMLElement;
  readonly figure: HTMLElement;
}

interface Group {
  readonly root: HTMLElement;
  readonly buttons: readonly CountButton[];
  readonly tip: HTMLElement;
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function tipRow(label: string, className = ''): { row: HTMLElement; figure: HTMLElement } {
  const row = document.createElement('p');
  row.className = `on-tip__row ${className}`.trim();
  const name = document.createElement('span');
  name.textContent = label;
  const figure = document.createElement('b');
  row.append(name, figure);
  return { row, figure };
}

export function createHudSummary(deps: HudSummaryDeps): HudSummary {
  const copy = messages().hud.summary;
  const element = document.createElement('div');
  element.className = 'on-summary';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', copy.label);
  let disposed = false;
  let open: Group | null = null;

  const show = (group: Group | null): void => {
    if (open === group) return;
    if (open !== null) {
      open.tip.hidden = true;
      for (const { button } of open.buttons) button.setAttribute('aria-expanded', 'false');
    }
    open = group;
    if (group !== null) {
      group.tip.hidden = false;
      for (const { button } of group.buttons) button.setAttribute('aria-expanded', 'true');
    }
  };

  const countButton = (name: string, art: string): CountButton => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'on-bar__count';
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `${art}<b></b>`;
    const figure = button.querySelector('b');
    if (figure === null) throw new Error('summary: count button without a figure');
    return { button, figure, name, shown: Number.NaN };
  };

  let tips = 0;

  const group = (buttons: readonly CountButton[], title: string, flip: boolean): Group => {
    const root = document.createElement('div');
    root.className = flip ? 'on-resource on-resource--flip' : 'on-resource';
    const tip = document.createElement('div');
    tip.className = 'on-tip';
    tip.id = `on-summary-tip-${tips++}`;
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    for (const { button } of buttons) button.setAttribute('aria-describedby', tip.id);
    const heading = document.createElement('h4');
    heading.className = 'on-tip__title';
    heading.textContent = title;
    tip.append(heading);
    root.append(...buttons.map((b) => b.button), tip);
    const made: Group = { root, buttons, tip };
    root.addEventListener('mouseenter', () => show(made));
    root.addEventListener('mouseleave', () => {
      if (open === made) show(null);
    });
    root.addEventListener('focusin', () => show(made));
    root.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (open === made && !(next instanceof Node && root.contains(next))) show(null);
    });
    for (const { button } of buttons)
      button.addEventListener('click', () => show(open === made ? null : made));
    element.append(root);
    return made;
  };

  const setCount = (count: CountButton, value: number): void => {
    if (value === count.shown) return;
    count.shown = value;
    count.figure.textContent = String(value);
    count.button.setAttribute('aria-label', formatMessage(copy.count, { name: count.name, count: value }));
  };
  const setRow = (row: { row: HTMLElement; figure: HTMLElement }, value: number): void => {
    setText(row.figure, String(value));
    row.row.classList.toggle('on-tip__row--zero', value === 0);
  };

  // Residents: three counters over one breakdown.
  const women = countButton(copy.women, FIGURE.woman);
  const men = countButton(copy.men, FIGURE.man);
  const children = countButton(copy.children, FIGURE.child);
  const residents = group([women, men, children], copy.residents, false);
  const womenRow = tipRow(copy.women);
  const menRow = tipRow(copy.men);
  const childrenRow = tipRow(copy.children);
  const babiesRow = tipRow(copy.babies, 'on-tip__row--sub');
  const totalRow = tipRow(copy.total, 'on-tip__row--total');
  residents.tip.append(womenRow.row, menRow.row, childrenRow.row, babiesRow.row, totalRow.row);

  // Stock: one counter per category, its icon the category's representative good.
  const categories = SUMMARY_CATEGORIES.map((spec) => {
    const name = copy.categories[spec.id];
    const icon = document.createElement('span');
    icon.className = 'on-good';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.width = `${GOOD_ICON_BOX_PX}px`;
    icon.style.height = `${GOOD_ICON_BOX_PX}px`;
    const count = countButton(name, icon.outerHTML);
    const made = group([count], name, FLIPPED_CATEGORIES.has(spec.id));
    const wide = spec.columns.length > 1;
    made.tip.classList.toggle('on-tip--wide', wide);
    const columnHost = document.createElement('div');
    columnHost.className = wide ? 'on-tip__columns' : '';
    made.tip.append(columnHost);
    const columns = spec.columns.map(() => {
      const host = document.createElement('div');
      columnHost.append(host);
      return { host, rows: [] as TipRow[] };
    });
    goodIconSource(spec.icon)
      .then((source) => {
        const slot = count.button.querySelector('.on-good');
        if (disposed || source === null || !(slot instanceof HTMLElement)) return;
        slot.style.cssText += goodIconStyle(source);
      })
      .catch((error: unknown) => diag.warn('hud', `summary icon ${spec.icon}: ${String(error)}`));
    return { spec, count, columns };
  });

  const fillColumn = (column: { host: HTMLElement; rows: TipRow[] }, rows: readonly SummaryRow[]): void => {
    const same =
      column.rows.length === rows.length && column.rows.every((r, i) => r.goodId === rows[i]?.goodId);
    if (!same) {
      column.host.replaceChildren();
      column.rows = rows.map(({ goodId }) => {
        const made = tipRow(deps.goodLabel(goodId));
        column.host.append(made.row);
        return { goodId, ...made };
      });
    }
    rows.forEach((row, i) => {
      const built = column.rows[i];
      if (built !== undefined) setRow(built, row.amount);
    });
  };

  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open !== null) {
      show(null);
      event.stopPropagation();
    }
  });

  let shown: HudModel | null = null;
  return {
    element,
    update: (model) => {
      if (model === shown) return;
      shown = model;
      const population = summaryPopulation(model);
      setCount(women, population.women);
      setCount(men, population.men);
      setCount(children, population.children);
      setRow(womenRow, population.women);
      setRow(menRow, population.men);
      setRow(childrenRow, population.children);
      setRow(babiesRow, population.babies);
      setRow(totalRow, population.total);
      const stocks = summaryStocks(model, deps.goodIdOf);
      categories.forEach((category, i) => {
        const stock = stocks[i];
        if (stock === undefined) return;
        setCount(category.count, stock.total);
        category.columns.forEach((column, c) => {
          fillColumn(column, stock.columns[c] ?? []);
        });
      });
    },
    dispose: () => {
      disposed = true;
      element.remove();
    },
  };
}
