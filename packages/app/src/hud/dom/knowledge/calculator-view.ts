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
  type DuelFighter,
  type DuelVerdict,
  duelResult,
  HIT_SIDES,
  type HitSide,
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
  experienceBonusPct,
  gainsFightExperience,
  HUMAN_HITPOINTS,
  takesStrengthAmulet,
} from '../../knowledge/combat.js';
import { formatFactNumber } from '../../knowledge/facts.js';
import { button, element, setHidden, setStyleVar, write } from '../parts/dom.js';
import { type DropdownEntry, type DropdownHandle, dropdownControl } from '../parts/dropdown.js';
import { createSegmented } from '../parts/segmented.js';
import type { KnowledgeContext } from './context.js';
import './calculator.css';

const SECONDS_DIGITS = 1;
const SECONDS_PER_MINUTE = 60;
const SELECT_SKIN = 'on-res-select';
const TARGET_KINDS: readonly TargetKind[] = ['person', 'animal', 'building', 'vehicle'];
const MODES = ['blow', 'duel'] as const;

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
  page.querySelector<HTMLElement>('.kn-calc__weapon button')?.focus({ preventScroll: true });
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

function field(label: string, control: HTMLElement, className = ''): HTMLElement {
  const row = element('div', `kn-calc__field ${className}`.trim());
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

/** The fight-experience slider; its readout says what the hits are worth. */
function experienceSlider(
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

/** A tribe's weapons grouped as the reader knows them, heroes last; `keep` drops rows. */
function weaponEntries(
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

function weaponDropdown(
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

/** The steps that changed the blow, as one line: base, each change, the landed damage. */
function breakdownLine(rows: readonly BreakdownRow[]): readonly HTMLElement[] {
  const copy = messages().knowledge.mechanics;
  const line = element('p', 'kn-calc__chain');
  const label = element('span', 'kn-calc__label');
  write(label, `${copy.breakdownTitle}:`);
  line.append(label);
  const term = (name: string, value: string, className: string): void => {
    const chip = element('span', `kn-calc__term ${className}`.trim());
    const amount = element('b', '');
    write(amount, value);
    chip.append(amount, ` ${name}`);
    line.append(chip);
  };
  const off: string[] = [];
  for (const row of rows) {
    const name = copy.breakdownSteps[row.id];
    if (row.id === 'base') term(name, formatFactNumber(row.value), '');
    else if (row.skip !== null) off.push(`${name} (${copy.skips[row.skip]})`);
    else if (row.change !== 0) {
      const shown = formatFactNumber(Math.abs(row.change));
      term(
        name,
        row.change > 0 ? `+${shown}` : `\u2212${shown}`,
        row.change > 0 ? 'kn-calc__term--up' : 'kn-calc__term--down',
      );
    }
  }
  const total = element('span', 'kn-calc__term kn-calc__term--total');
  write(total, `= ${formatFactNumber(rows.at(-1)?.value ?? 0)}`);
  line.append(total);
  if (off.length === 0) return [line];
  const skipped = element('p', 'kn-calc__note');
  write(skipped, formatMessage(copy.breakdownSkipped, { list: off.join(', ') }));
  return [line, skipped];
}

/** What the target fields name, as the answer's subject. */
function targetName(context: KnowledgeContext, state: CalculatorState): string {
  const { base } = context;
  const { target } = state;
  const copy = messages().knowledge;
  switch (target.kind) {
    case 'person':
      return formatMessage(copy.mechanics.matchupPerson, { armour: copy.targets[target.armour] });
    case 'animal':
      return base.animals.find((a) => a.tribe === target.animal)?.name ?? copy.targets.animal;
    case 'building':
      return base.buildingById.get(target.building)?.name ?? copy.targets.building;
    case 'vehicle':
      return base.vehicles.find((v) => v.id === target.vehicle)?.name ?? copy.targets.vehicle;
  }
}

/** More blows than this draw the bar without a mark per blow: the marks would merge. */
const MAX_BLOW_MARKS = 40;

/**
 * A health bar over `full`: `left` of it filled, a mark every `blow` across the fill when given.
 */
function healthBar(full: number, left: number, blow: number | null, label: string): HTMLElement {
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

function tiles(values: readonly (readonly [string, string])[]): HTMLElement {
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

/** The answer: who hits whom, the three numbers in large print, the target's health cut into blows. */
function answer(
  context: KnowledgeContext,
  state: CalculatorState,
  result: BlowResult | undefined,
): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const host = element('div', 'kn-calc__answer');
  const matchup = element('p', 'kn-calc__matchup');
  if (result !== undefined) {
    write(
      matchup,
      formatMessage(copy.matchup, { weapon: weaponLabel(result.weapon), target: targetName(context, state) }),
    );
  }
  host.append(
    matchup,
    tiles([
      [copy.resultDamage, count(result?.damage ?? null)],
      [copy.resultHits, count(result?.hits ?? null)],
      [copy.resultTime, seconds(result?.seconds ?? null)],
    ]),
  );
  if (result === undefined) return host;
  if (result.hits === null) {
    const never = element('p', 'kn-calc__never');
    write(never, copy.neverKillsNote);
    host.append(never);
    return host;
  }
  const { fullHealth, health } = result.target;
  const caption = element('p', 'kn-calc__note');
  write(caption, copy.healthBar);
  host.append(healthBar(fullHealth, health, result.damage, copy.healthBar), caption);
  const rate = element('p', 'kn-calc__note');
  write(
    rate,
    `${copy.resultRate}: ${result.perSecond === null ? '-' : formatFactNumber(result.perSecond, SECONDS_DIGITS)}. ${copy.calculatorAssumes}`,
  );
  host.append(...breakdownLine(result.rows), rate);
  return host;
}

function fold(summary: string): { readonly element: HTMLDetailsElement; readonly body: HTMLElement } {
  const host = element('details', 'kn-fold kn-calc__fold');
  const title = element('summary', '');
  write(title, summary);
  const body = element('div', 'kn-calc__foldbody');
  host.append(title, body);
  return { element: host, body };
}

function rankingList(
  context: KnowledgeContext,
  state: CalculatorState,
  pick: (weaponId: string) => void,
): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const list = element('div', 'kn-calc__ranking');
  const header = element('div', 'kn-calc__rank kn-calc__rank--head');
  for (const text of [copy.weaponLabel, '', copy.rankHits, copy.rankTime]) {
    const cell = element('span', '');
    write(cell, text);
    header.append(cell);
  }
  list.append(header);
  const chosen = weaponFor(context.base, state.attacker.tribe, state.attacker.weapon)?.id;
  for (const row of ranking(context.base, state)) {
    const pressable = button('kn-calc__rank');
    pressable.dataset.weapon = row.weapon.id;
    pressable.setAttribute('aria-pressed', String(row.weapon.id === chosen));
    const name = element('span', 'kn-calc__rank-name');
    write(name, weaponLabel(row.weapon));
    const bar = element('span', 'kn-calc__bar');
    setStyleVar(bar, '--share', row.share.toFixed(3));
    const hits = element('span', 'kn-num');
    write(hits, count(row.hits));
    const time = element('span', 'kn-num');
    write(time, row.hits === null ? copy.neverKills : seconds(row.seconds));
    pressable.append(name, bar, hits, time);
    pressable.addEventListener('click', () => pick(row.weapon.id));
    list.append(pressable);
  }
  return list;
}

type Update = (state: CalculatorState) => void;

/** The mark between the two sides: who hits whom, or who fights whom. */
function versus(mark: string): HTMLElement {
  const node = element('span', 'kn-calc__versus');
  node.setAttribute('aria-hidden', 'true');
  write(node, mark);
  return node;
}

function sideTitle(text: string): HTMLElement {
  const title = element('h4', 'kn-calc__title');
  write(title, text);
  return title;
}

function attackerPanel(
  context: KnowledgeContext,
  read: () => CalculatorState,
  update: Update,
): { readonly element: HTMLElement; setWeapon(id: string): void; refresh(result: BlowResult): void } {
  const { base } = context;
  const copy = messages().knowledge.mechanics;
  const setAttacker = (change: Partial<CalculatorState['attacker']>): void => {
    const state = read();
    update({ ...state, attacker: { ...state.attacker, ...change } });
  };
  const activeWeapon = (): string => weaponFor(base, read().attacker.tribe, read().attacker.weapon)?.id ?? '';
  const weapon = weaponDropdown(context, read().attacker.tribe, activeWeapon(), (id) =>
    update(withWeapon(read(), id)),
  );
  const tribe = tribeDropdown(context, copy.tribeLabel, read().attacker.tribe, (id) => {
    weapon.setEntries(weaponEntries(context, id));
    setAttacker({ tribe: id });
    weapon.setActive(activeWeapon());
  });
  const experience = experienceSlider(read().attacker.hits, (hits) => setAttacker({ hits }));
  const experienceNote = element('small', 'kn-calc__note');
  const strength = checkbox(copy.strengthAmulet, read().attacker.strength, (on) =>
    setAttacker({ strength: on }),
  );
  const pair = element('div', 'kn-calc__pair');
  pair.append(field(copy.tribeLabel, tribe.root), field(copy.weaponLabel, weapon.root, 'kn-calc__weapon'));
  const host = element('section', 'kn-calc__side');
  host.append(
    sideTitle(copy.attackerTitle),
    pair,
    field(copy.hitsLabel, experience.host),
    experienceNote,
    strength.host,
  );
  return {
    element: host,
    setWeapon(id): void {
      weapon.setActive(id);
    },
    refresh(result): void {
      experience.input.disabled = !result.gainsExperience;
      const skip = result.rows.find((row) => row.id === 'experience')?.skip ?? null;
      write(
        experienceNote,
        skip === null ? formatMessage(copy.experienceHint, { cap: CAP_HITS }) : copy.skips[skip],
      );
      strength.box.disabled = !result.takesStrength;
    },
  };
}

function targetPanel(
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

function blowPane(
  context: KnowledgeContext,
  read: () => CalculatorState,
  update: Update,
): { readonly element: HTMLElement; readonly refresh: () => void } {
  const { base } = context;
  const copy = messages().knowledge.mechanics;
  const host = element('div', 'kn-calc__blow');
  const attacker = attackerPanel(context, read, update);
  const target = targetPanel(context, read, update);
  const sides = element('div', 'kn-calc__sides');
  sides.append(attacker.element, versus('\u2192'), target.element);
  const answerSlot = element('div', 'kn-calc__answerslot');
  answerSlot.setAttribute('aria-live', 'polite');
  const compare = fold(copy.rankingTitle);
  host.append(sides, answerSlot, compare.element);

  const pickFromRanking = (weapon: string): void => {
    update(withWeapon(read(), weapon));
    attacker.setWeapon(weapon);
    host.querySelector<HTMLElement>(`[data-weapon="${weapon}"]`)?.focus();
  };

  const refresh = (): void => {
    const state = read();
    const result = blowResult(base, state);
    answerSlot.replaceChildren(answer(context, state, result));
    compare.body.replaceChildren(rankingList(context, state, pickFromRanking));
    target.refresh(result);
    if (result !== undefined) attacker.refresh(result);
  };
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
  // A row with no clip has no clock to race on.
  const timed = (w: KnowledgeWeapon): boolean => w.clipTicks !== null;
  const activeWeapon = (): string => weaponFor(base, fighter().tribe, fighter().weapon)?.id ?? '';
  const weapon = weaponDropdown(
    context,
    fighter().tribe,
    activeWeapon(),
    (id) => {
      set({ weapon: id });
      paint();
    },
    timed,
  );
  const tribe = tribeDropdown(context, copy.tribeLabel, fighter().tribe, (id) => {
    set({ tribe: id });
    weapon.setEntries(weaponEntries(context, id, timed));
    weapon.setActive(activeWeapon());
    paint();
  });
  const armour = armourDropdown(context, copy.armourLabel, fighter().armour, (id) => set({ armour: id }));
  const experience = experienceSlider(fighter().hits, (hits) => set({ hits }));
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
  const pair = element('div', 'kn-calc__pair');
  pair.append(field(copy.tribeLabel, tribe.root), field(copy.weaponLabel, weapon.root, 'kn-calc__weapon'));
  const checks = element('div', 'kn-calc__checks');
  checks.append(strength.host, defense.host);
  const host = element('section', 'kn-calc__side');
  host.append(
    sideTitle(formatMessage(copy.fighterTitle, { number: index + 1 })),
    pair,
    field(copy.armourLabel, armour.root),
    field(copy.hitsLabel, experience.host),
    checks,
  );
  return host;
}

/** The health each fighter keeps when the duel ends. */
function healthAtEnd(verdict: DuelVerdict, index: 0 | 1): number {
  switch (verdict.kind) {
    case 'stalemate':
      return HUMAN_HITPOINTS;
    case 'draw':
      return 0;
    case 'win':
      return verdict.winner === index ? verdict.healthLeft : 0;
  }
}

function verdictHeadline(verdict: DuelVerdict): string {
  const copy = messages().knowledge.mechanics;
  switch (verdict.kind) {
    case 'stalemate':
      return copy.duelStalemate;
    case 'draw':
      return formatMessage(copy.duelDraw, { time: seconds(verdict.seconds) });
    case 'win':
      return formatMessage(copy.duelWin, { number: verdict.winner + 1, time: seconds(verdict.seconds) });
  }
}

/** The verdict in one line, then each fighter's health at the end and his three numbers. */
function verdictNodes(context: KnowledgeContext, state: CalculatorState): readonly HTMLElement[] {
  const copy = messages().knowledge.mechanics;
  const result = duelResult(context.base, state.duel);
  if (result === undefined) return [];
  const { sides, verdict } = result;
  const lead = element('strong', 'kn-calc__headline');
  write(lead, verdictHeadline(verdict));
  const rows = sides.map((side, i) => {
    const index = i === 0 ? 0 : 1;
    const left = healthAtEnd(verdict, index);
    const won = verdict.kind === 'win' && verdict.winner === index;
    const row = element('div', won ? 'kn-calc__fighter kn-calc__fighter--won' : 'kn-calc__fighter');
    const name = element('p', 'kn-calc__matchup');
    write(name, `${formatMessage(copy.fighterTitle, { number: index + 1 })}: ${weaponLabel(side.weapon)}`);
    const health = formatMessage(copy.duelHealth, {
      health: formatFactNumber(left),
      full: formatFactNumber(HUMAN_HITPOINTS),
    });
    const caption = element('p', 'kn-calc__note');
    write(caption, health);
    row.append(
      name,
      healthBar(HUMAN_HITPOINTS, left, null, health),
      caption,
      tiles([
        [copy.resultDamage, formatFactNumber(side.damage)],
        [copy.resultHits, count(side.hits)],
        [copy.resultTime, seconds(side.seconds)],
      ]),
    );
    return row;
  });
  const pair = element('div', 'kn-calc__fighters');
  pair.append(...rows);
  return [lead, pair];
}

function duelPane(context: KnowledgeContext, read: () => CalculatorState, update: Update): HTMLElement {
  const host = element('div', 'kn-calc__duel');
  const verdict = element('div', 'kn-calc__answer kn-calc__verdict');
  verdict.setAttribute('aria-live', 'polite');
  const sides = element('div', 'kn-calc__sides');
  const apply: Update = (state) => {
    update(state);
    paint();
  };
  function paint(): void {
    verdict.replaceChildren(...verdictNodes(context, read()));
  }
  sides.append(
    fighterPanel(context, 0, read, apply),
    versus('\u2694'),
    fighterPanel(context, 1, read, apply),
  );
  host.append(sides, verdict);
  paint();
  return host;
}

/** The damage calculator; state lives per window, so a rebuilt article shows the same fight. */
export function createCalculator(context: KnowledgeContext): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const root = element('section', 'kn-calc');
  root.setAttribute(FIELD_KEYS_ATTRIBUTE, '');
  root.setAttribute('aria-label', copy.calculatorTitle);
  const head = element('div', 'kn-calc__head');
  const title = element('h3', 'kn-h');
  write(title, copy.calculatorTitle);
  const slot = element('div', '');
  let refreshBlow: (() => void) | undefined;
  const read = (): CalculatorState => stateOf(context);
  const update: Update = (state) => {
    states.set(context, state);
    refreshBlow?.();
  };
  const hint = element('p', 'kn-calc__hint');
  const mode = createSegmented(MODES, copy.modeLabel, (key) => {
    states.set(context, { ...read(), mode: key });
    show();
  });
  function show(): void {
    const current = read().mode;
    mode.update({ blow: { label: copy.modes.blow }, duel: { label: copy.modes.duel } }, current);
    write(hint, copy.modeHints[current]);
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
  head.append(title, mode.element, hint);
  root.append(head, slot);
  return root;
}
