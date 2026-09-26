import { formatMessage, messages } from '../../../i18n/index.js';
import {
  PRODUCTION_COUNT_MAX,
  PRODUCTION_UNLIMITED,
  type SettlerPanelModel,
  type SettlerProductionModel,
  type SettlerProductionRow,
} from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { type Counter, createCounter } from '../parts/counter.js';
import { button, element, setAttribute, setClass, setHidden, setTip, write } from '../parts/dom.js';
import { createRoundButton, type RoundButton, type RoundButtonModel } from '../parts/round-button.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';

const COUNTER_RANGE = { max: PRODUCTION_COUNT_MAX, unlimited: PRODUCTION_UNLIMITED };

/** The good's button is "only this one", and with Ctrl it adds the good to what is made or takes it
 *  out (its counter to ∞ or 0, the other rows untouched): its wording names making for a craft and
 *  gathering for a gatherer, the orders are the same. */
function goodButton(production: SettlerProductionModel, row: SettlerProductionRow): RoundButtonModel {
  const copy = messages().hud.settlerPanel;
  const face = { goodId: row.goodId };
  if (row.locked !== null) return { face, label: row.label, tooltip: row.locked, enabled: false };
  const label = formatMessage(copy.onlyThisLabel, { good: row.label });
  const only = production.kind === 'craft' ? copy.onlyThis : copy.gatherOnly;
  const toggle = row.count === 0 ? copy.addProduct : copy.removeProduct;
  return { face, label, tooltip: `${only} · ${toggle}` };
}

/** The Ctrl press's counter: a stopped good starts for good, a running one stops. */
export function toggledProductionCount(count: number): number {
  return count === 0 ? PRODUCTION_UNLIMITED : 0;
}

interface RowView {
  readonly item: HTMLLIElement;
  readonly good: RoundButton;
  readonly name: HTMLElement;
  readonly counter: Counter;
  readonly lock: HTMLButtonElement;
}

/** Produkcja: one row per product the trade makes or gathers here, the good's button, its name, and
 *  its counter or a locked product's lock. */
export interface ProductionSection {
  readonly element: HTMLElement;
  update(model: SettlerPanelModel): void;
}

export function createProductionSection(
  deps: SettlerPanelDeps,
  current: () => SettlerPanelModel | null,
): ProductionSection {
  const { actions } = deps;
  const root = element('div', '');
  const title = createSection();
  const list = element('ul', 'on-prod');
  root.append(title.element, list);
  let shown = '';
  let rows: RowView[] = [];

  const rowView = (goodType: number): RowView => {
    const id = (): number => current()?.entityId ?? -1;
    const item = element('li', 'on-prod-row');
    const good = createRoundButton(
      'good',
      (event) => {
        const row = current()?.production?.rows.find((candidate) => candidate.goodType === goodType);
        if (event.ctrlKey || event.metaKey) {
          if (row !== undefined)
            actions.setProductionCount(id(), goodType, toggledProductionCount(row.count));
        } else actions.onlyProduct(id(), goodType);
      },
      deps.icons,
    );
    const name = element('span', 'on-prod-row__name');
    const counter = createCounter(COUNTER_RANGE, (next) => actions.setProductionCount(id(), goodType, next));
    const lock = button('on-prod-row__lock', GLYPH.lock);
    lock.addEventListener('click', () => actions.openKnowledge?.(goodType));
    item.append(good.element, name, counter.element, lock);
    return { item, good, name, counter, lock };
  };

  return {
    element: root,
    update(model): void {
      const production = model.production;
      setHidden(root, production === null);
      if (production === null) return;
      const copy = messages().hud;
      title.update(copy.production);
      const key = `${production.kind}:${production.rows.map((row) => row.goodType).join(',')}`;
      if (key !== shown) {
        shown = key;
        rows = production.rows.map((row) => rowView(row.goodType));
        list.replaceChildren(...rows.map((view) => view.item));
      }
      production.rows.forEach((row, index) => {
        const view = rows[index];
        if (view === undefined) return;
        view.good.update(goodButton(production, row));
        write(view.name, row.label);
        setClass(view.item, 'on-prod-row--locked', row.locked !== null);
        setClass(view.item, 'on-prod-row--stopped', row.count === 0);
        setHidden(view.lock, row.locked === null);
        if (row.locked !== null) {
          const lockTip = formatMessage(copy.settlerPanel.lockTooltip, {
            reason: row.locked,
            good: row.label,
          });
          setTip(view.lock, lockTip);
          setAttribute(
            view.lock,
            'aria-label',
            formatMessage(copy.settlerPanel.knowledgeLabel, { good: row.label }),
          );
        }
        setHidden(view.counter.element, row.locked !== null);
        view.counter.update({
          value: row.count,
          lessLabel: formatMessage(copy.settlerPanel.less, { good: row.label }),
          moreLabel: formatMessage(copy.settlerPanel.more, { good: row.label }),
          lessTooltip: copy.settlerPanel.lessTooltip,
          moreTooltip: copy.settlerPanel.moreTooltip,
        });
      });
    },
  };
}
