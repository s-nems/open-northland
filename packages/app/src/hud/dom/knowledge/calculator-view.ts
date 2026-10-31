import { formatMessage, messages } from '../../../i18n/index.js';
import { FIELD_KEYS_ATTRIBUTE } from '../../hotkeys.js';
import type { KnowledgeWeapon } from '../../knowledge/base.js';
import {
  ARMOUR_IDS,
  type ArmourId,
  type BlowResult,
  type BreakdownRow,
  blowResult,
  type CalculatorState,
  DIAL_SECTORS,
  type DialSectorId,
  type DuelFighter,
  duelResult,
  initialCalculator,
  ranking,
  type TargetKind,
  weaponFor,
  weaponGroups,
  weaponLabel,
  withHomeTribe,
  withWeapon,
} from '../../knowledge/calculator.js';
import {
  CAP_HITS,
  combatTargets,
  gainsFightExperience,
  takesStrengthAmulet,
} from '../../knowledge/combat.js';
import { formatFactNumber } from '../../knowledge/facts.js';
import { goodIconMarkup } from '../good-art.js';
import { button, element, setHidden, setStyleVar, write } from '../parts/dom.js';
import { type DropdownEntry, type DropdownHandle, dropdownControl } from '../parts/dropdown.js';
import { createSegmented } from '../parts/segmented.js';
import type { KnowledgeContext } from './context.js';
import './calculator.css';

const WEAPON_ICON_PX = 22;
const SECONDS_DIGITS = 1;
const SECONDS_PER_MINUTE = 60;
const SELECT_SKIN = 'on-res-select';
const TARGET_KINDS: readonly TargetKind[] = ['person', 'animal', 'building', 'vehicle'];
const MODES = ['blow', 'duel'] as const;
const DIAL_SIZE = 76;
const DIAL_OUTER = 36;
const DIAL_INNER = 13;
const FULL_TURN = 360;
const HALF_TURN = 180;
const QUARTER_TURN = 90;
const DIAL_GAP_DEGREES = 2;

/** One per window: reopening the article or stepping back finds the fight as it was left. */
const states = new WeakMap<KnowledgeContext, CalculatorState>();

function stateOf(context: KnowledgeContext): CalculatorState {
  const held = states.get(context);
  const state =
    held === undefined
      ? initialCalculator(context.base, context.tribe())
      : withHomeTribe(held, context.tribe());
  states.set(context, state);
  return state;
}

export function selectCalculatorWeapon(context: KnowledgeContext, weaponId: string): void {
  states.set(context, withWeapon(stateOf(context), weaponId));
}

export function focusCalculator(page: HTMLElement): void {
  page.querySelector('.kn-calc')?.scrollIntoView({ block: 'start' });
  page.querySelector<HTMLElement>('.kn-calc__weapon input:checked')?.focus({ preventScroll: true });
}

function seconds(value: number | null): string {
  if (value === null) return '-';
  const copy = messages().knowledge.mechanics;
  if (value < SECONDS_PER_MINUTE) {
    return formatMessage(copy.seconds, { seconds: formatFactNumber(value, SECONDS_DIGITS) });
  }
  const whole = Math.round(value);
  return formatMessage(copy.minutes, {
    minutes: Math.floor(whole / SECONDS_PER_MINUTE),
    seconds: whole % SECONDS_PER_MINUTE,
  });
}

const count = (value: number | null): string => (value === null ? '-' : formatFactNumber(value));

const goodIdOf = (context: KnowledgeContext, weapon: KnowledgeWeapon): string | null =>
  weapon.goodType === null ? null : (context.base.goodByType.get(weapon.goodType)?.id ?? null);

function field(label: string, control: HTMLElement): HTMLElement {
  const row = element('div', 'kn-calc__field');
  const caption = element('span', 'kn-calc__label');
  write(caption, label);
  row.append(caption, control);
  return row;
}

