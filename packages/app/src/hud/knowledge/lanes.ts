import { formatMessage, type Messages, messages } from '../../i18n/index.js';
import type { KnowledgeBase } from './base.js';
import { edges } from './chains.js';

export type LaneId = keyof Messages['knowledge']['lanes'];

/** One card of an authored tree: `id` is the good's or building's content id. */
export interface LaneNode {
  readonly id: string;
  readonly kids: readonly LaneNode[];
}

export interface Lane {
  readonly id: LaneId;
  readonly roots: readonly LaneNode[];
  /** The job whose discovery opens the lane's buildings. */
  readonly unlockedBy?: string;
}

const t = (id: string, ...kids: readonly LaneNode[]): LaneNode => ({ id, kids });

/** Where each good sits. Lines stay inside a lane, so this table only says which input is the parent. */
export const GOOD_LANES: readonly Lane[] = [
  {
    id: 'food',
    roots: [t('wheat', t('flour', t('bread'), t('candy'))), t('honey', t('mead')), t('water')],
  },
  {
    id: 'animals',
    roots: [
      t('cattle', t('leather', t('shoes'), t('armor_leather'))),
      t('sheep', t('wool', t('armor_wool'))),
      t('prey', t('meat')),
    ],
  },
  {
    id: 'wood',
    roots: [
      t(
        'wood',
        t('tool_wooden'),
        t('furniture'),
        t('bow_short'),
        t('bow_long'),
        t('spear_wooden', t('spear_iron')),
        t('handcart'),
        t('oxcart'),
        t('ship_small'),
        t('ship_big'),
        t('catapult'),
      ),
    ],
  },
  { id: 'clay', roots: [t('mud', t('brick'), t('tile'), t('crockery'))] },
  { id: 'stone', roots: [t('stone', t('pillar'), t('ornament'))] },
  {
    id: 'iron',
    roots: [t('iron', t('tool_iron'), t('sword_shord'), t('sword_long'), t('armor_chain'), t('armor_plate'))],
  },
  {
    id: 'goldAmulets',
    roots: [
      t(
        'gold',
        t('coin'),
        t('amulet_food'),
        t('amulet_stamina'),
        t('amulet_strength'),
        t('amulet_defense'),
        t('amulet_crithit'),
        t('amulet_speed'),
      ),
    ],
  },
  {
    id: 'herbs',
    roots: [
      t(
        'herb',
        t('potion_food_small'),
        t('potion_food_big'),
        t('potion_stamina_small'),
        t('potion_stamina_big'),
        t('potion_heal_small'),
        t('potion_heal_big'),
      ),
      t('mushroom', t('holy_oil')),
    ],
  },
];

/** The buildings' lanes: a line is the step that opens the next building. Roots that share a caption
 *  open the same way, so they stand side by side. */
export const BUILDING_LANES: readonly Lane[] = [
  {
    id: 'homes',
    roots: [
      t('home_level_00', t('home_level_01', t('home_level_02', t('home_level_03', t('home_level_04'))))),
    ],
  },
  { id: 'stores', roots: [t('stock_00', t('stock_01', t('stock_02'))), t('headquarters')] },
  {
    id: 'animalsLeather',
    unlockedBy: 'breeder',
    roots: [t('work_sewery_00', t('work_sewery_01')), t('work_animal_farm')],
  },
  {
    id: 'food',
    roots: [
      t(
        'work_farm_00',
        t('work_mill_00', t('work_bakery_00', t('work_bakery_01'), t('work_brewery'), t('work_hive_00'))),
      ),
      t('work_well_00'),
    ],
  },
  {
    id: 'wood',
    unlockedBy: 'joiner',
    roots: [
      t(
        'work_joinery_00',
        t(
          'work_joinery_01',
          t(
            'work_joinery_02',
            t('work_joinery_03', t('ship_small'), t('ship_big'), t('catapult')),
            t('handcart'),
            t('oxcart'),
          ),
        ),
      ),
      t('work_armory_00', t('work_armory_01')),
    ],
  },
  {
    id: 'herbsFaithGold',
    unlockedBy: 'herb_mush_guy',
    roots: [
      t('work_herb_hut', t('work_druid_00', t('work_druid_01')), t('work_temple')),
      t('work_coin_mint'),
    ],
  },
  { id: 'clay', unlockedBy: 'potter', roots: [t('work_pottery_00', t('work_pottery_01'))] },
  { id: 'stone', unlockedBy: 'mason', roots: [t('work_mason_hut_00', t('work_mason_hut_01'))] },
  { id: 'iron', unlockedBy: 'smith', roots: [t('work_smithy_00', t('work_smithy_01'))] },
  {
    id: 'militaryLearning',
    roots: [t('barracks'), t('school'), t('tower_00', t('tower_01')), t('work_pottery_02')],
  },
];

export function laneName(lane: Lane): string {
  return messages().knowledge.lanes[lane.id];
}

/** What opens a lane's buildings; undefined for a lane open from the start. */
export function laneCaption(base: KnowledgeBase, lane: Lane): string | undefined {
  const job = lane.unlockedBy === undefined ? undefined : base.jobById.get(lane.unlockedBy);
  if (job === undefined) return undefined;
  const { byExperience, byJob } = messages().knowledge.laneUnlock;
  const need = job.requirements.find((r) => r.route === 'need');
  return need === undefined
    ? formatMessage(byJob, { job: job.name })
    : formatMessage(byExperience, { amount: need.amount, experience: need.experience.join(' + ') });
}

function walkNodes(lanes: readonly Lane[], visit: (node: LaneNode) => void): void {
  const descend = (node: LaneNode): void => {
    visit(node);
    node.kids.forEach(descend);
  };
  for (const lane of lanes) lane.roots.forEach(descend);
}

/** What is wrong with the authored lanes against `base`: an id it does not hold, or a goods-tree parent
 *  that is no real input of its child. Empty when the tables agree with the content. */
export function checkLanes(base: KnowledgeBase): readonly string[] {
  const problems: string[] = [];
  const pairs = new Set(edges(base).map((e) => `${e.from}>${e.to}`));
  walkNodes(GOOD_LANES, (node) => {
    const good = base.goodById.get(node.id);
    if (good === undefined) {
      problems.push(`good lane names unknown good ${node.id}`);
      return;
    }
    for (const kid of node.kids) {
      const child = base.goodById.get(kid.id);
      if (child !== undefined && !pairs.has(`${good.typeId}>${child.typeId}`)) {
        problems.push(`${node.id} is no input of ${kid.id}`);
      }
    }
  });
  walkNodes(BUILDING_LANES, (node) => {
    if (!base.buildingById.has(node.id)) problems.push(`building lane names unknown building ${node.id}`);
  });
  return problems;
}
