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

export type BuildingOrder = 'upgrade' | 'cancelUpgrade' | 'workers' | 'knowledge' | 'demolish';

/** One order tile as drawn: its face, words, and whether the press is refused. */
export interface BuildingOrderView {
  readonly order: BuildingOrder;
  readonly glyph: string;
  readonly label: string;
  readonly tooltip: string;
  readonly enabled: boolean;
  readonly danger: boolean;
}

/**
 * The order tiles in their fixed places, so a hand learns them: Workers, Knowledge, Demolish, then Upgrade
 * (Cancel while a tier is being raised), last so a top tier without it leaves no gap between the others.
 * A refused order stays in its place, faded, its tooltip the reason. Another seat's building offers
 * Knowledge alone.
 */
export function orderViews(model: Pick<BuildingPanelModel, 'orders' | 'name'>): BuildingOrderView[] {
  const copy = messages().hud.buildingPanel;
  const knowledge: BuildingOrderView = {
    order: 'knowledge',
    glyph: GLYPH.book,
    label: copy.orders.knowledge,
    tooltip: formatMessage(copy.knowledgeTooltip, { name: model.name }),
    enabled: true,
    danger: false,
  };
  const orders = model.orders;
  if (orders === null) return [knowledge];
  const hire = orders.hire;
  const tier = tierView(orders);
  return [
    {
      order: 'workers',
      glyph: GLYPH.people,
      label: copy.orders.workers,
      tooltip: hire === null ? copy.hireNone : formatMessage(copy.hireTooltip, { job: hire.label }),
      enabled: hire !== null,
      danger: false,
    },
    knowledge,
    {
      order: 'demolish',
      glyph: GLYPH.demolish,
      label: copy.orders.demolish,
      tooltip: copy.orders.demolish,
      enabled: true,
      danger: true,
    },
    ...(tier === null ? [] : [tier]),
  ];
}

/** Cancel while a tier is being raised, else Upgrade with its bill or refusal; null on a top tier. */
function tierView(orders: BuildingOrdersModel): BuildingOrderView | null {
  const copy = messages().hud.buildingPanel;
  if (orders.cancelUpgrade)
    return {
      order: 'cancelUpgrade',
      glyph: GLYPH.cancelUpgrade,
      label: copy.orders.cancelUpgradeShort,
      tooltip: copy.orders.cancelUpgrade,
      enabled: true,
      danger: false,
    };
  const upgrade = orders.upgrade;
  if (upgrade === null) return null;
  const cost = upgrade.cost.map((line) => `${line.amount} ${line.label}`).join(', ');
  return {
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
    danger: false,
  };
}

/** The portrait block: the live building's frame as the centre-view button with its wear under it, and
 *  beside it the order tiles with the status strip along the frame's floor. A house that shelters
 *  civilians carries its alarm bell at the strip's end, since the alarm is a state the strip names. */
export interface PortraitSection {
  readonly element: HTMLElement;
  /** The frame the renderer paints the live building through. */
  readonly frame: HTMLElement;
  update(model: BuildingPanelModel): void;
  /** Press an order tile as a click would; false when the shown building lacks it or refuses it. */
  press(order: BuildingOrder): boolean;
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
  const orders = element('div', 'on-orders on-orders--tiles');
  const status = element('div', 'on-status-strip', '<i class="on-status-strip__dot"></i><span></span>');
  const text = status.lastElementChild;
  if (!(text instanceof HTMLElement)) throw new Error('building portrait: status');
  status.tabIndex = 0;
  const bell = button('on-status-strip__bell', GLYPH.bell);
  bell.addEventListener('click', () => {
    const shown = current();
    const alarm = shown?.orders?.alarm;
    if (shown === null || alarm == null) return;
    deps.building.setAlarm(shown.entityId, !alarm.on);
  });
  status.append(bell);
  beside.append(orders, status);
  row.append(shot, beside);

  let shape = '';
  let tiles: { order: BuildingOrder; element: HTMLButtonElement }[] = [];

  const press = (order: BuildingOrder): boolean => {
    const shown = current();
    if (shown === null) return false;
    const target = orderViews(shown).find((candidate) => candidate.order === order);
    if (target === undefined || !target.enabled) return false;
    const id = shown.entityId;
    switch (order) {
      case 'upgrade':
        deps.building.upgrade(id);
        return true;
      case 'cancelUpgrade':
        deps.building.cancelUpgrade(id);
        return true;
      case 'workers':
        if (shown.orders?.hire != null) deps.windows.residentsFor(shown.orders.hire.jobType);
        return true;
      case 'knowledge':
        deps.windows.knowledge(shown.typeId);
        return true;
      case 'demolish':
        deps.building.demolish(id, shown.name);
        return true;
      default: {
        const unreachable: never = order;
        throw new Error(`unhandled building order: ${String(unreachable)}`);
      }
    }
  };
  const paintOrders = (model: BuildingPanelModel): void => {
    const views = orderViews(model);
    const next = views.map((view) => view.order).join();
    if (next !== shape) {
      shape = next;
      tiles = views.map((view) => {
        const node = button(
          `on-order on-order--tile${view.danger ? ' on-order--attack' : ''}`,
          `${view.glyph}<span></span>`,
        );
        node.addEventListener('click', () => press(view.order));
        return { order: view.order, element: node };
      });
      orders.replaceChildren(...tiles.map((entry) => entry.element));
    }
    views.forEach((view, index) => {
      const node = tiles[index]?.element;
      const label = node?.lastElementChild;
      if (node === undefined || label == null) return;
      write(label, view.label);
      setTip(node, view.tooltip);
      setDisabled(node, !view.enabled);
    });
  };

  return {
    element: row,
    frame,
    press,
    update(model): void {
      const copy = messages().hud;
      setTip(frame, copy.buildingPanel.centre);
      setAttribute(frame, 'aria-label', copy.buildingPanel.centre);
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
      const statusWords = state.detail === null ? state.label : `${state.label} · ${state.detail}`;
      write(text, statusWords);
      setTip(status, statusWords);
      setAttribute(status, 'aria-label', statusWords);
      setClass(status, 'on-status-strip--trouble', state.tone === 'trouble');
      setClass(status, 'on-status-strip--neutral', state.tone === 'neutral');
      const alarm = model.orders?.alarm ?? null;
      setHidden(bell, alarm === null);
      if (alarm !== null) {
        const words = alarm.on ? copy.buildingPanel.alarmOffTooltip : copy.buildingPanel.alarmOnTooltip;
        setTip(bell, words);
        setAttribute(
          bell,
          'aria-label',
          alarm.on ? copy.buildingPanel.orders.alarmOff : copy.buildingPanel.orders.alarmOn,
        );
        setAttribute(bell, 'aria-pressed', String(alarm.on));
        setClass(bell, 'on-status-strip__bell--on', alarm.on);
      }
    },
  };
}
