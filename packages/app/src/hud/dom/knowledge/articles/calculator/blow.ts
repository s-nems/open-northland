import { formatMessage, messages } from '../../../../../i18n/index.js';
import {
  type BlowResult,
  type BreakdownRow,
  blowResult,
  type CalculatorState,
  ranking,
  weaponFor,
  weaponLabel,
  withWeapon,
} from '../../../../knowledge/calculator.js';
import { CAP_HITS } from '../../../../knowledge/combat.js';
import { formatFactNumber } from '../../../../knowledge/facts/reader.js';
import { button, element, setStyleVar, write } from '../../../parts/dom.js';
import type { KnowledgeContext } from '../../context.js';
import {
  checkbox,
  count,
  experienceSlider,
  field,
  fold,
  healthBar,
  SECONDS_DIGITS,
  seconds,
  sideTitle,
  tiles,
  tribeDropdown,
  type Update,
  versus,
  weaponDropdown,
  weaponEntries,
} from './controls.js';
import { targetPanel } from './target.js';

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

export function blowPane(
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
