import { formatMessage, messages } from '../../../i18n/index.js';
import type { GroupScopeModel } from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import {
  button,
  element,
  isDisabled,
  setClass,
  setDisabled,
  setHidden,
  setTip,
  write,
} from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import type { GroupPanelDeps } from './actions.js';

/** Ships for a group of ships alone: dock them along a shore picked on the map, or land the crews of
 *  the moored ones, with or without their commanders. */
export interface GroupFleetSection {
  readonly element: HTMLElement;
  update(scope: GroupScopeModel): void;
  /** Once a frame: the dock tile lights while its pick waits for the shore. */
  refresh(): void;
}

export function createGroupFleetSection(
  deps: GroupPanelDeps,
  scope: () => GroupScopeModel | null,
): GroupFleetSection {
  const root = element('div', '');
  const title = createSection();
  const tile = (glyph: string): { node: HTMLButtonElement; label: HTMLElement } => {
    const node = button('on-order on-order--tile', `${glyph}<span></span>`);
    const label = node.lastElementChild;
    if (!(label instanceof HTMLElement)) throw new Error('group fleet: tile');
    return { node, label };
  };
  const dock = tile(GLYPH.anchor);
  const unloadPassengers = tile(GLYPH.leaveShip);
  const unload = tile(GLYPH.leaveShip);
  const tiles = element('div', 'on-orders on-orders--tiles');
  tiles.append(dock.node, unloadPassengers.node, unload.node);
  root.append(title.element, tiles);
  const ids = (key: 'ids' | 'landable' | 'passengersLandable'): readonly number[] =>
    scope()?.fleet?.[key] ?? [];
  dock.node.addEventListener('click', () => {
    if (!isDisabled(dock.node)) deps.actions.dockShips(ids('ids'));
  });
  unloadPassengers.node.addEventListener('click', () => {
    if (!isDisabled(unloadPassengers.node)) deps.actions.unloadShips(ids('passengersLandable'), true);
  });
  unload.node.addEventListener('click', () => {
    if (!isDisabled(unload.node)) deps.actions.unloadShips(ids('landable'), false);
  });
  let armed = false;
  const paintDock = (): void => {
    const copy = messages().hud.vehiclePanel;
    const order = copy.orders.dock;
    write(dock.label, order);
    setTip(
      dock.node,
      formatMessage(armed ? copy.dockArmedTooltip : copy.dockTooltip, {
        order,
        key: deps.keyLabel('dockShips'),
      }),
    );
    setClass(dock.node, 'on-order--armed', armed);
  };

  return {
    element: root,
    update(model): void {
      const fleet = model.fleet;
      setHidden(root, fleet === null);
      if (fleet === null) return;
      const copy = messages().hud;
      title.update(copy.groupPanel.fleet);
      setDisabled(dock.node, fleet.ids.length === 0);
      paintDock();
      const paintUnload = (
        node: HTMLButtonElement,
        label: HTMLElement,
        text: string,
        ships: readonly number[],
        tooltip: string,
        none: string,
      ): void => {
        write(label, text);
        setDisabled(node, ships.length === 0);
        setTip(
          node,
          ships.length === 0
            ? none
            : formatMessage(tooltip, { count: ships.length, total: fleet.ids.length }),
        );
      };
      paintUnload(
        unloadPassengers.node,
        unloadPassengers.label,
        copy.vehiclePanel.unloadPassengers,
        fleet.passengersLandable,
        copy.groupPanel.unloadFleetPassengersTooltip,
        copy.groupPanel.unloadFleetPassengersNone,
      );
      paintUnload(
        unload.node,
        unload.label,
        copy.vehiclePanel.unloadAll,
        fleet.landable,
        copy.groupPanel.unloadFleetTooltip,
        copy.groupPanel.unloadFleetNone,
      );
    },
    refresh(): void {
      const next = deps.dockArmed(ids('ids'));
      if (next === armed) return;
      armed = next;
      paintDock();
    },
  };
}
