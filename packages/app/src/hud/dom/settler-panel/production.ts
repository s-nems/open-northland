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
import { button, element, setAttribute, setClass, setHidden, setTitle, write } from '../parts/dom.js';
import { createRoundButton, type RoundButton, type RoundButtonModel } from '../parts/round-button.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';

const COUNTER_RANGE = { max: PRODUCTION_COUNT_MAX, unlimited: PRODUCTION_UNLIMITED };

/** What a gatherer's good button asks for: that good alone, or every good again when it is already the
 *  only one. */
export function gatherTarget(selected: number | null, goodType: number): number | null {
  return selected === goodType ? null : goodType;
}

/** A product row reads stopped: a craft counter at zero, or a good a gatherer is not held to. */
export function productStopped(production: SettlerProductionModel, row: SettlerProductionRow): boolean {
  if (row.count !== null) return row.count === 0;
  return production.selectedGood !== null && production.selectedGood !== row.goodType;
}

function goodButton(production: SettlerProductionModel, row: SettlerProductionRow): RoundButtonModel {
  const copy = messages().hud.settlerPanel;
  const face = { goodId: row.goodId };
  if (row.locked !== null) return { face, label: row.label, tooltip: row.locked, enabled: false };
  if (production.kind === 'craft') {
    return { face, label: formatMessage(copy.onlyThisLabel, { good: row.label }), tooltip: copy.onlyThis };
  }
  const all = gatherTarget(production.selectedGood, row.goodType) === null;
  const tooltip = all ? copy.gatherAll : formatMessage(copy.gatherOnly, { good: row.label });
  return { face, label: tooltip, tooltip };
}

interface RowView {
  readonly item: HTMLLIElement;
  readonly good: RoundButton;
  readonly name: HTMLElement;
  readonly counter: Counter;
  readonly lock: HTMLButtonElement;
}

/** Produkcja: one row per product the trade may make here, the good's button, its name, and a craft
 *  product's counter or a locked product's lock. */
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
      () => {
        const production = current()?.production;
        if (production == null) return;
        if (production.kind === 'craft') actions.onlyProduct(id(), goodType);
        else actions.setGatherGood(id(), gatherTarget(production.selectedGood, goodType));
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
        setClass(view.item, 'on-prod-row--stopped', productStopped(production, row));
        setHidden(view.lock, row.locked === null);
        if (row.locked !== null) {
          const lockTip = formatMessage(copy.settlerPanel.lockTooltip, {
            reason: row.locked,
            good: row.label,
          });
          setTitle(view.lock, lockTip);
          setAttribute(
            view.lock,
            'aria-label',
            formatMessage(copy.settlerPanel.knowledgeLabel, { good: row.label }),
          );
        }
        setHidden(view.counter.element, row.locked !== null || row.count === null);
        if (row.count !== null) {
          view.counter.update({
            value: row.count,
            lessLabel: formatMessage(copy.settlerPanel.less, { good: row.label }),
            moreLabel: formatMessage(copy.settlerPanel.more, { good: row.label }),
            lessTooltip: copy.settlerPanel.lessTooltip,
            moreTooltip: copy.settlerPanel.moreTooltip,
          });
        }
      });
    },
  };
}
