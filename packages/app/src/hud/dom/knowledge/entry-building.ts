import { buildingFootprintFor } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { JOB_SOLDIER_UNARMED } from '../../../catalog/jobs.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { buildingHitpoints, type KnowledgeBuilding } from '../../knowledge/base.js';
import {
  type BuildingBlock,
  buildingBlocks,
  buildingCapacity,
  capacityShows,
  levelChain,
  missingTech,
  previousLevel,
  schoolCourses,
  type TechRows,
  techSize,
} from '../../knowledge/entry-blocks.js';
import { counted, stepsText, wholeText } from '../../knowledge/entry-format.js';
import { button } from '../parts/dom.js';
import type { KnowledgeContext } from './context.js';
import { recipeView } from './entry-good.js';
import {
  articleLinks,
  buildingPicture,
  type Child,
  type EntryBlock,
  entryPage,
  factList,
  fold,
  goodLink,
  goodLinks,
  jobLink,
  links,
  node,
  originBlock,
  paragraph,
  section,
  statusChip,
  textLink,
} from './entry-parts.js';

/** Discoveries shown open with no settlement to compare against; a longer list folds. */
const OPEN_TECH_LIMIT = 6;
const LEVEL_THUMB_PX = 56;

const copy = () => messages().knowledge.entry;

function statusBlock(context: KnowledgeContext, building: KnowledgeBuilding): EntryBlock | null {
  const status = context.settlement?.status('building', building.typeId);
  const chip = status === undefined ? null : statusChip(status, true);
  return chip === null ? null : { node: chip };
}

function outputBlock(context: KnowledgeContext, building: KnowledgeBuilding): EntryBlock {
  return {
    node: section(copy().building.output, ...building.recipes.map((recipe) => recipeView(context, recipe))),
  };
}

function capacityBlock(building: KnowledgeBuilding): EntryBlock {
  const text = copy().building;
  const { store, larder, families, pupils } = buildingCapacity(building);
  const rows: (readonly [string, string])[] = [
    ...(store === null
      ? []
      : ([
          [text.store, formatMessage(text.perGood, { amount: store.perGood, count: store.goods })],
        ] as const)),
    ...(larder === null ? [] : ([[text.larder, String(larder)]] as const)),
    ...(families > 0 ? ([[text.families, String(families)]] as const) : []),
    ...(pupils > 0 ? ([[text.pupils, String(pupils)]] as const) : []),
  ];
  return { node: section(text.capacity, factList(rows)) };
}

function teachesBlock(context: KnowledgeContext, building: KnowledgeBuilding): EntryBlock {
  const text = copy().building;
  if (systems.isBarracksType(building.row)) {
    const soldier = context.base.jobs.find((job) => job.typeId === JOB_SOLDIER_UNARMED);
    return {
      node: section(
        text.teaches,
        soldier === undefined
          ? null
          : paragraph(text.drills, ' ', textLink(`job:${soldier.id}`, soldier.name)),
      ),
    };
  }
  const { jobs, goods } = schoolCourses(context.base);
  return {
    node: section(
      text.teaches,
      fold(
        formatMessage(text.teachesTrades, { count: jobs.length }),
        links(jobs.map((job) => textLink(`job:${job.id}`, job.name))),
      ),
      fold(
        formatMessage(text.teachesGoods, { count: goods.length }),
        links(goods.map((good) => goodLink(context, good))),
      ),
    ),
  };
}

function workersBlock(context: KnowledgeContext, building: KnowledgeBuilding): EntryBlock {
  const text = copy().building;
  return {
    node: section(
      text.workers,
      node(
        'ul',
        'kn-workers',
        ...building.workers.map((worker) =>
          node(
            'li',
            '',
            jobLink(context, worker.jobType, worker.name),
            node('span', '', counted(worker.count, text.seats)),
          ),
        ),
      ),
    ),
    side: true,
  };
}

function buildBlock(context: KnowledgeContext, building: KnowledgeBuilding): EntryBlock {
  const text = copy().building;
  const previous = previousLevel(context.base, building);
  const title = previous === undefined ? text.build : formatMessage(text.upgrade, { name: previous.name });
  const cost = goodLinks(context, building.cost);
  return {
    node: section(title, cost.length === 0 ? paragraph(text.noBuild) : links(cost)),
    side: true,
  };
}

