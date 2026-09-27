import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel } from '../../details-panel/model/index.js';
import { element, setHidden } from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';
import { createGoodLine, type GoodLine, syncLines } from './good-line.js';

/** Produkcja: one line per product (or bred species) with the running cycle's progress on its rule and
 *  the recipe in its tooltip, or a farm's one line of fields with the ripe share on the rule. What each
 *  worker makes is set in the worker's own panel. */
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
        shown[index]?.update({
          goodId: row.goodId,
          label: row.label,
          value: `${row.pct}%`,
          fill: `${row.pct}%`,
          tooltip:
            row.inputs === ''
              ? row.label
              : formatMessage(copy.needs, { good: row.label, inputs: row.inputs }),
          muted: row.pct === 0,
        });
      });
    },
  };
}
