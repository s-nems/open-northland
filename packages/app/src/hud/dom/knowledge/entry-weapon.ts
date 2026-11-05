import { systems } from '@open-northland/sim';
import { formatMessage, messages } from '../../../i18n/index.js';
import {
  CAP_HITS,
  CRITICAL_CHANCE_PCT,
  combatTargets,
  criticalDamage,
  HIT_DIRECTION,
  HUMAN_HITPOINTS,
  hitsToKill,
  landed,
  NO_MODIFIERS,
  perSecond,
  STRENGTH_PCT,
  stepSeconds,
  targetName,
  weaponOf,
} from '../../knowledge/combat.js';
import {
  cadenceText,
  factorText,
  numberText,
  perSecondText,
  preciseSecondsText,
  rangeText,
  slowdownPercent,
  weaponClassText,
  wholeText,
} from '../../knowledge/entry-format.js';
import type { KnowledgeGood, KnowledgeWeapon } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import { goodStatusBlock, obtainBlock } from './entry-good.js';
import {
  articleLinks,
  dataTable,
  type EntryBlock,
  emptyEntry,
  entryPage,
  factList,
  filmBlock,
  fold,
  foot,
  goodHead,
  goodIcon,
  node,
  originBlock,
  paragraph,
  section,
  textLink,
} from './entry-parts.js';

const TARGET_ICON_PX = 18;
/** A stand-in the factor of a rising rule is measured on. */
const FACTOR_SAMPLE = 1000;
const WHOLE_PERCENT = 100;

const copy = () => messages().knowledge.entry;

/** The strip that always stays on screen: the four numbers a player compares weapons by. */
export function weaponStrip(context: KnowledgeContext, weapon: KnowledgeWeapon): EntryBlock {
  const text = copy().strip;
  const bare = combatTargets(context.base)[0];
  const cell = (label: string, value: string): HTMLElement =>
    node('div', 'kn-strip__cell', node('span', '', label), node('b', '', value));
  return {
    node: node(
      'div',
      'kn-strip',
      cell(text.type, weaponClassText(weapon, systems.WEAPON_MAIN_TYPE.UNARMED)),
      cell(text.range, rangeText(weapon)),
      cell(text.cadence, cadenceText(weapon)),
      cell(text.perSecond, bare === undefined ? '-' : perSecondText(landed(weapon, bare), weapon)),
    ),
  };
}

export function weaponFilm(context: KnowledgeContext, weapon: KnowledgeWeapon): EntryBlock | null {
  const text = copy().weapon;
  const jobType = weapon.filmJob;
  if (jobType === null) return null;
  const tribe = context.tribe();
  const step = preciseSecondsText(stepSeconds(weapon.weight));
  return filmBlock(
    context,
    [
      {
        clip: { kind: 'job', jobType, tribe, action: 'attack' },
        name: text.filmBlow,
        text: cadenceText(weapon),
      },
      {
        clip: { kind: 'job', jobType, tribe, action: 'walk' },
        name: text.filmMarch,
        text: formatMessage(text.filmStep, { time: step }),
      },
    ],
    true,
  );
}

function damageBlock(context: KnowledgeContext, weapon: KnowledgeWeapon): EntryBlock {
  const text = copy();
  const rows = combatTargets(context.base).map((target) => {
    const damage = landed(weapon, target);
    const hits = target.person ? hitsToKill(damage) : null;
    const worn = target.good === null ? undefined : context.base.goodById.get(target.good);
    return {
      label: node(
        'span',
        'kn-target',
        worn === undefined ? null : goodIcon(context, worn, TARGET_ICON_PX),
        targetName(target),
      ),
      cells: [
        { text: wholeText(damage), heat: damage },
        { text: hits === null ? '-' : String(hits) },
        { text: perSecondText(damage, weapon), heat: perSecond(damage, weapon) ?? 0 },
      ],
    };
  });
  const table = dataTable(
    [
      { title: text.table.against },
      { title: text.table.perBlow },
      { title: text.table.blowsToKill },
      { title: text.strip.perSecond, extra: true },
    ],
    rows,
  );
  const health = formatMessage(text.weapon.humanHealth, { health: wholeText(HUMAN_HITPOINTS) });
  return { node: section(text.weapon.damage, table, foot(health)) };
}

