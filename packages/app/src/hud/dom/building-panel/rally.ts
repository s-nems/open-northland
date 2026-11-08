import { messages } from '../../../i18n/index.js';
import type { BuildingPanelModel } from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { button, setAttribute, setClass, setHidden, setTip, write } from '../parts/dom.js';
import type { BuildingPanelDeps } from './actions.js';

export interface RallySection {
  readonly setButton: HTMLButtonElement;
  update(model: BuildingPanelModel): void;
}

/** The barracks' rally tile sets a flag, moves it, or removes it when clicked again. */
export function createRallySection(
  deps: BuildingPanelDeps,
  current: () => BuildingPanelModel | null,
): RallySection {
  const set = button('on-order on-order--tile on-rally', `${GLYPH.banner}<span></span>`);
  const setLabel = set.lastElementChild;
  if (!(setLabel instanceof HTMLElement)) throw new Error('building rally: label');
  set.addEventListener('click', () => {
    const shown = current();
    const rally = shown?.orders?.rally;
    if (shown === null || rally == null) return;
    if (rally.set) deps.building.clearRallyPoint(shown.entityId);
    else deps.building.armRallyPoint(shown.entityId);
  });

  return {
    setButton: set,
    update(model): void {
      const rally = model.orders?.rally ?? null;
      setHidden(set, rally === null);
      if (rally === null) return;
      const copy = messages().hud.buildingPanel;
      write(setLabel, copy.orders.rallyLabel);
      setTip(set, rally.set ? copy.rallyClearTooltip : copy.rallySetTooltip);
      setAttribute(set, 'aria-label', rally.set ? copy.orders.rallyClear : copy.orders.rallySet);
      setClass(set, 'on-rally--on', rally.set);
    },
  };
}
