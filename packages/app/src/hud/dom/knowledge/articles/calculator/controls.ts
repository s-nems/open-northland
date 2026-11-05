import { formatMessage, messages } from '../../../../../i18n/index.js';
import {
  ARMOUR_IDS,
  type ArmourId,
  type CalculatorState,
  weaponGroups,
  weaponLabel,
} from '../../../../knowledge/calculator.js';
import { CAP_HITS, combatTargets, experienceBonusPct } from '../../../../knowledge/combat.js';
import { durationText, formatFactNumber } from '../../../../knowledge/facts/reader.js';
import type { KnowledgeWeapon } from '../../../../knowledge/model.js';
import { element, setStyleVar, write } from '../../../parts/dom.js';
import { type DropdownEntry, type DropdownHandle, dropdownControl } from '../../../parts/dropdown.js';
import type { KnowledgeContext } from '../../context.js';

export const SECONDS_DIGITS = 1;
export const SELECT_SKIN = 'on-res-select';

export const seconds = (value: number | null): string =>
  value === null ? '-' : durationText(value, SECONDS_DIGITS);

export const count = (value: number | null): string => (value === null ? '-' : formatFactNumber(value));

const goodIdOf = (context: KnowledgeContext, weapon: KnowledgeWeapon): string | null =>
  weapon.goodType === null ? null : (context.base.goodByType.get(weapon.goodType)?.id ?? null);

export function field(label: string, control: HTMLElement, className = ''): HTMLElement {
  const row = element('div', `kn-calc__field ${className}`.trim());
  const caption = element('span', 'kn-calc__label');
  write(caption, label);
  row.append(caption, control);
  return row;
}

export function checkbox(
  label: string,
  on: boolean,
  change: (next: boolean) => void,
): { readonly host: HTMLElement; readonly box: HTMLInputElement } {
  const host = element('label', 'kn-check');
  const box = element('input', '');
  box.type = 'checkbox';
  box.checked = on;
  box.addEventListener('change', () => change(box.checked));
  host.append(box, label);
  return { host, box };
}

/** The fight-experience slider; its readout says what the hits are worth. */
export function experienceSlider(
  value: number,
  change: (next: number) => void,
): { readonly host: HTMLElement; readonly input: HTMLInputElement } {
  const copy = messages().knowledge.mechanics;
  const host = element('div', 'kn-calc__slider');
  const input = element('input', '');
  input.type = 'range';
  input.min = '0';
  input.max = String(CAP_HITS);
  input.value = String(value);
  input.setAttribute('aria-label', copy.hitsLabel);
  const shown = element('output', 'kn-calc__value');
  const show = (hits: number): void => {
    write(shown, formatMessage(copy.experienceValue, { hits, percent: experienceBonusPct(hits) }));
  };
  show(value);
  input.addEventListener('input', () => {
    show(input.valueAsNumber);
    change(input.valueAsNumber);
  });
  host.append(input, shown);
  return { host, input };
}

export function tribeDropdown(
  context: KnowledgeContext,
  label: string,
  active: number,
  pick: (tribe: number) => void,
): DropdownHandle<string> {
  const control = dropdownControl<string>({
    label,
    className: SELECT_SKIN,
    entries: context.base.tribes.map((t) => ({ id: String(t.typeId), label: t.name })),
    active: String(active),
    onPick: (id) => {
      control.setActive(id);
      pick(Number(id));
    },
  });
  return control;
}

export function armourDropdown(
  context: KnowledgeContext,
  label: string,
  active: ArmourId,
  pick: (armour: ArmourId) => void,
): DropdownHandle<ArmourId> {
  const shown = new Map(combatTargets(context.base).map((t) => [t.id, t]));
  const names = messages().knowledge.targets;
  const control = dropdownControl<ArmourId>({
    label,
    className: SELECT_SKIN,
    entries: ARMOUR_IDS.flatMap((id) => {
      const target = shown.get(id);
      if (target === undefined) return [];
      return [{ id, label: names[id], ...(target.good === null ? {} : { goodId: target.good }) }];
    }),
    active,
    icons: context.art.goodIcon,
    onPick: (id) => {
      control.setActive(id);
      pick(id);
    },
  });
  return control;
}

/** A tribe's weapons grouped as the reader knows them, heroes last; `keep` drops rows. */
export function weaponEntries(
  context: KnowledgeContext,
  tribe: number,
  keep: (weapon: KnowledgeWeapon) => boolean = () => true,
): readonly DropdownEntry<string>[] {
  const copy = messages().knowledge.mechanics;
  return weaponGroups(context.base, tribe, true).flatMap((group) => {
    const choices = group.weapons.filter(keep).map((weapon) => {
      const goodId = goodIdOf(context, weapon);
      return { id: weapon.id, label: weaponLabel(weapon), ...(goodId === null ? {} : { goodId }) };
    });
    return choices.length === 0 ? [] : [{ group: copy.weaponGroups[group.id], choices }];
  });
}

export function weaponDropdown(
  context: KnowledgeContext,
  tribe: number,
  active: string,
  pick: (weaponId: string) => void,
  keep?: (weapon: KnowledgeWeapon) => boolean,
): DropdownHandle<string> {
  const control = dropdownControl<string>({
    label: messages().knowledge.mechanics.weaponLabel,
    className: SELECT_SKIN,
    entries: weaponEntries(context, tribe, keep),
    active,
    icons: context.art.goodIcon,
    onPick: (id) => {
      control.setActive(id);
      pick(id);
    },
  });
  return control;
}

/** More blows than this draw the bar without a mark per blow: the marks would merge. */
const MAX_BLOW_MARKS = 40;

/**
 * A health bar over `full`: `left` of it filled, a mark every `blow` across the fill when given.
 */
export function healthBar(full: number, left: number, blow: number | null, label: string): HTMLElement {
  const track = element('div', 'kn-calc__hp');
  track.setAttribute('role', 'img');
  track.setAttribute('aria-label', label);
  const fill = element('div', 'kn-calc__hp-fill');
  setStyleVar(fill, '--fill', full > 0 ? (left / full).toFixed(4) : '0');
  if (blow !== null && blow > 0 && left / blow <= MAX_BLOW_MARKS) {
    fill.classList.add('kn-calc__hp-fill--marked');
    setStyleVar(fill, '--step', Math.min(1, blow / left).toFixed(4));
  }
  track.append(fill);
  return track;
}

export function tiles(values: readonly (readonly [string, string])[]): HTMLElement {
  const strip = element('dl', 'kn-calc__strip');
  for (const [label, value] of values) {
    const box = element('div', 'kn-calc__tile');
    const term = element('dt', '');
    write(term, label);
    const data = element('dd', '');
    write(data, value);
    box.append(term, data);
    strip.append(box);
  }
  return strip;
}

export function fold(summary: string): { readonly element: HTMLDetailsElement; readonly body: HTMLElement } {
  const host = element('details', 'kn-fold kn-calc__fold');
  const title = element('summary', '');
  write(title, summary);
  const body = element('div', 'kn-calc__foldbody');
  host.append(title, body);
  return { element: host, body };
}

export type Update = (state: CalculatorState) => void;

/** The mark between the two sides: who hits whom, or who fights whom. */
export function versus(mark: string): HTMLElement {
  const node = element('span', 'kn-calc__versus');
  node.setAttribute('aria-hidden', 'true');
  write(node, mark);
  return node;
}

export function sideTitle(text: string): HTMLElement {
  const title = element('h4', 'kn-calc__title');
  write(title, text);
  return title;
}
