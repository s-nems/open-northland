import { messages } from '../../../i18n/index.js';
import type { KnowledgeGood } from '../../knowledge/base.js';
import {
  armourOf,
  combatTargets,
  hitsToKill,
  landed,
  perSecond,
  stepSeconds,
} from '../../knowledge/combat.js';
import { tribeWeapons, weaponName } from '../../knowledge/entry-blocks.js';
import { perSecondText, slowdownPercent, wholeText } from '../../knowledge/entry-format.js';
import type { KnowledgeWeapon } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import { goodStatusBlock, obtainBlock } from './entry-good.js';
import {
  articleLinks,
  dataTable,
  type EntryBlock,
  entryPage,
  factList,
  foot,
  goodHead,
  goodLink,
  node,
  originBlock,
  section,
  textLink,
} from './entry-parts.js';

const PERCENT = 100;

const copy = () => messages().knowledge.entry;

/** A weapon's name in a table, a link to its page. */
export function weaponLabel(context: KnowledgeContext, weapon: KnowledgeWeapon): HTMLElement {
  const name = weaponName(context.base, weapon);
  const vehicle = context.base.vehicles.find((v) => v.jobType === weapon.jobType);
  if (vehicle !== undefined) return textLink(`vehicle:${vehicle.id}`, name);
  const good = weapon.goodType === null ? undefined : context.base.goodByType.get(weapon.goodType);
  return good === undefined ? node('span', '', name) : goodLink(context, good);
}

function factsBlock(context: KnowledgeContext, weight: number): EntryBlock {
  const text = copy().armour;
  const tribe = context.tribe();
  const slower = slowdownPercent(
    stepSeconds(context.base, weight, tribe),
    stepSeconds(context.base, 0, tribe),
  );
  return {
    node: section(
      null,
      factList([
        [text.slows, slower === 0 ? text.slowsNot : `${slower}%`],
        [text.durability, text.permanent],
      ]),
    ),
    side: true,
  };
}

function protectionBlock(context: KnowledgeContext, good: KnowledgeGood): EntryBlock | null {
  const text = copy();
  const targets = combatTargets(context.base);
  const target = targets.find((t) => t.good === good.id);
  const bare = targets[0];
  if (target === undefined || bare === undefined) return null;
  const rows = tribeWeapons(context.base, context.tribe()).map((weapon) => {
    const damage = landed(weapon, target);
    const open = landed(weapon, bare);
    const hits = hitsToKill(damage);
    return {
      label: weaponLabel(context, weapon),
      cells: [
        { text: wholeText(damage), heat: damage },
        { text: hits === null ? '-' : String(hits) },
        { text: perSecondText(damage, weapon), heat: perSecond(damage, weapon) ?? 0 },
        { text: open === 0 ? '-' : `${Math.round((1 - damage / open) * PERCENT)}%` },
      ],
    };
  });
  const table = dataTable(
    [
      { title: text.table.weapon },
      { title: text.table.perBlow },
      { title: text.table.blows },
      { title: text.strip.perSecond, extra: true },
      { title: text.table.protection, extra: true },
    ],
    rows,
  );
  return { node: section(text.armour.protection, table, foot(text.armour.note)) };
}

export function renderArmour(context: KnowledgeContext, good: KnowledgeGood): HTMLElement {
  const text = copy();
  const armour = armourOf(context.base, good);
  return entryPage(goodHead(context, good, text.kicker.armour), [
    goodStatusBlock(context, good),
    armour === undefined ? null : factsBlock(context, armour.weight),
    obtainBlock(context, good, text.good.obtain),
    protectionBlock(context, good),
    articleLinks(context, { kind: 'good', id: good.id }, ['damage']),
    originBlock(good.help),
  ]);
}
