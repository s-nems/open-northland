import {
  buildingById,
  buildingStatus,
  buildingThumb,
  data,
  downstreamOf,
  edges,
  esc,
  goodById,
  goodByType,
  goodIcon,
  inputsOf,
  jobById,
  jobByType,
  outputsOf,
  producersOf,
  recipesOf,
  upstreamOf,
} from './model.js';
import { treeHtml } from './tree.js';

const GOOD_CARD_H = 46;
const BUILDING_CARD_H = 50;
const MANY_OUTPUTS = 6;

const t = (id, ...kids) => ({ id, kids });

/** Where each good sits. Lines stay inside a lane, so this table only says which input is the parent. */
const GOOD_LANES = [
  {
    name: 'Żywność',
    roots: [t('wheat', t('flour', t('bread'), t('candy'))), t('honey', t('mead')), t('water')],
  },
  {
    name: 'Zwierzęta',
    roots: [
      t('cattle', t('leather', t('shoes'), t('armor_leather'))),
      t('sheep', t('wool', t('armor_wool'))),
      t('prey', t('meat')),
    ],
  },
  {
    name: 'Drewno',
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
  { name: 'Glina', roots: [t('mud', t('brick'), t('tile'), t('crockery'))] },
  { name: 'Kamień', roots: [t('stone', t('pillar'), t('ornament'))] },
  {
    name: 'Żelazo',
    roots: [t('iron', t('tool_iron'), t('sword_shord'), t('sword_long'), t('armor_chain'), t('armor_plate'))],
  },
  {
    name: 'Złoto i amulety',
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
    name: 'Zioła',
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
const BUILDING_LANES = [
  {
    name: 'Mieszkania',
    roots: [
      t('home_level_00', t('home_level_01', t('home_level_02', t('home_level_03', t('home_level_04'))))),
    ],
  },
  { name: 'Magazyny', roots: [t('stock_00', t('stock_01', t('stock_02'))), t('headquarters')] },
  {
    name: 'Zwierzęta i skóry',
    unlockedBy: 'breeder',
    roots: [t('work_sewery_00', t('work_sewery_01')), t('work_animal_farm')],
  },
  {
    name: 'Żywność',
    roots: [
      t(
        'work_farm_00',
        t('work_mill_00', t('work_bakery_00', t('work_bakery_01'), t('work_brewery'), t('work_hive_00'))),
      ),
      t('work_well_00'),
    ],
  },
  {
    name: 'Drewno',
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
    name: 'Zioła i wiara',
    unlockedBy: 'herb_mush_guy',
    roots: [t('work_herb_hut', t('work_druid_00', t('work_druid_01')), t('work_temple'))],
  },
  { name: 'Glina', unlockedBy: 'potter', roots: [t('work_pottery_00', t('work_pottery_01'))] },
  { name: 'Kamień', unlockedBy: 'mason', roots: [t('work_mason_hut_00', t('work_mason_hut_01'))] },
  {
    name: 'Żelazo i złoto',
    unlockedBy: 'smith',
    roots: [t('work_smithy_00', t('work_smithy_01')), t('work_coin_mint')],
  },
  {
    name: 'Wojsko i nauka',
    roots: [t('barracks'), t('school'), t('tower_00', t('tower_01')), t('work_pottery_02')],
  },
];

function inputChips(good) {
  const recipe = recipesOf.get(good.typeId)?.[0].recipe;
  const bill =
    good.vehicleHouse === null
      ? recipe?.inputs.map((i) => ({ type: i.goodType, amount: i.amount }))
      : data.buildings
          .find((b) => b.typeId === good.vehicleHouse)
          ?.cost.map((c) => ({ type: c.good, amount: c.amount }));
  if (bill !== undefined && bill.length > 0) {
    return bill.map((i) => ({ good: goodByType.get(i.type), amount: i.amount, joiner: '' }));
  }
  return inputsOf(good.typeId).map((edge, index) => ({
    good: goodByType.get(edge.from),
    amount: 1,
    joiner: index === 0 ? '' : 'lub',
  }));
}

/** A raw good says who brings it in, since it has no recipe. */
function sourceName(good) {
  const place = producersOf(good)[0];
  if (place !== undefined) return place.name;
  const worker = data.gatheredBy[good.typeId]?.[0];
  return worker === undefined ? '' : worker.name;
}

function goodCard(good) {
  const inputs = inputChips(good);
  const recipeText = inputs
    .map((i) => `${i.amount > 1 ? `${i.amount} × ` : ''}${i.good.name}`)
    .join(inputs[1]?.joiner === 'lub' ? ' lub ' : ' + ');
  const line =
    inputs.length === 0
      ? `<small class="kn-card__from">${esc(sourceName(good))}</small>`
      : `<small class="kn-card__in">${inputs
          .map(
            (i) =>
              `${i.joiner === '' ? '' : `<u>${i.joiner}</u>`}<i>${goodIcon(i.good)}${i.amount > 1 ? `<em>${i.amount}</em>` : ''}</i>`,
          )
          .join('')}</small>`;
  return {
    html: `${goodIcon(good)}<span class="kn-card__text"><b>${esc(good.name)}</b>${line}</span>`,
    title: inputs.length === 0 ? `${good.name}: ${sourceName(good)}` : `${good.name}: ${recipeText}`,
  };
}

function goodNode({ id, kids }) {
  const good = goodById.get(id);
  for (const kid of kids) {
    const child = goodById.get(kid.id);
    if (!edges.some((e) => e.from === good.typeId && e.to === child.typeId)) {
      console.warn(`tree: ${id} is no input of ${kid.id}`);
    }
  }
  return { key: `good:${id}`, kids: kids.map(goodNode), ...goodCard(good) };
}

/** The trade a workplace exists for; the porters and gatherers every workshop keeps say nothing. */
const SUPPORT_JOBS = new Set(['carrier', 'collector']);
const trade = (building) =>
  building.kind === 'workplace'
    ? building.workers.find((w) => !SUPPORT_JOBS.has(jobByType.get(w.job)?.id))
    : undefined;

function buildingCard(building, state) {
  const status = state.mode === 'game' ? buildingStatus(building) : { kind: 'ok', text: '' };
  const worker = trade(building)?.name ?? '';
  const line = status.kind === 'ok' ? worker : status.kind === 'map' ? 'poza mapą' : status.short;
  return {
    html: `${buildingThumb(building)}<span class="kn-card__text"><b>${esc(building.name)}</b><small class="kn-card__from">${esc(line)}</small></span>`,
    title: status.text === '' ? building.name : `${building.name}: ${status.text}`,
    className: `kn-card--building kn-card--${status.kind}`,
  };
}

function buildingNode({ id, kids }, state) {
  const building = buildingById.get(id);
  return {
    key: `building:${id}`,
    kids: kids.map((kid) => buildingNode(kid, state)),
    ...buildingCard(building, state),
  };
}

const unlockCaption = (jobId) => {
  const need = jobById.get(jobId).requirements.find((r) => r.route === 'need');
  return need === undefined
    ? `Odblokowuje ${jobById.get(jobId).name}`
    : `Odblokowuje ${need.amount} × ${need.experience.join(' + ')}`;
};

export function goodsTree(state) {
  return treeHtml({
    id: 'goods',
    lanes: GOOD_LANES.map((lane) => ({ ...lane, roots: lane.roots.map(goodNode) })),
    cardH: GOOD_CARD_H,
    zoom: state.zoom.goods,
    flow: 'columns',
    legend: [
      ['up', 'z czego powstaje'],
      ['down', 'do czego idzie'],
    ],
  });
}

export function buildingsTree(state) {
  return treeHtml({
    id: 'buildings',
    lanes: BUILDING_LANES.map((lane) => ({
      ...lane,
      caption: lane.unlockedBy === undefined ? undefined : unlockCaption(lane.unlockedBy),
      roots: lane.roots.map((root) => buildingNode(root, state)),
    })),
    cardH: BUILDING_CARD_H,
    zoom: state.zoom.buildings,
    flow: 'rows',
    legend: [
      ['up', 'co musi być wcześniej'],
      ['down', 'co otwiera'],
    ],
  });
}

const keyOf = (type) => `good:${goodByType.get(type).id}`;

export function relateGood(key) {
  const good = goodById.get(key.slice('good:'.length));
  const up = new Set([...upstreamOf(good.typeId)].map(keyOf));
  const down = new Set([...downstreamOf(good.typeId)].map(keyOf));
  const inputs = inputsOf(good.typeId).map((e) => ({ from: keyOf(e.from), to: key, kind: 'up' }));
  const outputs = outputsOf(good.typeId);
  const links =
    outputs.length > MANY_OUTPUTS
      ? inputs
      : [...inputs, ...outputs.map((e) => ({ from: key, to: keyOf(e.to), kind: 'down' }))];
  return { up, down, links };
}

/** A parent's key per building, off the lanes. */
const parentOf = new Map();
const walkLane = (node) => {
  for (const kid of node.kids) {
    parentOf.set(kid.id, node.id);
    walkLane(kid);
  }
};
for (const lane of BUILDING_LANES) for (const root of lane.roots) walkLane(root);

const workplaceOf = (jobType) => data.buildings.find((b) => trade(b)?.job === jobType);

export function relateBuilding(key) {
  const id = key.slice('building:'.length);
  const up = new Set();
  const links = [];
  for (let at = parentOf.get(id); at !== undefined; at = parentOf.get(at)) up.add(`building:${at}`);
  const building = buildingById.get(id);
  for (const job of building.tech?.jobs ?? []) {
    const place = jobByType.has(job.id) ? workplaceOf(job.id) : undefined;
    if (place === undefined || place.id === id) continue;
    up.add(`building:${place.id}`);
    links.push({ from: `building:${place.id}`, to: key, kind: 'up' });
  }
  const down = new Set();
  const collect = (parent) => {
    for (const [child, of] of parentOf) {
      if (of === parent) {
        down.add(`building:${child}`);
        collect(child);
      }
    }
  };
  collect(id);
  return { up, down, links };
}
