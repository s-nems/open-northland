import { formatMessage, messages } from '../../../../../i18n/index.js';
import {
  type CalculatorState,
  type DuelFighter,
  type DuelVerdict,
  duelResult,
  weaponFor,
  weaponLabel,
} from '../../../../knowledge/calculator.js';
import {
  combatTargets,
  gainsFightExperience,
  HUMAN_HITPOINTS,
  takesStrengthAmulet,
} from '../../../../knowledge/combat.js';
import { formatFactNumber } from '../../../../knowledge/facts/reader.js';
import type { KnowledgeWeapon } from '../../../../knowledge/model.js';
import { element, write } from '../../../parts/dom.js';
import type { KnowledgeContext } from '../../context.js';
import {
  armourDropdown,
  checkbox,
  count,
  experienceSlider,
  field,
  healthBar,
  seconds,
  sideTitle,
  tiles,
  tribeDropdown,
  type Update,
  versus,
  weaponDropdown,
  weaponEntries,
} from './controls.js';

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

export function duelPane(
  context: KnowledgeContext,
  read: () => CalculatorState,
  update: Update,
): HTMLElement {
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
