import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel } from '../../details-panel/model/index.js';
import { amountText } from '../parts/amount.js';
import { button, element, setAttribute, setHidden, write } from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';
import { createGoodLine, type GoodLine, syncLines } from './good-line.js';

/** A list of this many products or more folds to the batches in flight behind "rozwiń". */
export const PRODUCTION_FOLD_FROM = 4;

/** Produkcja: one line per product (or bred species) with its ingredients as "have/need" beside the
 *  name and the running cycle's progress on its rule, or a farm's one line of fields with the ripe share
 *  on the rule. A long list shows only the batches in flight until unfolded, so Magazyn stays in view;
 *  the choice holds for the next house. What each worker makes is set in the worker's own panel. */
export interface ProductionSection {
  readonly element: HTMLElement;
  update(model: BuildingPanelModel): void;
}

export function createProductionSection(deps: BuildingPanelDeps): ProductionSection {
  const toggle = button('on-more');
  const title = createSection(toggle);
  const list = element('ul', 'on-manifest');
  const idle = element('p', 'on-building-empty on-ledger--muted');
  const root = element('div', '');
  root.append(title.element, list, idle);
  const lines = new Map<string, GoodLine>();
  const make = (): GoodLine => createGoodLine(deps.icons);
  let open = false;
  let shown: BuildingPanelModel | null = null;
  toggle.addEventListener('click', () => {
    open = !open;
    if (shown !== null) paint(shown);
  });

  /** Offer the fold for `count` products; true while the list is folded. */
  const paintToggle = (count: number): boolean => {
    const copy = messages().hud.buildingPanel;
    const foldable = count >= PRODUCTION_FOLD_FROM;
    setHidden(toggle, !foldable);
    write(toggle, open ? copy.productionFold : formatMessage(copy.productionUnfold, { count }));
    setAttribute(toggle, 'aria-expanded', String(open));
    return foldable && !open;
  };
  const paint = (model: BuildingPanelModel): void => {
    shown = model;
    const production = model.production;
    setHidden(root, production === null);
    if (production === null) return;
    const hud = messages().hud;
    const copy = hud.buildingPanel;
    title.update(copy.production);
    if (production.kind === 'fields') {
      paintToggle(0);
      setHidden(idle, true);
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
    const folded = paintToggle(production.rows.length);
    const kept = syncLines(
      list,
      lines,
      production.rows.map((row) => `${row.goodType}`),
      make,
    );
    const quiet = folded && !production.rows.some((row) => row.running);
    setHidden(idle, !quiet);
    write(idle, copy.productionIdle);
    production.rows.forEach((row, index) => {
      const line = kept[index];
      if (line === undefined) return;
      setHidden(line.element, folded && !row.running);
      const inputs = row.inputs.map((input) => `${input.label} ×${input.need}`).join(', ');
      line.update({
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
  };

  return { element: root, update: paint };
}
