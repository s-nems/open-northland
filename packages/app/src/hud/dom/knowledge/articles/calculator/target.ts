import { formatMessage, messages } from '../../../../../i18n/index.js';
import {
  type BlowResult,
  type CalculatorState,
  HIT_SIDES,
  type HitSide,
  type TargetKind,
} from '../../../../knowledge/calculator.js';
import { formatFactNumber } from '../../../../knowledge/facts/reader.js';
import { button, element, setHidden, write } from '../../../parts/dom.js';
import { type DropdownEntry, dropdownControl } from '../../../parts/dropdown.js';
import { createSegmented } from '../../../parts/segmented.js';
import type { KnowledgeContext } from '../../context.js';
import {
  armourDropdown,
  checkbox,
  field,
  SELECT_SKIN,
  sideTitle,
  tribeDropdown,
  type Update,
} from './controls.js';

const TARGET_KINDS: readonly TargetKind[] = ['person', 'animal', 'building', 'vehicle'];

export function targetPanel(
  context: KnowledgeContext,
  read: () => CalculatorState,
  update: Update,
): { readonly element: HTMLElement; refresh(result: BlowResult | undefined): void } {
  const { base } = context;
  const copy = messages().knowledge.mechanics;
  const host = element('section', 'kn-calc__side');
  const pickers = element('div', 'kn-calc__pickers');
  const setTarget = (change: Partial<CalculatorState['target']>): void => {
    const state = read();
    update({ ...state, target: { ...state.target, ...change } });
  };
  const kinds = createSegmented(TARGET_KINDS, copy.targetKind, (kind) => {
    setTarget({ kind, health: null });
    paintKinds();
    fillPickers();
  });
  function paintKinds(): void {
    const names = copy.targetKinds;
    kinds.update(
      {
        person: { label: names.person },
        animal: { label: names.animal },
        building: { label: names.building },
        vehicle: { label: names.vehicle },
      },
      read().target.kind,
    );
  }
  function fillPickers(): void {
    const { target } = read();
    const list = <T extends string>(
      label: string,
      entries: readonly DropdownEntry<T>[],
      active: T,
      pick: (id: T) => void,
    ): HTMLElement => {
      const control = dropdownControl<T>({
        label,
        className: SELECT_SKIN,
        entries,
        active,
        onPick: (id) => {
          control.setActive(id);
          pick(id);
        },
      });
      return field(label, control.root);
    };
    if (target.kind === 'person') {
      const armour = field(
        copy.armourLabel,
        armourDropdown(context, copy.armourLabel, target.armour, (id) => setTarget({ armour: id })).root,
      );
      const pair = element('div', 'kn-calc__pair kn-calc__pair--check');
      pair.append(
        armour,
        checkbox(copy.defenseAmulet, target.defense, (defense) => setTarget({ defense })).host,
      );
      pickers.replaceChildren(pair);
    } else if (target.kind === 'animal') {
      pickers.replaceChildren(
        list(
          copy.targetKinds.animal,
          base.animals.map((a) => ({ id: String(a.tribe), label: a.name })),
          String(target.animal),
          (id) => setTarget({ animal: Number(id), health: null }),
        ),
      );
    } else if (target.kind === 'building') {
      const pair = element('div', 'kn-calc__pair');
      pair.append(
        list(
          copy.targetKinds.building,
          base.buildings.filter((b) => b.hitpoints !== null).map((b) => ({ id: b.id, label: b.name })),
          target.building,
          (building) => setTarget({ building, health: null }),
        ),
        field(
          copy.buildingTribe,
          tribeDropdown(context, copy.buildingTribe, target.buildingTribe, (buildingTribe) =>
            setTarget({ buildingTribe, health: null }),
          ).root,
        ),
      );
      pickers.replaceChildren(pair);
    } else {
      pickers.replaceChildren(
        list(
          copy.targetKinds.vehicle,
          base.vehicles.map((v) => ({ id: v.id, label: v.name })),
          target.vehicle,
          (vehicle) => setTarget({ vehicle, health: null }),
        ),
      );
    }
  }
  const sides = createSegmented(HIT_SIDES, copy.dialLabel, (side) => {
    const state = read();
    update({ ...state, attacker: { ...state.attacker, side } });
  });
  const sideNote = element('small', 'kn-calc__note');
  const paintSides = (enabled: boolean): void => {
    const option = (side: HitSide) => ({ label: copy.directions[side], enabled });
    sides.update(
      { front: option('front'), backSide: option('backSide'), behind: option('behind') },
      read().attacker.side,
    );
    write(sideNote, enabled ? '' : copy.dialOff);
    setHidden(sideNote, enabled);
  };
  const health = element('input', 'kn-calc__health');
  health.type = 'number';
  health.min = '1';
  health.setAttribute('aria-label', copy.healthLabel);
  health.addEventListener('input', () => {
    const typed = health.valueAsNumber;
    setTarget({ health: Number.isFinite(typed) ? typed : null });
  });
  const full = element('span', 'kn-calc__full');
  const reset = button('on-button');
  write(reset, copy.healthFull);
  reset.addEventListener('click', () => setTarget({ health: null }));
  const healthRow = element('div', 'kn-calc__healthrow');
  healthRow.append(health, full, reset);
  paintKinds();
  fillPickers();
  const sideBox = element('div', 'kn-calc__sidebox');
  sideBox.append(sides.element, sideNote);
  const lower = element('div', 'kn-calc__pair');
  lower.append(field(copy.dialLabel, sideBox), field(copy.healthLabel, healthRow));
  host.append(sideTitle(copy.targetTitle), kinds.element, pickers, lower);
  return {
    element: host,
    refresh(result): void {
      const { target } = read();
      const fullHealth = result?.target.fullHealth ?? 0;
      health.max = String(fullHealth);
      if (document.activeElement !== health || target.health === null) {
        health.value = String(target.health ?? fullHealth);
      }
      write(full, formatMessage(copy.healthOf, { full: formatFactNumber(fullHealth) }));
      setHidden(reset, target.health === null);
      paintSides(result?.target.combat.person ?? true);
    },
  };
}
