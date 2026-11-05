import { messages } from '../../../i18n/index.js';
import {
  armourOf,
  combatTargets,
  hitsToKill,
  landed,
  perSecond,
  stepSeconds,
} from '../../knowledge/combat.js';
import { tribeWeapons } from '../../knowledge/entry-blocks.js';
import { perSecondText, slowdownPercent, wholeText } from '../../knowledge/entry-format.js';
import type { KnowledgeGood } from '../../knowledge/model.js';
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
  originBlock,
  section,
  weaponLink,
} from './entry-parts.js';

const PERCENT = 100;

const copy = () => messages().knowledge.entry;

function factsBlock(_context: KnowledgeContext, weight: number): EntryBlock {
  const text = copy().armour;
  const slower = slowdownPercent(stepSeconds(weight), stepSeconds(0));
  return {
    node: section(null, factList([[text.slows, slower === 0 ? text.slowsNot : `${slower}%`]])),
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
      label: weaponLink(context, weapon),
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
