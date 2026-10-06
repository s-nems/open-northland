import type { NeedKind } from '@open-northland/sim';
import type { UiString } from '../../../content/gui-gfx.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { actionLabel } from '../../action-ring/labels.js';
import type { PanelBar, SettlerPanelModel } from '../../details-panel/model/index.js';
import { element } from '../parts/dom.js';
import { createMeterRow, type MeterRow } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import type { SettlerPanelDeps } from './actions.js';

/** The action ring's order for each need, which a press on its bar gives. */
export const NEED_ORDER: Readonly<Record<NeedKind, 'eat' | 'sleep' | 'talk' | 'pray'>> = {
  hunger: 'eat',
  fatigue: 'sleep',
  enjoyment: 'talk',
  piety: 'pray',
};

/** A bar's tooltip: its value (a stored reserve too), and for a need the order a press gives. */
export function needTooltip(bar: PanelBar, uiString: UiString): string {
  if (bar.need === undefined) return `${bar.label}: ${bar.hover}`;
  return formatMessage(messages().hud.settlerPanel.orderTooltip, {
    value: bar.hover,
    order: actionLabel(NEED_ORDER[bar.need], uiString),
  });
}

/** Wellbeing: one meter line per stat, a need line the order for that need. The hovered line's
 *  numbers show in the panel's chip, refreshed as they tick. */
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
  let bars: readonly PanelBar[] = [];
  /** The hovered line and where the cursor last was over it, so a tick refreshes the chip in place. */
  let hovered: { readonly index: number; readonly clientX: number; readonly clientY: number } | null = null;
  const showChip = (): void => {
    const bar = hovered === null ? undefined : bars[hovered.index];
    if (hovered === null || bar === undefined) deps.tooltip.hide();
    else deps.tooltip.show(hovered.clientX, hovered.clientY, needTooltip(bar, deps.uiString));
  };
  const hover = (index: number, event: MouseEvent | null): void => {
    hovered = event === null ? null : { index, clientX: event.clientX, clientY: event.clientY };
    showChip();
  };
  return {
    element: root,
    update(model): void {
      title.update(messages().hud.settlerPanel.needs);
      const orders = !model.foreign;
      const key = model.bars.map((bar) => `${bar.label}${orders ? (bar.need ?? '') : ''}`).join(',');
      if (key !== shown) {
        shown = key;
        hovered = null;
        deps.tooltip.hide();
        rows = model.bars.map((bar, index) => {
          const need = bar.need;
          return createMeterRow({
            ...(orders && need !== undefined
              ? { onPress: () => deps.actions.orderNeed(entity(), need) }
              : {}),
            onHover: (event) => hover(index, event),
          });
        });
        list.replaceChildren(...rows.map((row) => row.element));
      }
      bars = model.bars;
      model.bars.forEach((bar, index) => {
        rows[index]?.update({ label: bar.label, pct: bar.pct, tooltip: needTooltip(bar, deps.uiString) });
      });
      if (hovered !== null) showChip();
    },
  };
}
