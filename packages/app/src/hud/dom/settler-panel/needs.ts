import type { NeedKind } from '@open-northland/sim';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { PanelBar, SettlerPanelModel } from '../../details-panel/model/index.js';
import { element } from '../parts/dom.js';
import { createMeterRow, type MeterRow } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';

/** The action ring's order for each need, which a press on its bar gives. */
const NEED_ORDER: Readonly<Record<NeedKind, 'eat' | 'sleep' | 'talk' | 'pray'>> = {
  hunger: 'eat',
  fatigue: 'sleep',
  enjoyment: 'talk',
  piety: 'pray',
};

/** A bar's tooltip: its value (a stored reserve too), and for a need the order a press gives. */
export function needTooltip(bar: PanelBar): string {
  if (bar.need === undefined) return `${bar.label}: ${bar.hover}`;
  return formatMessage(messages().hud.settlerPanel.orderTooltip, {
    value: bar.hover,
    order: messages().actionRing[NEED_ORDER[bar.need]],
  });
}

/** Samopoczucie: one meter line per stat, a need line the order for that need. */
export interface NeedsSection {
  readonly element: HTMLElement;
  update(model: SettlerPanelModel): void;
}

export function createNeedsSection(deps: SettlerPanelDeps, entity: () => number): NeedsSection {
  const root = element('div', '');
  const title = createSection();
  const list = element('div', '');
  root.append(title.element, list);
  let shown = '';
  let rows: MeterRow[] = [];
  return {
    element: root,
    update(model): void {
      title.update(messages().hud.settlerPanel.needs);
      const orders = !model.foreign;
      const key = model.bars.map((bar) => `${bar.label}${orders ? (bar.need ?? '') : ''}`).join(',');
      if (key !== shown) {
        shown = key;
        rows = model.bars.map((bar) => {
          const need = bar.need;
          return createMeterRow(
            orders && need !== undefined ? () => deps.actions.orderNeed(entity(), need) : undefined,
          );
        });
        list.replaceChildren(...rows.map((row) => row.element));
      }
      model.bars.forEach((bar, index) => {
        rows[index]?.update({ label: bar.label, pct: bar.pct, tooltip: needTooltip(bar) });
      });
    },
  };
}
