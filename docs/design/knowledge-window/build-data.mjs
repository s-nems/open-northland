// Builds the wireframe's local review data from generated content. The output holds decoded names and
// numbers, so it stays in the review directory and never enters the repository.
// usage: node build-data.mjs <content-dir> <help-dir> <review-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [contentDir, helpDir, reviewDir] = process.argv.slice(2);
if (contentDir === undefined || helpDir === undefined || reviewDir === undefined) {
  throw new Error('usage: build-data.mjs <content-dir> <help-dir> <review-dir>');
}

const ir = JSON.parse(readFileSync(join(contentDir, 'ir.json'), 'utf8'));
const pol = JSON.parse(readFileSync(join(contentDir, 'gui/strings/pol.json'), 'utf8'));

/** `stringn <id> "<text>"` rows of an original help table; a bare `string` row takes the next id. */
function helpTable(name) {
  const text = new TextDecoder('windows-1250').decode(readFileSync(join(helpDir, `${name}.ini`)));
  const table = {};
  let id = 0;
  for (const line of text.split(/\r?\n/)) {
    const row = /^string(n)?\s*(\d+)?\s*"(.*)"\s*$/.exec(line);
    if (row === null) continue;
    id = row[1] === 'n' ? Number(row[2]) : id + 1;
    table[id] = row[3].replaceAll('{newline}', '\n');
  }
  return table;
}
const goodsHelp = helpTable('goodshelp');
const housesHelp = helpTable('houseshelp');

const goodName = (id) => pol.goods[id] ?? `#${id}`;
const houseName = (id) => pol.houses[id] ?? `#${id}`;
const jobName = (id) => pol.jobs[id] ?? `#${id}`;
const expName = (id) => pol.experiences[id] ?? `#${id}`;

/** The wireframe's lanes, close to the original technology tree's sections. An authored table. */
const LANE_OF_GOOD = {
  food: [
    'water',
    'wheat',
    'flour',
    'honey',
    'fruit',
    'fish',
    'bread',
    'candy',
    'mead',
    'food_simple',
    'food_extra',
  ],
  animals: ['prey', 'meat', 'sausage', 'sheep', 'cattle', 'wool', 'leather'],
  wood: ['wood', 'tool_wooden', 'furniture', 'handcart', 'oxcart', 'ship_small', 'ship_big', 'catapult'],
  clay: ['mud', 'brick', 'tile', 'crockery'],
  stone: ['stone', 'pillar', 'ornament'],
  ore: [
    'iron',
    'gold',
    'coin',
    'tool_iron',
    'amulet_food',
    'amulet_stamina',
    'amulet_strength',
    'amulet_defense',
    'amulet_crithit',
    'amulet_speed',
  ],
  druid: [
    'mushroom',
    'herb',
    'holy_oil',
    'potion_food_small',
    'potion_food_big',
    'potion_stamina_small',
    'potion_stamina_big',
    'potion_heal_small',
    'potion_heal_big',
  ],
  military: [
    'spear_wooden',
    'spear_iron',
    'sword_shord',
    'sword_long',
    'bow_short',
    'bow_long',
    'shoes',
    'armor_wool',
    'armor_leather',
    'armor_chain',
    'armor_plate',
  ],
};
const laneOf = {};
for (const [lane, ids] of Object.entries(LANE_OF_GOOD)) for (const id of ids) laneOf[id] = lane;

/** What a good is made of with no recipe row: the `productionInputs` the farm's slaughter reads. */
const slaughterInputs = (g) =>
  ir.buildings.some((b) => (b.recipes ?? []).some((r) => r.outputs.some((o) => o.goodType === g.typeId)))
    ? []
    : (g.productionInputs ?? []);

/** The edible a dish turns into when it leaves its producer; the sim's `EDIBLE_FORM_BY_DISH`. */
const EDIBLE_FORM = {
  fruit: 'food_simple',
  bread: 'food_simple',
  meat: 'food_simple',
  fish: 'food_simple',
  sausage: 'food_simple',
  candy: 'food_extra',
};

