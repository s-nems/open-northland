import { formatMessage, messages } from '../../../i18n/index.js';
import type {
  VehicleClass,
  VehicleOrder,
  VehicleOrderModel,
  VehiclePanelModel,
} from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import {
  button,
  element,
  setAttribute,
  setClass,
  setDisabled,
  setHidden,
  setStyleVar,
  setTip,
  write,
} from '../parts/dom.js';
import { meterFill, meterTone } from '../parts/meter-row.js';
import type { VehiclePanelDeps, VehiclePick } from './actions.js';

const ORDER_GLYPH: Readonly<Record<VehicleOrder, string>> = {
  goTo: GLYPH.pin,
  stop: GLYPH.stop,
  dock: GLYPH.anchor,
  boardShip: GLYPH.boardShip,
  leaveShip: GLYPH.leaveShip,
  attackSettler: GLYPH.swords,
  attackBuilding: GLYPH.siegeHouse,
  attackVehicle: GLYPH.wheel,
  attackPosition: GLYPH.crosshair,
};

type OrderCopy = ReturnType<typeof messages>['hud']['vehiclePanel']['orders'];

/** A ship's drive sails, every other vehicle's drives. */
function orderKey(order: VehicleOrder, vehicleClass: VehicleClass): keyof OrderCopy {
  return order === 'goTo' && vehicleClass === 'ship' ? 'sail' : order;
}

/** The order's name, and what its tooltip says: the refusal, the armed pick's prompt, or the right
 *  click that gives the same order on the map. */
export function orderTexts(
  model: VehicleOrderModel,
  vehicleClass: VehicleClass,
  armed: boolean,
): { label: string; tooltip: string } {
  const copy = messages().hud.vehiclePanel;
  const key = orderKey(model.order, vehicleClass);
  const label = copy.orders[key];
  if (model.control !== true) return { label, tooltip: model.control };
  if (armed) return { label, tooltip: formatMessage(copy.armedTooltip, { order: label }) };
  const hints: Readonly<Partial<Record<keyof OrderCopy, string>>> = copy.orderHints;
  const hint = hints[key];
  return {
    label,
    tooltip: hint === undefined ? label : formatMessage(copy.orderTooltip, { order: label, hint }),
  };
}

/** The portrait block: the live vehicle's frame as the centre-view button with its wear under it, and
 *  beside it the order buttons with the status strip along the frame's floor. */
export interface PortraitSection {
  readonly element: HTMLElement;
  /** The frame the renderer paints the live vehicle through. */
  readonly frame: HTMLElement;
  update(model: VehiclePanelModel): void;
  /** Once a frame: the button whose pick waits for its target lights. */
  refresh(armed: VehiclePick | null): void;
}

export function createPortraitSection(
  deps: VehiclePanelDeps,
  current: () => VehiclePanelModel | null,
): PortraitSection {
  const row = element('div', 'on-portrait');
  const shot = element('div', 'on-vehicle-shot');
  const frame = button('on-portrait__frame');
  frame.addEventListener('click', () => {
    const shown = current();
    if (shown !== null) deps.actions.centre(shown.entityId);
  });
  const health = element('span', 'on-hp');
  health.setAttribute('role', 'meter');
  shot.append(frame, health);
  const beside = element('div', 'on-portrait__beside');
  const orders = element('div', 'on-orders');
  const status = element(
    'div',
    'on-status-strip',
    '<i class="on-status-strip__dot"></i><span><span></span></span>',
  );
  const text = status.querySelector('span > span');
  if (!(text instanceof HTMLElement)) throw new Error('vehicle portrait: status');
  const carrier = button('on-ledger__link');
  carrier.addEventListener('click', () => {
    const id = current()?.status.carrier?.id;
    if (id !== undefined) deps.actions.select(id);
  });
  text.after(' · ', carrier);
  const carrierJoint = carrier.previousSibling;
  beside.append(orders, status);
  row.append(shot, beside);

  let shape = '';
  let buttons: { order: VehicleOrder; element: HTMLButtonElement }[] = [];
  let armed: VehiclePick | null = null;
  const press = (order: VehicleOrder): void => {
    const shown = current();
    const model = [...(shown?.orders ?? []), ...(shown?.attackOrders ?? [])].find((o) => o.order === order);
    if (shown === null || model === undefined || model.control !== true) return;
    deps.vehicle.order(shown.entityId, order);
  };
  const build = (model: VehiclePanelModel): void => {
    const next = [...model.orders.map((o) => o.order), '|', ...model.attackOrders.map((o) => o.order)].join();
    if (next === shape) return;
    shape = next;
    const make = (order: VehicleOrder, attack: boolean, first: boolean): HTMLButtonElement => {
      const node = button(
        `on-order${attack ? ' on-order--attack' : ''}${first ? ' on-order--break' : ''}`,
        ORDER_GLYPH[order],
      );
      node.addEventListener('click', () => press(order));
      return node;
    };
    buttons = [
      ...model.orders.map((o) => ({ order: o.order, element: make(o.order, false, false) })),
      ...model.attackOrders.map((o, index) => ({
        order: o.order,
        element: make(o.order, true, index === 0),
      })),
    ];
    orders.replaceChildren(...buttons.map((b) => b.element));
  };
  const paintOrders = (model: VehiclePanelModel): void => {
    const all = [...model.orders, ...model.attackOrders];
    all.forEach((order, index) => {
      const node = buttons[index]?.element;
      if (node === undefined) return;
      const lit = armed === order.order;
      const texts = orderTexts(order, model.vehicleClass, lit);
      setAttribute(node, 'aria-label', texts.label);
      setTip(node, texts.tooltip);
      setDisabled(node, order.control !== true);
      setClass(node, 'on-order--armed', lit);
      setAttribute(node, 'aria-pressed', String(lit));
    });
  };

  return {
    element: row,
    frame,
    update(model): void {
      const copy = messages().hud.vehiclePanel;
      setTip(frame, copy.centre);
      setAttribute(frame, 'aria-label', copy.centre);
      const hp = model.health;
      setHidden(health, hp === null);
      if (hp !== null) {
        const fill = meterFill(hp.hitpoints, hp.max);
        const tone = meterTone((hp.hitpoints / hp.max) * 100);
        setStyleVar(health, '--value', fill);
        setClass(health, 'on-hp--low', tone === 'low');
        setClass(health, 'on-hp--critical', tone === 'critical');
        const words = formatMessage(copy.health, { hitpoints: hp.hitpoints, max: hp.max });
        setTip(health, words);
        setAttribute(health, 'aria-label', words);
      }
      build(model);
      setHidden(orders, buttons.length === 0);
      paintOrders(model);
      write(text, model.status.label);
      setClass(status, 'on-status-strip--trouble', model.status.tone === 'trouble');
      setClass(status, 'on-status-strip--neutral', model.status.tone === 'neutral');
      const ship = model.status.carrier;
      setHidden(carrier, ship === null);
      if (carrierJoint !== null) carrierJoint.textContent = ship === null ? '' : ' · ';
      if (ship !== null) {
        write(carrier, ship.label);
        setTip(carrier, copy.carrierTooltip);
      }
    },
    refresh(next): void {
      const shown = current();
      if (next === armed || shown === null) return;
      armed = next;
      paintOrders(shown);
    },
  };
}