function checkbox(
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

function slider(
  label: string,
  value: number,
  change: (next: number) => void,
): { readonly host: HTMLElement; readonly input: HTMLInputElement } {
  const host = element('div', 'kn-calc__slider');
  const input = element('input', '');
  input.type = 'range';
  input.min = '0';
  input.max = String(CAP_HITS);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  const shown = element('output', 'kn-calc__value');
  write(shown, String(value));
  input.addEventListener('input', () => {
    write(shown, input.value);
    change(input.valueAsNumber);
  });
  host.append(input, shown);
  return { host, input };
}

function tribeDropdown(
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

function armourDropdown(
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

function sectorPath(index: number): string {
  const centre = DIAL_SIZE / 2;
  const step = FULL_TURN / DIAL_SECTORS.length;
  const point = (radius: number, degrees: number): string => {
    const radians = ((degrees - QUARTER_TURN) * Math.PI) / HALF_TURN;
    return `${(centre + radius * Math.cos(radians)).toFixed(2)} ${(centre + radius * Math.sin(radians)).toFixed(2)}`;
  };
  const from = index * step - step / 2 + DIAL_GAP_DEGREES;
  const to = index * step + step / 2 - DIAL_GAP_DEGREES;
  return `M${point(DIAL_INNER, from)} L${point(DIAL_OUTER, from)} A${DIAL_OUTER} ${DIAL_OUTER} 0 0 1 ${point(DIAL_OUTER, to)} L${point(DIAL_INNER, to)} A${DIAL_INNER} ${DIAL_INNER} 0 0 0 ${point(DIAL_INNER, from)} Z`;
}

/** Six sides round a target facing up; a radio group, so the arrows walk it and one Tab leaves it. */
function createDial(
  active: DialSectorId,
  pick: (sector: DialSectorId) => void,
): { readonly element: HTMLElement; setEnabled(on: boolean): void } {
  const copy = messages().knowledge.mechanics;
  const host = element('div', 'kn-dial');
  const paths = DIAL_SECTORS.map((_, i) => `<path class="kn-dial__sector" d="${sectorPath(i)}"></path>`);
  const centre = DIAL_SIZE / 2;
  const face = DIAL_INNER / 2;
  host.innerHTML = `<svg viewBox="0 0 ${DIAL_SIZE} ${DIAL_SIZE}" role="radiogroup">${paths.join('')}<path class="kn-dial__face" d="M${centre} ${centre - face} l${face} ${DIAL_INNER} h${-DIAL_INNER} Z"></path></svg>`;
  const svg = host.querySelector('svg');
  svg?.setAttribute('aria-label', copy.dialLabel);
  const caption = element('span', 'kn-dial__caption');
  host.append(caption);
  const sectors = [...host.querySelectorAll<SVGPathElement>('.kn-dial__sector')];
  let enabled = true;
  const light = (id: DialSectorId): void => {
    sectors.forEach((sector, i) => {
      const on = DIAL_SECTORS[i]?.id === id;
      sector.setAttribute('aria-checked', String(on));
      sector.setAttribute('tabindex', on && enabled ? '0' : '-1');
    });
    write(caption, enabled ? copy.dialSectors[id] : copy.dialOff);
  };
  sectors.forEach((sector, i) => {
    const entry = DIAL_SECTORS[i];
    if (entry === undefined) return;
    sector.setAttribute('role', 'radio');
    sector.setAttribute('aria-label', copy.dialSectors[entry.id]);
    const choose = (): void => {
      if (!enabled) return;
      light(entry.id);
      pick(entry.id);
    };
    sector.addEventListener('click', choose);
    sector.addEventListener('keydown', (event) => {
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      if (event.key === ' ' || event.key === 'Enter') choose();
      if (!forward && !backward && event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (!forward && !backward) return;
      const next = (i + (forward ? 1 : -1) + sectors.length) % sectors.length;
      const target = DIAL_SECTORS[next];
      if (target === undefined || !enabled) return;
      light(target.id);
      pick(target.id);
      sectors[next]?.focus();
    });
  });
  light(active);
  return {
    element: host,
    setEnabled(on): void {
      enabled = on;
      host.classList.toggle('kn-dial--off', !on);
      const at = sectors.findIndex((s) => s.getAttribute('aria-checked') === 'true');
      light(DIAL_SECTORS[at]?.id ?? active);
    },
  };
}

function breakdownTable(rows: readonly BreakdownRow[]): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const table = element('table', 'kn-table kn-calc__breakdown');
  const caption = element('caption', '');
  write(caption, copy.breakdownTitle);
  const head = element('tr', '');
  for (const [label, numeric] of [
    [copy.breakdownStep, false],
    [copy.breakdownChange, true],
    [copy.breakdownValue, true],
  ] as const) {
    const cell = element('th', numeric ? 'kn-num' : '');
    write(cell, label);
    head.append(cell);
  }
  const thead = element('thead', '');
  thead.append(head);
  const body = element('tbody', '');
  for (const row of rows) {
    const line = element('tr', row.skip === null ? '' : 'kn-calc__skipped');
    const name = element('th', '');
    name.scope = 'row';
    write(name, copy.breakdownSteps[row.id]);
    if (row.skip !== null) {
      const reason = element('small', '');
      write(reason, copy.skips[row.skip]);
      name.append(' ', reason);
    }
    const change = element('td', 'kn-num');
    const shown = row.id === 'base' || row.change === 0 ? '' : formatFactNumber(row.change);
    write(change, row.change > 0 && shown !== '' ? `+${shown}` : shown);
    const value = element('td', 'kn-num');
    write(value, formatFactNumber(row.value));
    line.append(name, change, value);
    body.append(line);
  }
  table.append(caption, thead, body);
  return table;
}

function strip(result: BlowResult | undefined): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const host = element('dl', 'kn-calc__strip');
  host.setAttribute('aria-live', 'polite');
  const tile = (label: string, value: string): void => {
    const box = element('div', 'kn-calc__tile');
    const term = element('dt', '');
    write(term, label);
    const data = element('dd', '');
    write(data, value);
    box.append(term, data);
    host.append(box);
  };
  tile(copy.resultDamage, count(result?.damage ?? null));
  tile(copy.resultHits, count(result?.hits ?? null));
  tile(copy.resultTime, seconds(result?.seconds ?? null));
  tile(copy.resultRate, result?.perSecond == null ? '-' : formatFactNumber(result.perSecond, SECONDS_DIGITS));
  return host;
}

function rankingList(
  context: KnowledgeContext,
  state: CalculatorState,
  pick: (weaponId: string) => void,
): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const host = element('section', 'kn-calc__ranking');
  const title = element('h4', 'kn-calc__title');
  write(title, copy.rankingTitle);
  const list = element('ol', '');
  const chosen = weaponFor(context.base, state.attacker.tribe, state.attacker.weapon)?.id;
  for (const row of ranking(context.base, state)) {
    const item = element('li', '');
    const pressable = button('kn-calc__rank');
    pressable.dataset.weapon = row.weapon.id;
    pressable.setAttribute('aria-pressed', String(row.weapon.id === chosen));
    const name = element('span', 'kn-calc__rank-name');
    write(name, weaponLabel(row.weapon));
    const time = element('span', 'kn-calc__rank-time');
    write(time, row.hits === null ? copy.neverKills : seconds(row.seconds));
    const bar = element('span', 'kn-calc__bar');
    setStyleVar(bar, '--share', row.share.toFixed(3));
    pressable.append(name, time, bar);
    pressable.addEventListener('click', () => pick(row.weapon.id));
    item.append(pressable);
    list.append(item);
  }
  host.append(title, list);
  return host;
}

let radioGroups = 0;

function weaponList(
  context: KnowledgeContext,
  state: CalculatorState,
  pick: (weaponId: string) => void,
): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const { tribe } = state.attacker;
  const host = element('div', 'kn-calc__weapons');
  host.setAttribute('role', 'radiogroup');
  host.setAttribute('aria-label', copy.weaponLabel);
  radioGroups += 1;
  const name = `kn-calc-weapon-${radioGroups}`;
  const chosen = weaponFor(context.base, tribe, state.attacker.weapon)?.id;
  for (const group of weaponGroups(context.base, tribe, state.heroes)) {
    const title = element('span', 'kn-calc__group');
    write(title, copy.weaponGroups[group.id]);
    host.append(title);
    for (const weapon of group.weapons) {
      const row = element('label', 'kn-calc__weapon');
      const radio = element('input', '');
      radio.type = 'radio';
      radio.name = name;
      radio.checked = weapon.id === chosen;
      radio.addEventListener('change', () => pick(weapon.id));
      const icon = element('span', 'kn-calc__icon', goodIconMarkup(WEAPON_ICON_PX));
      const frame = icon.querySelector<HTMLElement>('.on-good__frame');
      const goodId = goodIdOf(context, weapon);
      if (frame !== null && goodId !== null) context.art.goodIcon(frame, goodId, WEAPON_ICON_PX);
      const label = element('span', '');
      write(label, weaponLabel(weapon));
      row.append(radio, icon, label);
      host.append(row);
    }
  }
  return host;
}