/** A worn or carried good's effect, copied from the app's equipment catalog for this review only. */
const EQUIP = {
  shoes: {
    slot: 'Buty',
    wears: '10000 punktów',
    effect: 'Krok krótszy o 2 takty. Bez butów chodzenie kosztuje też jedzenie.',
  },
  tool_wooden: { slot: 'Narzędzie', wears: '100 użyć', effect: 'Praca ×1,25, produkcja +0,2 sztuki na cykl' },
  tool_iron: { slot: 'Narzędzie', wears: '100 użyć', effect: 'Praca ×1,75, produkcja +0,7 sztuki na cykl' },
  mead: { slot: 'Inne', wears: '2 łyki', effect: '+50% jedzenia i odpoczynku' },
  potion_food_small: { slot: 'Inne', wears: '2 łyki', effect: '+100% jedzenia' },
  potion_food_big: { slot: 'Inne', wears: '5 łyków', effect: '+100% jedzenia' },
  potion_stamina_small: { slot: 'Inne', wears: '2 łyki', effect: '+100% odpoczynku' },
  potion_stamina_big: { slot: 'Inne', wears: '5 łyków', effect: '+100% odpoczynku' },
  potion_heal_small: {
    slot: 'Inne',
    wears: '2 łyki',
    effect: '+40% zdrowia, sam wypija przy ranie poniżej 50%',
  },
  potion_heal_big: {
    slot: 'Inne',
    wears: '5 łyków',
    effect: '+40% zdrowia, sam wypija przy ranie poniżej 50%',
  },
  amulet_food: { slot: 'Inne', wears: 'nie zużywa się', effect: 'Uzupełnia głód o 40%' },
  amulet_stamina: { slot: 'Inne', wears: 'nie zużywa się', effect: 'Uzupełnia zmęczenie o 40%' },
  amulet_strength: { slot: 'Inne', wears: 'nie zużywa się', effect: 'Obrażenia ×1,5' },
  amulet_defense: { slot: 'Inne', wears: 'nie zużywa się', effect: 'Otrzymane obrażenia ×0,5' },
  amulet_crithit: { slot: 'Inne', wears: 'nie zużywa się', effect: '20% szans na cios ×2' },
  amulet_speed: { slot: 'Inne', wears: 'nie zużywa się', effect: 'Krok krótszy o 2 takty' },
};

const goods = ir.goods
  .filter((g) => g.id !== 'anything' && g.id !== 'chest')
  .map((g) => ({
    typeId: g.typeId,
    id: g.id,
    // Goods 17 and 20 share one display name, so the meal form says what it is here.
    name:
      g.id === 'food_extra' ? 'Posiłek: ciastko' : g.id === 'food_simple' ? 'Posiłek' : goodName(g.typeId),
    lane: laneOf[g.id] ?? null,
    help: goodsHelp[g.typeId] ?? null,
    producedOnMap: g.classification?.producedOnMap ?? false,
    gathering: g.gathering ?? null,
    homeQuality: g.homeQuality ?? null,
    vehicleHouse: g.vehicleHouse ?? null,
    slaughterInputs: slaughterInputs(g),
    edibleForm: EDIBLE_FORM[g.id] ?? null,
    equip: EQUIP[g.id] ?? null,
  }));

const buildings = ir.buildings
  .filter((b) => b.id !== 'work_murek')
  .map((b) => ({
    typeId: b.typeId,
    id: b.id,
    name: houseName(b.typeId),
    kind: b.kind,
    homeSize: b.homeSize ?? 0,
    schoolSize: b.schoolSize ?? 0,
    shelterCapacity: b.shelterCapacity ?? 0,
    hitpoints: b.hitpoints ?? null,
    upgradeTarget: b.upgradeTarget ?? null,
    workers: (b.workers ?? []).map((w) => ({ job: w.jobType, name: jobName(w.jobType), count: w.count })),
    cost: (b.construction ?? []).map((c) => ({
      good: c.goodType,
      name: goodName(c.goodType),
      amount: c.amount,
    })),
    produces: b.produces ?? [],
    recipes: (b.recipes ?? []).map((r) => ({ inputs: r.inputs, outputs: r.outputs, ticks: r.ticks })),
    stock: (b.stock ?? []).map((s) => ({
      good: s.goodType,
      name: goodName(s.goodType),
      capacity: s.capacity,
    })),
    help: housesHelp[b.typeId] ?? null,
  }));

const viking = ir.tribes.find((t) => t.id === 'viking');
const reqs = {};
for (const r of viking.jobRequirements) {
  const key = `${r.target}:${r.targetId}`;
  reqs[key] ??= [];
  reqs[key].push({
    route: r.requirement,
    amount: r.amount,
    experience: (r.experienceTypes ?? []).map(expName),
  });
}
const nameByKind = { job: jobName, house: houseName, good: goodName };
const enables = {};
for (const e of viking.jobEnables) {
  if (e.kind === 'vehicle') continue;
  enables[e.jobType] ??= {};
  enables[e.jobType][e.kind] ??= [];
  enables[e.jobType][e.kind].push({ id: e.targetId, name: nameByKind[e.kind](e.targetId) });
}

const FIRST_FIGHTER_JOB = 31;
const trackJob = new Map();
for (const e of ir.jobExperience) trackJob.set(expName(e.typeId), e.jobType);

