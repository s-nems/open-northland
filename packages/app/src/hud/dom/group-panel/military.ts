import { components } from '@open-northland/sim';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { ActionOrderId } from '../../action-ring/index.js';
import type { GroupScopeModel, GroupStance } from '../../details-panel/model/index.js';
import { element, setHidden, setTip, write } from '../parts/dom.js';
import { createSection } from '../parts/section.js';
import { createSegmented, type SegmentedOption } from '../parts/segmented.js';
import type { GroupPanelDeps } from './actions.js';

type Regeneration = 'allowed' | 'forbidden';

const STANCES: readonly GroupStance[] = ['attack', 'defend', 'ignore'];
/** The ring order each strip option gives, so a press obeys the gates the ring button does. */
const STANCE_ORDER: Readonly<Record<GroupStance, ActionOrderId>> = {
  attack: 'attackMode',
  defend: 'defenceMode',
  ignore: 'ignorantMode',
};
const REGENERATION_ORDER: Readonly<Record<Regeneration, ActionOrderId>> = {
  allowed: 'allowRegeneration',
  forbidden: 'prohibitRegeneration',
};

/** "Attack 20 · Defend 12": how many hold each value, the ones nobody holds left out. */
export function holdCounts<K extends string>(
  counts: Readonly<Record<K, number>>,
  labels: Readonly<Record<K, string>>,
): string {
  return (Object.keys(labels) as K[])
    .filter((key) => counts[key] > 0)
    .map((key) => `${labels[key]} ${counts[key]}`)
    .join(' · ');
}

/** Military for a group: the fighters' stance and Food and sleep, and the catapults' stance. A strip lights
 *  the value every member holds and none while they differ; each option says how many it reaches. A row
 *  the group has stays in every tab, faded where the tab holds nobody it orders. */
export interface GroupMilitarySection {
  readonly element: HTMLElement;
  update(scope: GroupScopeModel, orders: boolean): void;
}

export function createGroupMilitarySection(
  deps: GroupPanelDeps,
  scope: () => GroupScopeModel | null,
): GroupMilitarySection {
  const root = element('div', '');
  const title = createSection();
  const row = (segmented: HTMLElement): { element: HTMLElement; label: HTMLElement } => {
    const line = element('div', 'on-ledger on-ledger--ctl', '<span></span>');
    const label = line.firstElementChild;
    if (!(label instanceof HTMLElement)) throw new Error('group military: row');
    line.append(segmented);
    return { element: line, label };
  };
  const ids = (): readonly number[] => scope()?.ids ?? [];
  const stance = createSegmented(STANCES, messages().hud.settlerPanel.stance, (key) =>
    deps.actions.setStance(ids(), key),
  );
  const regeneration = createSegmented<Regeneration>(
    ['allowed', 'forbidden'],
    messages().hud.settlerPanel.regeneration,
    (key) => deps.actions.setRegeneration(ids(), key === 'allowed'),
  );
  const siege = createSegmented(components.VEHICLE_STANCES, messages().hud.groupPanel.siegeStance, (key) =>
    deps.actions.setVehicleStance(scope()?.siege?.ids ?? [], key),
  );
  const stanceRow = row(stance.element);
  const regenerationRow = row(regeneration.element);
  const siegeRow = row(siege.element);
  root.append(title.element, stanceRow.element, regenerationRow.element, siegeRow.element);

  const option = (
    label: string,
    order: ActionOrderId,
    model: GroupScopeModel,
    orders: boolean,
  ): SegmentedOption => {
    const copy = messages().hud.groupPanel;
    const reach = orders ? deps.reach(order, model.ids) : 0;
    const total = model.military?.count ?? model.ids.length;
    return {
      label,
      enabled: reach > 0,
      tooltip:
        reach > 0
          ? formatMessage(copy.orderReach, { order: label, reach, count: total })
          : formatMessage(copy.orderReachNone, { order: label }),
    };
  };

  return {
    element: root,
    update(model, orders): void {
      const hud = messages().hud;
      const copy = hud.groupPanel;
      const military = model.military;
      const vehicles = model.siege;
      setHidden(root, military === null && vehicles === null);
      title.update(copy.military);
      setHidden(stanceRow.element, military === null);
      setHidden(regenerationRow.element, military === null);
      if (military !== null) {
        const stanceLabels = { attack: hud.attack, defend: hud.defend, ignore: hud.ignore };
        write(stanceRow.label, hud.settlerPanel.stance);
        setTip(
          stanceRow.label,
          military.count === 0
            ? ''
            : formatMessage(copy.stanceCounts, { counts: holdCounts(military.stances, stanceLabels) }),
        );
        stance.update(
          {
            attack: option(hud.attack, STANCE_ORDER.attack, model, orders),
            defend: option(hud.defend, STANCE_ORDER.defend, model, orders),
            ignore: option(hud.ignore, STANCE_ORDER.ignore, model, orders),
          },
          military.stance,
        );
        write(regenerationRow.label, hud.settlerPanel.regeneration);
        regeneration.update(
          {
            allowed: option(hud.settlerPanel.allowed, REGENERATION_ORDER.allowed, model, orders),
            forbidden: option(hud.settlerPanel.forbidden, REGENERATION_ORDER.forbidden, model, orders),
          },
          military.regeneration === null ? null : military.regeneration ? 'allowed' : 'forbidden',
        );
      }
      setHidden(siegeRow.element, vehicles === null);
      if (vehicles !== null) {
        const labels = hud.vehiclePanel.stances;
        write(siegeRow.label, copy.siegeStance);
        const any = vehicles.ids.length > 0;
        setTip(
          siegeRow.label,
          any ? formatMessage(copy.stanceCounts, { counts: holdCounts(vehicles.stances, labels) }) : '',
        );
        const vehicleOption = (key: components.VehicleStance): SegmentedOption => ({
          label: labels[key],
          enabled: any,
          tooltip: any
            ? hud.vehiclePanel.stanceTooltips[key]
            : formatMessage(copy.orderReachNone, { order: labels[key] }),
        });
        siege.update(
          { attack: vehicleOption('attack'), defence: vehicleOption('defence'), hold: vehicleOption('hold') },
          vehicles.stance,
        );
      }
    },
  };
}