function targetPanel(
  context: KnowledgeContext,
  read: () => CalculatorState,
  update: Update,
): { readonly element: HTMLElement; refresh(): void } {
  const { base } = context;
  const copy = messages().knowledge.mechanics;
  const host = element('section', 'kn-calc__side');
  const title = element('h4', 'kn-calc__title');
  write(title, copy.targetTitle);
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
      pickers.replaceChildren(
        field(
          copy.armourLabel,
          armourDropdown(context, copy.armourLabel, target.armour, (armour) => setTarget({ armour })).root,
        ),
        checkbox(copy.defenseAmulet, target.defense, (defense) => setTarget({ defense })).host,
      );
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
      pickers.replaceChildren(
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
  host.append(title, kinds.element, pickers, field(copy.healthLabel, healthRow));
  return {
    element: host,
    refresh(): void {
      const { target } = read();
      const result = blowResult(base, read());
      const fullHealth = result?.target.fullHealth ?? 0;
      health.max = String(fullHealth);
      if (document.activeElement !== health || target.health === null) {
        health.value = String(target.health ?? fullHealth);
      }
      write(full, formatMessage(copy.healthOf, { full: formatFactNumber(fullHealth) }));
      setHidden(reset, target.health === null);
    },
  };
}

type Update = (state: CalculatorState) => void;

function blowPane(
  context: KnowledgeContext,
  read: () => CalculatorState,
  update: Update,
): { readonly element: HTMLElement; readonly refresh: () => void } {
  const { base } = context;
  const copy = messages().knowledge.mechanics;
  const host = element('div', 'kn-calc__blow');
  const setAttacker = (change: Partial<CalculatorState['attacker']>): void => {
    const state = read();
    update({ ...state, attacker: { ...state.attacker, ...change } });
  };

  const weaponsSlot = element('div', 'kn-calc__weaponslot');
  const fillWeapons = (): void => {
    weaponsSlot.replaceChildren(weaponList(context, read(), (weapon) => setAttacker({ weapon })));
  };
  const tribe = tribeDropdown(context, copy.tribeLabel, read().attacker.tribe, (id) => {
    setAttacker({ tribe: id });
    fillWeapons();
  });
  const heroes = checkbox(copy.heroes, read().heroes, (on) => {
    update({ ...read(), heroes: on });
    fillWeapons();
  });
  const experience = slider(copy.hitsLabel, read().attacker.hits, (hits) => setAttacker({ hits }));
  const experienceNote = element('small', 'kn-calc__note');
  const strength = checkbox(copy.strengthAmulet, read().attacker.strength, (on) =>
    setAttacker({ strength: on }),
  );
  const dial = createDial(read().attacker.sector, (sector) => setAttacker({ sector }));

  const attacker = element('section', 'kn-calc__side');
  const attackerTitle = element('h4', 'kn-calc__title');
  write(attackerTitle, copy.attackerTitle);
  const modifiers = element('div', 'kn-calc__modifiers');
  const left = element('div', '');
  left.append(field(copy.hitsLabel, experience.host), experienceNote, strength.host);
  modifiers.append(left, dial.element);
  attacker.append(attackerTitle, field(copy.tribeLabel, tribe.root), heroes.host, weaponsSlot, modifiers);

  const target = targetPanel(context, read, update);
  const sides = element('div', 'kn-calc__sides');
  sides.append(attacker, target.element);
  const stripSlot = element('div', 'kn-calc__stripslot');
  const details = element('div', 'kn-calc__details');
  host.append(stripSlot, sides, details);

  const pickFromRanking = (weapon: string): void => {
    setAttacker({ weapon });
    fillWeapons();
    host.querySelector<HTMLElement>(`[data-weapon="${weapon}"]`)?.focus();
  };

  const refresh = (): void => {
    const state = read();
    const result = blowResult(base, state);
    stripSlot.replaceChildren(strip(result));
    details.replaceChildren(
      result === undefined ? element('p', 'kn-empty') : breakdownTable(result.rows),
      rankingList(context, state, pickFromRanking),
    );
    target.refresh();
    if (result === undefined) return;
    experience.input.disabled = !result.gainsExperience;
    const skip = result.rows.find((row) => row.id === 'experience')?.skip ?? null;
    write(experienceNote, skip === null ? '' : copy.skips[skip]);
    strength.box.disabled = !result.takesStrength;
    dial.setEnabled(result.target.combat.person);
  };
  fillWeapons();
  refresh();
  return { element: host, refresh };
}

function fighterPanel(
  context: KnowledgeContext,
  index: 0 | 1,
  read: () => CalculatorState,
  update: Update,
): HTMLElement {
  const { base } = context;
  const copy = messages().knowledge.mechanics;
  const fighter = (): DuelFighter => read().duel[index];
  const set = (change: Partial<DuelFighter>): void => {
    const state = read();
    const next = { ...fighter(), ...change };
    update({
      ...state,
      duel: index === 0 ? [next, state.duel[1]] : [state.duel[0], next],
    });
  };
  const entries = (): readonly DropdownEntry<string>[] =>
    weaponGroups(base, fighter().tribe, read().heroes).map((group) => ({
      group: copy.weaponGroups[group.id],
      // A row with no clip has no clock to race on.
      choices: group.weapons
        .filter((w) => w.clipTicks !== null)
        .map((w) => ({
          id: w.id,
          label: weaponLabel(w),
          ...(goodIdOf(context, w) === null ? {} : { goodId: goodIdOf(context, w) ?? '' }),
        })),
    }));
  const activeWeapon = (): string => weaponFor(base, fighter().tribe, fighter().weapon)?.id ?? '';
  const weapon = dropdownControl<string>({
    label: copy.weaponLabel,
    className: SELECT_SKIN,
    entries: entries(),
    active: activeWeapon(),
    icons: context.art.goodIcon,
    onPick: (id) => {
      weapon.setActive(id);
      set({ weapon: id });
      paint();
    },
  });
  const tribe = tribeDropdown(context, copy.tribeLabel, fighter().tribe, (id) => {
    set({ tribe: id });
    weapon.setEntries(entries());
    weapon.setActive(activeWeapon());
    paint();
  });
  const armour = armourDropdown(context, copy.armourLabel, fighter().armour, (id) => set({ armour: id }));
  const experience = slider(copy.hitsLabel, fighter().hits, (hits) => set({ hits }));
  const strength = checkbox(copy.strengthAmulet, fighter().strength, (on) => set({ strength: on }));
  const defense = checkbox(copy.defenseAmulet, fighter().defense, (on) => set({ defense: on }));
  const person = combatTargets(base)[0];
  function paint(): void {
    const row = weaponFor(base, fighter().tribe, fighter().weapon);
    if (row === undefined || person === undefined) return;
    experience.input.disabled = !gainsFightExperience(row, person);
    strength.box.disabled = !takesStrengthAmulet(row);
  }
  paint();
  const host = element('section', 'kn-calc__side');
  const title = element('h4', 'kn-calc__title');
  write(title, formatMessage(copy.fighterTitle, { number: index + 1 }));
  host.append(
    title,
    field(copy.tribeLabel, tribe.root),
    field(copy.weaponLabel, weapon.root),
    field(copy.armourLabel, armour.root),
    field(copy.hitsLabel, experience.host),
    strength.host,
    defense.host,
  );
  return host;
}

function verdictText(context: KnowledgeContext, state: CalculatorState): readonly string[] {
  const copy = messages().knowledge.mechanics;
  const result = duelResult(context.base, state.duel);
  if (result === undefined) return [];
  const { sides, verdict } = result;
  const lines = sides.map((side, i) =>
    formatMessage(copy.duelSide, {
      number: i + 1,
      weapon: weaponLabel(side.weapon),
      damage: formatFactNumber(side.damage),
      hits: count(side.hits),
      time: seconds(side.seconds),
    }),
  );
  if (verdict.kind === 'stalemate') return [copy.duelStalemate, ...lines];
  if (verdict.kind === 'draw') {
    return [formatMessage(copy.duelDraw, { time: seconds(verdict.seconds) }), ...lines];
  }
  return [
    formatMessage(copy.duelWin, {
      number: verdict.winner + 1,
      time: seconds(verdict.seconds),
      health: formatFactNumber(verdict.healthLeft),
    }),
    ...lines,
  ];
}

function duelPane(context: KnowledgeContext, read: () => CalculatorState, update: Update): HTMLElement {
  const host = element('div', 'kn-calc__duel');
  const verdict = element('div', 'kn-calc__verdict');
  verdict.setAttribute('aria-live', 'polite');
  const sides = element('div', 'kn-calc__sides');
  const apply: Update = (state) => {
    update(state);
    paint();
  };
  function paint(): void {
    const [headline, ...details] = verdictText(context, read());
    const lead = element('strong', '');
    write(lead, headline ?? '');
    const rest = details.map((line) => {
      const row = element('span', '');
      write(row, line);
      return row;
    });
    verdict.replaceChildren(lead, ...rest);
  }
  sides.append(fighterPanel(context, 0, read, apply), fighterPanel(context, 1, read, apply));
  host.append(verdict, sides);
  paint();
  return host;
}

/** The hit calculator; state lives per window, so a rebuilt article shows the same fight. */
export function createCalculator(context: KnowledgeContext): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const root = element('section', 'kn-calc');
  root.setAttribute(FIELD_KEYS_ATTRIBUTE, '');
  root.setAttribute('aria-label', copy.calculatorTitle);
  const title = element('h3', 'kn-h');
  write(title, copy.calculatorTitle);
  const assumes = element('p', 'kn-foot');
  write(assumes, copy.calculatorAssumes);
  const slot = element('div', '');
  let refreshBlow: (() => void) | undefined;
  const read = (): CalculatorState => stateOf(context);
  const update: Update = (state) => {
    states.set(context, state);
    refreshBlow?.();
  };
  const mode = createSegmented(MODES, copy.modeLabel, (key) => {
    states.set(context, { ...read(), mode: key });
    show();
  });
  function show(): void {
    const current = read().mode;
    mode.update({ blow: { label: copy.modes.blow }, duel: { label: copy.modes.duel } }, current);
    refreshBlow = undefined;
    if (current === 'duel') {
      slot.replaceChildren(duelPane(context, read, update));
      return;
    }
    const pane = blowPane(context, read, update);
    refreshBlow = pane.refresh;
    slot.replaceChildren(pane.element);
  }
  show();
  root.append(title, mode.element, assumes, slot);
  return root;
}
