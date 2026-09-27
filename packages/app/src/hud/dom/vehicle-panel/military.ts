import { components } from '@open-northland/sim';
import { messages } from '../../../i18n/index.js';
import type { VehiclePanelModel, VehicleStance } from '../../details-panel/model/index.js';
import { element, setHidden, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import { createSegmented } from '../parts/segmented.js';
import type { VehiclePanelDeps } from './actions.js';

/** Wojsko: a siege engine's stance, the soldier's Postawa strip with the vehicle's three stances. */
export interface MilitarySection {
  readonly element: HTMLElement;
  update(model: VehiclePanelModel): void;
}

export function createMilitarySection(
  deps: VehiclePanelDeps,
  current: () => VehiclePanelModel | null,
): MilitarySection {
  const root = element('div', '');
  const title = createSection();
  const line = element('div', 'on-ledger on-ledger--ctl', '<span></span>');
  const label = line.firstElementChild;
  if (!(label instanceof HTMLElement)) throw new Error('vehicle military: row');
  const stance = createSegmented<VehicleStance>(
    components.VEHICLE_STANCES,
    messages().hud.settlerPanel.stance,
    (key) => {
      const shown = current();
      if (shown !== null) deps.vehicle.setStance(shown.entityId, key);
    },
  );
  line.append(stance.element);
  root.append(title.element, line);
  return {
    element: root,
    update(model): void {
      setHidden(root, model.stance === null);
      if (model.stance === null) return;
      const copy = messages().hud;
      title.update(copy.settlerPanel.military);
      write(label, copy.settlerPanel.stance);
      const names = copy.vehiclePanel.stances;
      const tips = copy.vehiclePanel.stanceTooltips;
      stance.update(
        {
          attack: { label: names.attack, tooltip: tips.attack },
          defence: { label: names.defence, tooltip: tips.defence },
          hold: { label: names.hold, tooltip: tips.hold },
        },
        model.stance,
        copy.settlerPanel.stance,
      );
    },
  };
}
