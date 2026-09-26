import { messages } from '../../../i18n/index.js';
import type { SettlerPanelModel, SettlerStatusModel } from '../../details-panel/model/index.js';
import { goodIconMarkup } from '../good-art.js';
import { button, element, setClass, setHidden, setTip, write } from '../parts/dom.js';
import { createSocket, type Socket } from '../parts/socket.js';
import type { SettlerPanelDeps } from './actions.js';
import { equipmentSockets, type SocketSpec, socketsKey } from './equipment.js';

/** Design px of the carried good in its well (foundation.css `.on-good-well`). */
const CARRIED_ICON_PX = 18;

/** The status line's words: the state and its detail after a dot. */
export function statusText(status: SettlerStatusModel): string {
  return status.detail === null ? status.label : `${status.label} · ${status.detail}`;
}

/** The status strip's dot: amber for a tradesman in trouble, green while the person is at something,
 *  grey while it merely walks or waits. */
export type StatusTone = 'ok' | 'trouble' | 'neutral';

export function statusTone(status: SettlerStatusModel): StatusTone {
  if (status.trouble) return 'trouble';
  switch (status.state) {
    case 'walking':
    case 'idle':
    case 'awaitingWorkplace':
      return 'neutral';
    default:
      return 'ok';
  }
}

/** The portrait block: the live figure's frame as the centre-view button, and beside it the column
 *  with the sockets at the top and the status strip along the frame's floor. */
export interface PortraitSection {
  readonly element: HTMLElement;
  /** The frame the renderer paints the live figure through. */
  readonly frame: HTMLElement;
  update(model: SettlerPanelModel): void;
}

export function createPortraitSection(deps: SettlerPanelDeps, entity: () => number): PortraitSection {
  const { actions } = deps;
  const row = element('div', 'on-portrait');
  const frame = button('on-portrait__frame');
  frame.addEventListener('click', () => actions.centre(entity()));
  // A right click on the figure orders it, as one on the figure in the world does.
  frame.addEventListener('contextmenu', (event) => {
    const panel = row.closest('.on-window');
    actions.openOrders(entity(), {
      x: event.clientX,
      y: event.clientY,
      panelLeft: (panel ?? row).getBoundingClientRect().left,
    });
  });
  const beside = element('div', 'on-portrait__beside');
  const equipment = element('div', 'on-equipment');
  const wornRow = element('div', 'on-equip-row');
  const bagRow = element('div', 'on-equip-row');
  equipment.append(wornRow, bagRow);
  const status = element('div', 'on-status-strip', '<i class="on-status-strip__dot"></i><span></span>');
  const statusHead = status.children[1];
  if (statusHead === undefined) throw new Error('portrait: status');
  const carrying = element(
    'span',
    'on-status-strip__carry',
    `<span></span><b class="on-with-good"><span class="on-good-well">${goodIconMarkup(CARRIED_ICON_PX)}</span><span></span></b>`,
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
    element: row,
    frame,
    update(model): void {
      const copy = messages().hud.settlerPanel;
      setTip(frame, copy.centre);
      frame.setAttribute('aria-label', copy.centre);
      updateSockets(model);
      write(statusHead, statusText(model.status));
      const tone = statusTone(model.status);
      setClass(status, 'on-status-strip--trouble', tone === 'trouble');
      setClass(status, 'on-status-strip--neutral', tone === 'neutral');
      const carried = model.status.carrying;
      setHidden(carrying, carried === null);
      if (carried !== null) {
        write(carryWord, copy.carrying);
        write(carryGood, `×${carried.amount}`);
        setTip(carrying, `${copy.carrying} ${carried.label} ×${carried.amount}`);
        const good = carried.goodId ?? '';
        if (good !== carriedGood) {
          carriedGood = good;
          carryFrame.removeAttribute('style');
          if (carried.goodId !== undefined) deps.icons(carryFrame, carried.goodId, CARRIED_ICON_PX);
        }
      }
    },
  };
}
