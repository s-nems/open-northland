import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel } from '../../details-panel/model/index.js';
import { amountText } from '../parts/amount.js';
import { element, setHidden } from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';
import { createGoodLine, type GoodLine, syncLines } from './good-line.js';

/** Produkcja: one line per product (or bred species) with its ingredients as "have/need" beside the
 *  name and the running cycle's progress on its rule, or a farm's one line of fields with the ripe share
 *  on the rule. What each worker makes is set in the worker's own panel. */
export interface ProductionSection {
  readonly element: HTMLElement;
  update(model: BuildingPanelModel): void;
}

export function createProductionSection(deps: BuildingPanelDeps): ProductionSection {
  const title = createSection();
  const list = element('ul', 'on-manifest');
  const root = element('div', '');
  root.append(title.element, list);
  const lines = new Map<string, GoodLine>();
  const make = (): GoodLine => createGoodLine(deps.icons);
  return {
    element: root,
    update(model): void {
      const production = model.production;
      setHidden(root, production === null);
      if (production === null) return;
      const hud = messages().hud;
      const copy = hud.buildingPanel;
      title.update(copy.production);
      if (production.kind === 'fields') {
        const [line] = syncLines(list, lines, ['fields'], make);
        line?.update({
          goodId: production.goodId,
          label: production.label,
          value: formatMessage(copy.fields, { sown: production.sown, ripe: production.ripe }),
          fill: meterFill(production.ripe, production.sown),
          tooltip: formatMessage(hud.fieldCounters, production),
        });
        return;
      }
      const shown = syncLines(
        list,
        lines,
        production.rows.map((row) => `${row.goodType}`),
        make,
      );
      production.rows.forEach((row, index) => {
        const inputs = row.inputs.map((input) => `${input.label} ×${input.need}`).join(', ');
        shown[index]?.update({
          goodId: row.goodId,
          label: row.label,
          value: `${row.pct}%`,
          fill: `${row.pct}%`,
          tooltip: inputs === '' ? row.label : formatMessage(copy.needs, { good: row.label, inputs }),
          muted: row.pct === 0,
          needs: row.inputs.map((input) => ({
            goodId: input.goodId,
            text: `${amountText(input.have)}/${amountText(input.need)}`,
            short: input.have < input.need,
            tooltip: formatMessage(copy.need, {
              good: input.label,
              have: amountText(input.have),
              need: amountText(input.need),
            }),
          })),
        });
      });
    },
  };
}
