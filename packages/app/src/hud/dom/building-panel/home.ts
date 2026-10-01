import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel, HomeQualityRow } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { element, setHidden, setStyleVar, setTip, write } from '../parts/dom.js';
import { meterFill } from '../parts/meter-row.js';
import { createRoundButton, type RoundButton } from '../parts/round-button.js';
import { createSection } from '../parts/section.js';
import type { BuildingPanelDeps } from './actions.js';

/** Design px of a ware's icon in its well (foundation.css `.on-good-well`). */
const WARE_ICON_PX = 18;

/** What a ware's line says after its name: the uses its pool holds, or whether the holy fire burns. */
export function wareState(row: HomeQualityRow): string {
  const copy = messages().hud.buildingPanel;
  if (row.holyFireActive !== undefined) return row.holyFireActive ? copy.holyFireOn : copy.holyFireOff;
  return formatMessage(copy.uses, { count: row.uses ?? 0 });
}

interface WareView {
  readonly item: HTMLLIElement;
  readonly name: HTMLElement;
  readonly state: HTMLElement;
  readonly toggle: RoundButton;
}

/** Household: a finished home's household wares, each with its pool on the rule and what it buys,
 *  and the owner's toggle that allows or forbids the ware in every home. */
export interface HomeSection {
  readonly element: HTMLElement;
  update(model: BuildingPanelModel): void;
}

export function createHomeSection(deps: BuildingPanelDeps): HomeSection {
  const title = createSection();
  const list = element('ul', 'on-manifest');
  const root = element('div', '');
  root.append(title.element, list);
  let shape = '';
  let views: WareView[] = [];
  let shown: BuildingPanelModel | null = null;

  const toggle = (index: number): void => {
    const quality = shown?.homeQuality;
    const row = quality?.rows[index];
    if (quality === undefined || quality === null || row === undefined || quality.control !== true) return;
    deps.building.setHouseholdGoodUse(quality.player, row.effect, !row.allowed);
  };
  const make = (row: HomeQualityRow, index: number): WareView => {
    const item = element(
      'li',
      'on-cargo-row on-cargo-row--ware',
      `<span class="on-good-well">${goodIconMarkup(WARE_ICON_PX)}</span><span class="on-cargo-row__name"></span><small class="on-cargo-row__state"></small>`,
    );
    const frame = item.querySelector('.on-good__frame');
    const name = item.querySelector('.on-cargo-row__name');
    const state = item.querySelector('.on-cargo-row__state');
    if (
      !(frame instanceof HTMLElement) ||
      !(name instanceof HTMLElement) ||
      !(state instanceof HTMLElement)
    ) {
      throw new Error('building panel: ware line');
    }
    deps.icons(frame, row.goodId, WARE_ICON_PX);
    const button = createRoundButton('ledger', () => toggle(index));
    item.append(button.element);
    return { item, name, state, toggle: button };
  };

  return {
    element: root,
    update(model): void {
      shown = model;
      const quality = model.homeQuality;
      setHidden(root, quality === null);
      if (quality === null) return;
      const copy = messages().hud.buildingPanel;
      title.update(copy.home);
      const next = quality.rows.map((row) => row.goodId).join();
      if (next !== shape) {
        shape = next;
        views = quality.rows.map(make);
        list.replaceChildren(...views.map((view) => view.item));
      }
      quality.rows.forEach((row, index) => {
        const view = views[index];
        if (view === undefined) return;
        write(view.name, row.label);
        write(view.state, wareState(row));
        setStyleVar(view.item, '--fill', meterFill(row.value, row.capacity));
        setTip(view.name, row.label);
        const words = formatMessage(row.allowed ? copy.allowed : copy.forbidden, { good: row.label });
        view.toggle.update({
          face: { glyph: row.allowed ? GLYPH.check : GLYPH.ban },
          label: words,
          tooltip: quality.control === true ? words : quality.control,
          enabled: quality.control === true,
          pressed: row.allowed,
        });
      });
    },
  };
}
