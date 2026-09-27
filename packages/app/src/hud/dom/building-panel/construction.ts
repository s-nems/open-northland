import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel } from '../../details-panel/model/index.js';
import { element, setHidden, write } from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';
import { createGoodLine, type GoodLine, syncLines } from './good-line.js';

/** Budowa or Rozbudowa: how far the site has come on the rule, then one line per material of its bill,
 *  delivered against needed with what is on its way. */
export interface ConstructionSection {
  readonly element: HTMLElement;
  update(model: BuildingPanelModel): void;
}

export function createConstructionSection(deps: BuildingPanelDeps): ConstructionSection {
  const progress = element('span', 'on-section__count');
  const title = createSection(progress);
  const list = element('ul', 'on-manifest');
  const root = element('div', '');
  root.append(title.element, list);
  const lines = new Map<string, GoodLine>();
  return {
    element: root,
    update(model): void {
      const site = model.construction;
      setHidden(root, site === null);
      if (site === null) return;
      const copy = messages().hud.buildingPanel;
      title.update(site.upgrade ? copy.upgradeSection : copy.construction);
      write(progress, `${site.pct}%`);
      const shown = syncLines(
        list,
        lines,
        site.rows.map((row) => `${row.goodType}`),
        () => createGoodLine(deps.icons),
      );
      site.rows.forEach((row, index) => {
        const words = formatMessage(copy.billRow, {
          good: row.label,
          delivered: row.delivered,
          needed: row.needed,
        });
        const inbound = row.inbound > 0 ? formatMessage(copy.billInbound, { count: row.inbound }) : null;
        shown[index]?.update({
          goodId: row.goodId,
          label: row.label,
          value: `${row.delivered} / ${row.needed}`,
          ...(row.inbound > 0 ? { aside: `+${row.inbound}` } : {}),
          fill: meterFill(row.delivered, row.needed),
          tooltip: inbound === null ? words : `${words} · ${inbound}`,
          muted: row.delivered >= row.needed,
        });
      });
    },
  };
}
