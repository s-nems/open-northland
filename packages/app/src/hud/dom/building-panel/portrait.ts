import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingOrdersModel, BuildingPanelModel } from '../../details-panel/model/index.js';
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
import type { BuildingPanelDeps } from './actions.js';

/** How long an armed demolition waits for its confirming press, in ms. */
export const DEMOLISH_CONFIRM_MS = 3000;

export type BuildingOrder = 'upgrade' | 'cancelUpgrade' | 'alarm' | 'demolish';

/** One order button as drawn: its face, words, and whether the press is refused. */
export interface BuildingOrderView {
  readonly order: BuildingOrder;
  readonly glyph: string;
  readonly label: string;
  readonly tooltip: string;
  readonly enabled: boolean;
  /** Lit: the alarm is up, or the demolition waits for its confirming press. */
  readonly lit: boolean;
  readonly danger: boolean;
}

/** The order buttons a house offers, in their fixed order: the tier, the alarm, the demolition last. */
export function orderViews(orders: BuildingOrdersModel, demolishArmed: boolean): BuildingOrderView[] {
  const copy = messages().hud.buildingPanel;
  const views: BuildingOrderView[] = [];
  const upgrade = orders.upgrade;
  if (upgrade !== null) {
    const cost = upgrade.cost.map((line) => `${line.amount} ${line.label}`).join(', ');
    views.push({
      order: 'upgrade',
      glyph: GLYPH.upgrade,
      label: copy.orders.upgrade,
      tooltip:
        upgrade.control !== true
          ? upgrade.control
          : cost === ''
            ? copy.orders.upgrade
            : formatMessage(copy.upgradeCost, { cost }),
      enabled: upgrade.control === true,
      lit: false,
      danger: false,
    });
  }
  if (orders.cancelUpgrade) {
    views.push({
      order: 'cancelUpgrade',
      glyph: GLYPH.cancelUpgrade,
      label: copy.orders.cancelUpgrade,
      tooltip: copy.orders.cancelUpgrade,
      enabled: true,
      lit: false,
      danger: false,
    });
  }
  if (orders.alarm !== null) {
    const on = orders.alarm.on;
    views.push({
      order: 'alarm',
      glyph: GLYPH.bell,
      label: on ? copy.orders.alarmOff : copy.orders.alarmOn,
      tooltip: on ? copy.alarmOffTooltip : copy.alarmOnTooltip,
      enabled: true,
      lit: on,
      danger: false,
    });
  }
  views.push({
    order: 'demolish',
    glyph: GLYPH.demolish,
    label: copy.orders.demolish,
    tooltip: demolishArmed ? copy.demolishConfirm : copy.orders.demolish,
    enabled: true,
    lit: demolishArmed,
    danger: true,
  });
  return views;
}

/** A demolition needs a second press on the same house while the first is fresh. */
export function demolishConfirmed(
  armed: { readonly building: number; readonly at: number } | null,
  building: number,
  now: number,
): boolean {
  return armed !== null && armed.building === building && now - armed.at < DEMOLISH_CONFIRM_MS;
}

/** The portrait block: the live building's frame as the centre-view button with its wear under it, and
 *  beside it the order buttons with the status strip along the frame's floor. */
export interface PortraitSection {
  readonly element: HTMLElement;
  /** The frame the renderer paints the live building through. */
  readonly frame: HTMLElement;
  update(model: BuildingPanelModel): void;
  /** Once a frame: an armed demolition nobody confirmed goes out. */
  refresh(): void;
}

export function createPortraitSection(
  deps: BuildingPanelDeps,
  current: () => BuildingPanelModel | null,
): PortraitSection {
  const row = element('div', 'on-portrait');
  const shot = element('div', 'on-portrait-shot');
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
  const status = element('div', 'on-status-strip', '<i class="on-status-strip__dot"></i><span></span>');
  const text = status.lastElementChild;
  if (text === null) throw new Error('building portrait: status');
  beside.append(orders, status);
  row.append(shot, beside);

  let armed: { building: number; at: number } | null = null;
  let shape = '';
  let buttons: { order: BuildingOrder; element: HTMLButtonElement }[] = [];

  const press = (order: BuildingOrder): void => {
    const shown = current();
    if (shown === null) return;
    const target = paintedViews(shown).find((candidate) => candidate.order === order);
    if (target === undefined || !target.enabled) return;
    const id = shown.entityId;
    switch (order) {
      case 'upgrade':
        deps.building.upgrade(id);
        return;
      case 'cancelUpgrade':
        deps.building.cancelUpgrade(id);
        return;
      case 'alarm':
        deps.building.setAlarm(id, shown.orders?.alarm?.on !== true);
        return;
      case 'demolish':
        if (demolishConfirmed(armed, id, deps.now())) {
          armed = null;
          deps.building.demolish(id);
        } else {
          armed = { building: id, at: deps.now() };
          deps.cue('confirm');
          paintOrders(shown);
        }
        return;
      default: {
        const unreachable: never = order;
        throw new Error(`unhandled building order: ${String(unreachable)}`);
      }
    }
  };
  const paintedViews = (model: BuildingPanelModel): BuildingOrderView[] =>
    model.orders === null
      ? []
      : orderViews(model.orders, demolishConfirmed(armed, model.entityId, deps.now()));
  const paintOrders = (model: BuildingPanelModel): void => {
    const views = paintedViews(model);
    const next = views.map((view) => view.order).join();
    if (next !== shape) {
      shape = next;
      buttons = views.map((view) => {
        const node = button(`on-order${view.danger ? ' on-order--attack' : ''}`, view.glyph);
        node.addEventListener('click', () => press(view.order));
        return { order: view.order, element: node };
      });
      orders.replaceChildren(...buttons.map((entry) => entry.element));
    }
    views.forEach((view, index) => {
      const node = buttons[index]?.element;
      if (node === undefined) return;
      setAttribute(node, 'aria-label', view.label);
      setTip(node, view.tooltip);
      setDisabled(node, !view.enabled);
      setClass(node, 'on-order--armed', view.lit);
      if (view.order === 'alarm' || view.order === 'demolish')
        setAttribute(node, 'aria-pressed', String(view.lit));
    });
    setHidden(orders, buttons.length === 0);
  };

  return {
    element: row,
    frame,
    update(model): void {
      const copy = messages().hud;
      setTip(frame, copy.buildingPanel.centre);
      setAttribute(frame, 'aria-label', copy.buildingPanel.centre);
      if (armed !== null && armed.building !== model.entityId) armed = null;
      const hp = model.health;
      setHidden(health, hp === null);
      if (hp !== null) {
        const tone = meterTone((hp.hitpoints / hp.max) * 100);
        setStyleVar(health, '--value', meterFill(hp.hitpoints, hp.max));
        setClass(health, 'on-hp--low', tone === 'low');
        setClass(health, 'on-hp--critical', tone === 'critical');
        const words = formatMessage(copy.vehiclePanel.health, { hitpoints: hp.hitpoints, max: hp.max });
        setTip(health, words);
        setAttribute(health, 'aria-label', words);
      }
      paintOrders(model);
      const state = model.status;
      write(text, state.detail === null ? state.label : `${state.label} · ${state.detail}`);
      setClass(status, 'on-status-strip--trouble', state.tone === 'trouble');
      setClass(status, 'on-status-strip--neutral', state.tone === 'neutral');
    },
    refresh(): void {
      const shown = current();
      if (armed === null || shown === null || demolishConfirmed(armed, shown.entityId, deps.now())) return;
      armed = null;
      paintOrders(shown);
    },
  };
}