/** The two rows of a discovery list, naming a good the house makes itself as experience, not stock. */
function techRows(context: KnowledgeContext, building: KnowledgeBuilding, rows: TechRows): readonly Child[] {
  const text = copy().building;
  const goods = rows.goods.flatMap((row): readonly Child[] => {
    const good = context.base.goodByType.get(row.id);
    if (good === undefined) return [node('span', '', row.name)];
    const own = building.recipes.some((r) => r.outputs.some((o) => o.goodType === good.typeId));
    return own
      ? [goodLink(context, good), node('span', 'kn-foot', text.ownGoodNote)]
      : [goodLink(context, good)];
  });
  return [
    rows.jobs.length === 0
      ? null
      : node(
          'div',
          'kn-tech',
          node('span', 'kn-tech__label', text.discoverJobs),
          links(rows.jobs.map((job) => jobLink(context, job.id, job.name))),
        ),
    rows.goods.length === 0
      ? null
      : node('div', 'kn-tech', node('span', 'kn-tech__label', text.discoverGoods), links(goods)),
  ];
}

function discoverBlock(context: KnowledgeContext, building: KnowledgeBuilding): EntryBlock | null {
  const text = copy().building;
  const { tech } = building;
  if (tech === null || techSize(tech) === 0) return null;
  const all = techRows(context, building, tech);
  const summary = formatMessage(text.discoverAll, { count: techSize(tech) });
  const settlement = context.settlement;
  if (settlement === null) {
    const open = techSize(tech) <= OPEN_TECH_LIMIT;
    return { node: section(text.discover, ...(open ? all : [fold(summary, ...all)])), side: true };
  }
  const status = settlement.status('building', building.typeId);
  const missing = status.kind === 'locked' ? missingTech(tech, status.missing) : { jobs: [], goods: [] };
  return {
    node: section(text.discover, ...techRows(context, building, missing), fold(summary, ...all)),
    side: true,
  };
}

/** The upgrade line as thumbnails, the house on this page lit. */
function levelsBlock(context: KnowledgeContext, building: KnowledgeBuilding): EntryBlock {
  const row = node('div', 'kn-levels');
  for (const level of levelChain(context.base, building)) {
    const item = button('kn-level');
    item.dataset.go = `building:${level.id}`;
    if (level.typeId === building.typeId) item.setAttribute('aria-current', 'true');
    item.append(
      ...[buildingPicture(context, level, LEVEL_THUMB_PX), node('span', '', level.name)].filter(
        (n) => n !== null,
      ),
    );
    row.append(item);
  }
  return { node: section(copy().building.levels, row), side: true };
}

/** A footprint's width and height in steps; null for a type with none. */
export function footprintSize(building: KnowledgeBuilding, tribe: number): string | null {
  const blocked = buildingFootprintFor(building.row, tribe)?.blocked ?? [];
  if (blocked.length === 0) return null;
  const across = blocked.map((cell) => cell.dx);
  const down = blocked.map((cell) => cell.dy);
  const width = Math.max(...across) - Math.min(...across) + 1;
  const height = Math.max(...down) - Math.min(...down) + 1;
  return stepsText(height, `${width} × ${height}`);
}

function healthBlock(context: KnowledgeContext, building: KnowledgeBuilding): EntryBlock {
  const text = copy().building;
  const tribe = context.tribe();
  const health = buildingHitpoints(building, tribe);
  const footprint = footprintSize(building, tribe);
  return {
    node: section(
      null,
      factList([
        ...(health === null ? [] : ([[text.health, wholeText(health)]] as const)),
        ...(footprint === null ? [] : ([[text.footprint, footprint]] as const)),
      ]),
    ),
    side: true,
  };
}

function kindName(building: KnowledgeBuilding): string {
  const kinds: Readonly<Record<string, string | undefined>> = copy().kinds;
  return kinds[building.kind] ?? copy().kinds.other;
}

export function renderBuilding(context: KnowledgeContext, building: KnowledgeBuilding): HTMLElement {
  const text = copy();
  const capacity = capacityShows(buildingCapacity(building));
  const levels = levelChain(context.base, building).length > 1;
  const teaches = systems.isSchoolType(building.row) || systems.isBarracksType(building.row);
  const render = (block: BuildingBlock): EntryBlock | null => {
    switch (block) {
      case 'status':
        return statusBlock(context, building);
      case 'output':
        return outputBlock(context, building);
      case 'capacity':
        return capacityBlock(building);
      case 'teaches':
        return teachesBlock(context, building);
      case 'workers':
        return workersBlock(context, building);
      case 'build':
        return buildBlock(context, building);
      case 'discover':
        return discoverBlock(context, building);
      case 'levels':
        return levelsBlock(context, building);
      case 'health':
        return healthBlock(context, building);
      case 'links':
        return articleLinks(context, { kind: 'building', id: building.id }, []);
      case 'origin':
        return originBlock(building.help);
    }
  };
  return entryPage(
    {
      picture: buildingPicture(context, building),
      title: building.name,
      kicker: formatMessage(text.kicker.building, { kind: kindName(building) }),
    },
    buildingBlocks(building, { capacity, teaches, levels }).map(render),
  );
}