/** The trades a good is gathered by, off the tribe's `jobEnables` good rows. */
const gatheredBy = {};
for (const e of viking.jobEnables) {
  if (e.kind !== 'good') continue;
  gatheredBy[e.targetId] ??= [];
  gatheredBy[e.targetId].push({ job: e.jobType, name: jobName(e.jobType) });
}

const jobs = ir.jobs
  .filter((j) => j.typeId >= 5 && j.typeId <= 47 && viking.permissions.job.includes(j.typeId))
  .map((j) => ({
    typeId: j.typeId,
    id: j.id,
    name: jobName(j.typeId),
    plural: pol.jobsPlural[j.typeId] ?? jobName(j.typeId),
    baseJob: j.baseJob ?? null,
    needsReligion: j.needsReligion,
    // The school refuses fighter trades, whatever their `train` rows say.
    requirements: (reqs[`job:${j.typeId}`] ?? [])
      .filter((r) => r.route === 'need' || j.typeId < FIRST_FIGHTER_JOB)
      .map((r) => ({
        ...r,
        fromJobs: [
          ...new Set(r.experience.map((name) => trackJob.get(name)).filter((id) => id !== undefined)),
        ],
      })),
    enables: enables[j.typeId] ?? {},
  }));

const goodRequirements = {};
for (const [key, rows] of Object.entries(reqs)) {
  if (key.startsWith('good:')) goodRequirements[key.slice('good:'.length)] = rows;
}

const clipOf = new Map(ir.atomicAnimations.map((a) => [a.id, a]));
const ATTACK_ATOMIC = 81;
const PLAYABLE = [1, 2, 3, 4, 7];
const tribes = PLAYABLE.map((typeId) => ({ typeId, name: pol.tribes[typeId] ?? String(typeId) }));
const weapons = {};
for (const tribe of PLAYABLE) {
  const record = ir.tribes.find((t) => t.typeId === tribe);
  const binding = new Map(record.atomicBindings.map((b) => [`${b.jobType}:${b.atomicId}`, b.animation]));
  weapons[tribe] = ir.weapons
    .filter((w) => w.tribeType === tribe)
    .map((w) => ({
      typeId: w.typeId,
      id: w.id,
      job: w.jobType ?? null,
      jobName: w.jobType === undefined ? null : jobName(w.jobType),
      goodName: w.goodType === undefined ? null : goodName(w.goodType),
      mainType: w.mainType ?? null,
      minRange: w.minRange,
      maxRange: w.maxRange,
      damage: w.damage,
      clipTicks: clipOf.get(binding.get(`${w.jobType}:${ATTACK_ATOMIC}`))?.length ?? null,
      /** No tribe's permissions name the saber and axe trades, so those rows never fight. */
      usable: w.jobType === undefined || record.permissions.job.includes(w.jobType),
    }));
}

/** Viking's `technology` rows: the trades and goods a house waits for. */
const techOf = new Map((viking.technology?.houses ?? []).map((row) => [row.house, row]));
for (const building of buildings) {
  const row = techOf.get(building.typeId);
  building.tech =
    row === undefined
      ? null
      : {
          jobs: row.jobs.map((id) => ({ id, name: jobName(id) })),
          goods: row.goods.map((id) => ({ id, name: goodName(id) })),
        };
}

const armor = ir.armor.map((a) => ({
  typeId: a.typeId,
  name: goodName(a.goodType),
  material: a.materialType,
  weight: a.weight,
  blockingValue: a.blockingValue,
}));

const vehicles = ir.vehicles
  .filter((v) => v.id !== 'cart_no_ox')
  .map((v) => ({
    id: v.id,
    name: pol.houses[ir.buildings.find((b) => b.vehicleType === v.typeId)?.typeId] ?? v.name,
    stockSlots: v.stockSlots,
    passengerSlots: v.passengerSlots,
    hitpoints: v.hitpoints,
  }));

const animals = ir.animals
  .filter((a) => a.hitpointsAdult > 0)
  .map((a) => ({
    tribe: a.tribeType,
    name: pol.tribes[a.tribeType] ?? a.id,
    hitpoints: a.hitpointsAdult,
    aggressive: a.aggressive,
    getAngry: a.getAngry,
    catchable: a.catchable,
    moveSpeed: a.moveSpeed,
    runSpeed: a.runSpeed,
    groupSize: a.maximumGroupSize,
  }));

mkdirSync(reviewDir, { recursive: true });
writeFileSync(
  join(reviewDir, 'data.json'),
  JSON.stringify({
    tribes,
    goods,
    buildings,
    jobs,
    goodRequirements,
    gatheredBy,
    weapons,
    armor,
    vehicles,
    animals,
  }),
);
console.log(
  `goods ${goods.length}, buildings ${buildings.length}, jobs ${jobs.length}, recipes ${buildings.reduce((n, b) => n + b.recipes.length, 0)}`,
);
