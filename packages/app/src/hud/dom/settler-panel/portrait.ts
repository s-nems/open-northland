import { formatMessage, messages } from '../../../i18n/index.js';
import type { SettlerPanelModel, SettlerStatusModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setClass, setHidden, setTitle, write } from '../parts/dom.js';
import { createSocket, type Socket } from '../parts/socket.js';
import type { SettlerPanelDeps } from './actions.js';
import { equipmentSockets, type SocketSpec, socketsKey } from './equipment.js';

/** Design px of the carried good in its well (foundation.css `.on-good-well`). */
const CARRIED_ICON_PX = 20;

/** The status line's words: the state and its detail after a dot. */
export function statusText(status: SettlerStatusModel): string {
  return status.detail === null ? status.label : `${status.label} · ${status.detail}`;
}

/** The portrait row (the live figure's frame as the centre-view button, the sockets and the status line
 *  beside it) and the profession button under it. */
export interface PortraitSection {
  readonly element: HTMLElement;
  /** The frame the renderer paints the live figure through. */
  readonly frame: HTMLElement;
  update(model: SettlerPanelModel): void;
}

export function createPortraitSection(deps: SettlerPanelDeps, entity: () => number): PortraitSection {
  const { actions } = deps;
  const root = element('div', '');
  const row = element('div', 'on-portrait');
  const frame = button('on-portrait__frame');
  frame.addEventListener('click', () => actions.centre(entity()));
  const beside = element('div', 'on-beside');
  const equipment = element('div', 'on-equipment');
  const wornRow = element('div', 'on-equip-row');
  const bagRow = element('div', 'on-equip-row');
  equipment.append(wornRow, bagRow);
  const status = element('div', 'on-settler-status', '<span></span>');
  const statusHead = status.firstElementChild;
  if (statusHead === null) throw new Error('portrait: status');
  const carrying = element(
    'span',
    '',
    `<span></span> <b class="on-with-good"><span class="on-good-well">${goodIconMarkup(CARRIED_ICON_PX)}</span><span></span></b>`,
  );
  const [carryWord, carryGood] = [
    carrying.children[0],
    carrying.querySelector('.on-with-good > span:last-child'),
  ];
  const carryFrame = carrying.querySelector('.on-good__frame');
  if (carryWord === undefined || carryGood === null || !(carryFrame instanceof HTMLElement)) {
    throw new Error('portrait: carried good');
  }
  status.append(carrying);
  beside.append(equipment, status);
  row.append(frame, beside);
  const profession = button('on-button on-button--rounded', `${GLYPH.forge}<span></span>`);
  profession.addEventListener('click', () => actions.changeProfession(entity()));
  const professionText = profession.lastElementChild;
  if (professionText === null) throw new Error('portrait: profession');
  const orders = element('div', 'on-orders on-orders--inline');
  orders.append(profession);
  root.append(row, orders);

  let shownSockets = '';
  let sockets: Socket[] = [];
  let specs: SocketSpec[] = [];
  let carriedGood = '';
  const pressable = (spec: SocketSpec): boolean =>
    specs.some(
      (live) => live.ref.group === spec.ref.group && live.ref.slot === spec.ref.slot && live.pressable,
    );
  const updateSockets = (model: SettlerPanelModel): void => {
    const rows = equipmentSockets(model.equipmentRows, model.role === 'hero');
    const key = socketsKey(rows);
    if (key !== shownSockets) {
      shownSockets = key;
      const make = (spec: SocketSpec): Socket =>
        createSocket({
          fixed: spec.fixed,
          bag: spec.bag,
          icons: deps.icons,
          onPress: () => {
            if (pressable(spec)) actions.equip(entity(), spec.ref);
          },
          onRemove: () => actions.unequip(entity(), spec.ref),
        });
      const worn = rows.worn.map(make);
      const bag = rows.bag.map(make);
      wornRow.replaceChildren(...worn.map((socket) => socket.element));
      bagRow.replaceChildren(...bag.map((socket) => socket.element));
      sockets = [...worn, ...bag];
    }
    specs = [...rows.worn, ...rows.bag];
    specs.forEach((spec, index) => {
      sockets[index]?.update(spec.model);
    });
    setHidden(equipment, specs.length === 0);
    setHidden(bagRow, rows.bag.length === 0);
  };

  return {
    element: root,
    frame,
    update(model): void {
      const copy = messages().hud.settlerPanel;
      setTitle(frame, copy.centre);
      frame.setAttribute('aria-label', copy.centre);
      updateSockets(model);
      write(statusHead, statusText(model.status));
      setClass(status, 'on-settler-status--trouble', model.status.trouble);
      const carried = model.status.carrying;
      setHidden(carrying, carried === null);
      if (carried !== null) {
        write(carryWord, ` · ${copy.carrying}`);
        write(carryGood, `${carried.label} ×${carried.amount}`);
        const good = carried.goodId ?? '';
        if (good !== carriedGood) {
          carriedGood = good;
          carryFrame.removeAttribute('style');
          if (carried.goodId !== undefined) deps.icons(carryFrame, carried.goodId, CARRIED_ICON_PX);
        }
      }
      setHidden(orders, !model.canChangeProfession);
      write(professionText, copy.changeProfession);
      setTitle(
        profession,
        formatMessage(copy.changeProfessionTooltip, { key: deps.keyLabel('professionPicker') }),
      );
    },
  };
}