function bonusFold(context: KnowledgeContext, weapon: KnowledgeWeapon): EntryBlock | null {
  const text = copy().weapon;
  const plain = combatTargets(context.base)[0];
  if (plain === undefined) return null;
  const row = (label: string, note: string, value: number) => ({
    label,
    cells: [{ text: note }, { text: wholeText(value) }],
  });
  const change = (change: Partial<typeof NO_MODIFIERS>): number =>
    landed(weapon, plain, { ...NO_MODIFIERS, ...change });
  const factor = (percent: number): string => factorText(percent);
  const veteran = systems.withFightExperience(FACTOR_SAMPLE, CAP_HITS) / FACTOR_SAMPLE;
  const critical = criticalDamage(FACTOR_SAMPLE) / FACTOR_SAMPLE;
  const table = dataTable(
    [{ title: text.bonus }, { title: text.multiplier }, { title: copy().table.perBlow }],
    [
      row(text.bonusBackSide, factor(HIT_DIRECTION.backSide), change({ direction: HIT_DIRECTION.backSide })),
      row(text.bonusBehind, factor(HIT_DIRECTION.behind), change({ direction: HIT_DIRECTION.behind })),
      row(text.bonusStrength, factor(STRENGTH_PCT), change({ strength: true })),
      row(
        formatMessage(text.bonusVeteran, { hits: CAP_HITS }),
        factorText(veteran * WHOLE_PERCENT),
        change({ hits: CAP_HITS }),
      ),
      row(
        text.bonusPrecision,
        formatMessage(text.bonusPrecisionNote, {
          chance: CRITICAL_CHANCE_PCT,
          factor: numberText(critical),
        }),
        criticalDamage(landed(weapon, plain)),
      ),
    ],
  );
  return { node: fold(text.bonuses, table) };
}

function marchFold(context: KnowledgeContext, weapon: KnowledgeWeapon): EntryBlock {
  const text = copy().weapon;
  const { base } = context;
  const plain = stepSeconds(0);
  const armours = [
    { name: text.noArmour, weight: 0 },
    ...base.armor.map((armour) => ({ name: armour.name, weight: armour.weight })),
  ];
  const rows = armours.map((armour) => {
    const slower = slowdownPercent(stepSeconds(weapon.weight + armour.weight), plain);
    return { label: armour.name, cells: [{ text: slower === 0 ? '-' : `${slower}%` }] };
  });
  const table = dataTable([{ title: text.withArmour }, { title: text.slower }], rows);
  return { node: fold(text.march, table, foot(text.marchNote)) };
}

function factsBlock(context: KnowledgeContext, good: KnowledgeGood, weapon: KnowledgeWeapon): EntryBlock {
  const text = copy().weapon;
  const discovery = context.base.goodRequirements.get(good.typeId)?.find((r) => r.route === 'need');
  return {
    node: section(
      null,
      factList([
        ...(discovery === undefined
          ? []
          : ([[text.unlock, `${discovery.amount} × ${discovery.experience.join(' + ')}`]] as const)),
      ]),
      paragraph(textLink(`calculator:${weapon.id}`, text.calculator)),
    ),
    side: true,
  };
}

export function renderWeapon(context: KnowledgeContext, good: KnowledgeGood): HTMLElement {
  const text = copy();
  const weapon = weaponOf(context.base, good, context.tribe());
  const head = goodHead(context, good, text.kicker.weapon);
  if (weapon === undefined) {
    return entryPage(head, [
      { node: emptyEntry(text.weapon.notForTribe) },
      obtainBlock(context, good, text.weapon.obtain),
      originBlock(good.help),
    ]);
  }
  return entryPage(head, [
    goodStatusBlock(context, good),
    weaponStrip(context, weapon),
    obtainBlock(context, good, text.weapon.obtain),
    damageBlock(context, weapon),
    factsBlock(context, good, weapon),
    weaponFilm(context, weapon),
    bonusFold(context, weapon),
    marchFold(context, weapon),
    articleLinks(context, { kind: 'good', id: good.id }, ['damage']),
    originBlock(good.help),
  ]);
}
