import { PRIMARY_TRIBE } from '../../../game/rules.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { combatTargets, landed, perSecond } from '../../knowledge/combat.js';
import {
  type TribeDifference,
  tribeDifferences,
  tribeHeroes,
  tribeWeapons,
} from '../../knowledge/entry-blocks.js';
import { cadenceText, perSecondText, wholeText } from '../../knowledge/entry-format.js';
import type { KnowledgeTribe } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import {
  articleLinks,
  buildingLink,
  dataTable,
  type EntryBlock,
  entryPage,
  fold,
  jobLink,
  links,
  paragraph,
  section,
  type TableRow,
  weaponLink,
} from './entry-parts.js';

/** Building rows that stay open; a longer list folds behind its count. */
const OPEN_BUILDING_ROWS = 4;

const copy = () => messages().knowledge.entry;

function differenceLabel(row: TribeDifference): string {
  const text = copy().tribe;
  const templates = {
    absent: text.statAbsent,
    cadence: text.statCadence,
    damage: text.statDamage,
    range: text.statRange,
    weight: text.statWeight,
  };
  return formatMessage(templates[row.stat], { name: row.subject });
}

function differsBlock(context: KnowledgeContext, tribe: KnowledgeTribe): EntryBlock | null {
  const text = copy();
  const reference = context.base.tribes.find((t) => t.typeId === PRIMARY_TRIBE);
  if (reference === undefined || tribe.typeId === reference.typeId) return null;
  const { weapons, buildings } = tribeDifferences(context.base, tribe.typeId, reference.typeId);
  const columns = [{ title: text.table.trait }, { title: reference.name }, { title: tribe.name }];
  const value = (cell: string | null): string =>
    cell === null ? text.tribe.absent : cell === '' ? text.tribe.present : cell;
  const rows: TableRow[] = [
    ...weapons.map((row) => ({
      label: differenceLabel(row),
      cells: [{ text: value(row.reference) }, { text: value(row.own) }],
    })),
  ];
  const houseRows = buildings.map((row) => ({
    label: buildingLink(row.building),
    cells: [{ text: wholeText(row.reference) }, { text: wholeText(row.own) }],
  }));
  const houses = formatMessage(text.tribe.buildingHealth, { count: houseRows.length });
  const parts =
    rows.length === 0 && houseRows.length === 0
      ? [paragraph(text.tribe.noDifference)]
      : [
          ...(rows.length === 0 ? [] : [dataTable(columns, rows)]),
          ...(houseRows.length === 0
            ? []
            : houseRows.length <= OPEN_BUILDING_ROWS
              ? [paragraph(houses), dataTable(columns, houseRows)]
              : [fold(houses, dataTable(columns, houseRows))]),
        ];
  return { node: section(formatMessage(text.tribe.differs, { tribe: reference.name }), ...parts) };
}

function weaponFold(context: KnowledgeContext, tribe: KnowledgeTribe): EntryBlock | null {
  const text = copy();
  const targets = combatTargets(context.base);
  const bare = targets[0];
  const plate = targets.find((target) => target.id === 'plate');
  if (bare === undefined || plate === undefined) return null;
  const rows = tribeWeapons(context.base, tribe.typeId).map((weapon) => {
    const open = landed(weapon, bare);
    const armoured = landed(weapon, plate);
    return {
      label: weaponLink(context, weapon),
      cells: [
        { text: wholeText(open), heat: open },
        { text: wholeText(armoured), heat: armoured },
        { text: cadenceText(weapon) },
        { text: perSecondText(open, weapon), heat: perSecond(open, weapon) ?? 0 },
      ],
    };
  });
  const table = dataTable(
    [
      { title: text.table.weapon },
      { title: text.weapon.noArmour },
      { title: text.tribe.plate },
      { title: text.strip.cadence, extra: true },
      { title: text.strip.perSecond, extra: true },
    ],
    rows,
  );
  return { node: fold(text.tribe.fullTable, table) };
}

function heroesBlock(context: KnowledgeContext, tribe: KnowledgeTribe): EntryBlock | null {
  const text = copy().tribe;
  const heroes = tribeHeroes(context.base, tribe.typeId).flatMap((row) =>
    row.jobType === null || row.jobName === null ? [] : [jobLink(context, row.jobType, row.jobName)],
  );
  return heroes.length === 0 ? null : { node: section(text.heroes, links(heroes)), side: true };
}

export function renderTribe(context: KnowledgeContext, tribe: KnowledgeTribe): HTMLElement {
  return entryPage({ picture: null, title: tribe.name, kicker: copy().kicker.tribe }, [
    differsBlock(context, tribe),
    heroesBlock(context, tribe),
    weaponFold(context, tribe),
    articleLinks(context, null, ['heroes']),
  ]);
}
