// Wireframe data and joins, derived from the review data the same way the window would derive them from
// the content set: nothing here lists a recipe by hand.
export const data = await (await fetch('/review/data.json')).json();

/** Goods no player handles under that name: a dish is a meal once it leaves the bakery, so recipes that
 *  name a meal show the dish. Sausage has no producer in the data. */
const MEAL_DISH = { food_simple: 'bread', food_extra: 'candy' };
const HIDDEN_GOODS = new Set([...Object.keys(MEAL_DISH), 'sausage']);

const allGoods = data.goods;
data.goods = allGoods.filter((g) => !HIDDEN_GOODS.has(g.id));
export const goodById = new Map(data.goods.map((g) => [g.id, g]));
export const goodByType = new Map(data.goods.map((g) => [g.typeId, g]));
for (const good of allGoods) {
  const dish = MEAL_DISH[good.id];
  if (dish !== undefined) goodByType.set(good.typeId, goodById.get(dish));
}
/** The filmed cycles, present only when the local review art has them. */
const stripManifest = async (name) => {
  const response = await fetch(`/review/${name}.json`);
  return response.ok ? response.json() : {};
};
export const STRIPS = {
  ...(await stripManifest('anims-animals')),
  ...(await stripManifest('anims-soldiers')),
};

export const buildingByType = new Map(data.buildings.map((b) => [b.typeId, b]));
export const buildingById = new Map(data.buildings.map((b) => [b.id, b]));
export const jobByType = new Map(data.jobs.map((j) => [j.typeId, j]));
export const jobById = new Map(data.jobs.map((j) => [j.id, j]));

export const esc = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const SECONDS_PER_TICK = 1 / 12;
export const seconds = (ticks) =>
  (ticks * SECONDS_PER_TICK).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
export const number = (value) => Number(value).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
export const precise = (value) =>
  Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A picture the review set lacks stays an empty dashed ring. */
const NO_ART =
  "this.onerror=null;this.classList.add('is-missing');this.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='";

export function goodIcon(good) {
  return `<img class="kn-good" alt="" src="/review/icons/${good.id}.png" onerror="${NO_ART}">`;
}
export function buildingThumb(building) {
  return `<img class="kn-thumb" alt="" src="/review/thumbs/${building.id}.png" onerror="${NO_ART}">`;
}
export function animalPicture(animal) {
  return `<img class="kn-good" alt="" src="/review/animals/${animal.tribe}.png" onerror="${NO_ART}">`;
}
/** A link that navigates the window to an entry. */
export function goodLink(good, amount) {
  const count = amount === undefined ? '' : `<b>${amount}×</b>`;
  return `<button class="kn-link" data-go="good:${good.id}">${count}${goodIcon(good)}<span>${esc(good.name)}</span></button>`;
}
export function buildingLink(building) {
  return `<button class="kn-link" data-go="building:${building.id}"><span>${esc(building.name)}</span></button>`;
}
export function jobLink(job) {
  return `<button class="kn-link" data-go="job:${job.id}"><span>${esc(job.name)}</span></button>`;
}

/** Every way a good comes into being: recipes first, in building order, so the lowest tier leads. */
export const recipesOf = new Map();
/** Every recipe that spends a good. */
export const usesOf = new Map();
for (const building of data.buildings) {
  for (const recipe of building.recipes) {
    for (const output of recipe.outputs) {
      if (!recipesOf.has(output.goodType)) recipesOf.set(output.goodType, []);
      recipesOf.get(output.goodType).push({ building, recipe });
    }
    for (const input of recipe.inputs) {
      if (!usesOf.has(input.goodType)) usesOf.set(input.goodType, []);
      usesOf.get(input.goodType).push({ building, recipe });
    }
  }
}
/** A building's durability for a tribe: some tribes build a type sturdier than its base row. */
export const buildingHitpoints = (building, tribe) => building.tribeHitpoints[tribe] ?? building.hitpoints;

export const buildingsCosting = (good) =>
  data.buildings.filter((b) => b.cost.some((c) => c.good === good.typeId));

/** The buildings that fill a good with no recipe: the well, the hive, the herb hut, the fisher's store. */
export const producersOf = (good) =>
  data.buildings.filter(
    (b) =>
      b.produces.includes(good.typeId) &&
      !b.recipes.some((r) => r.outputs.some((o) => o.goodType === good.typeId)),
  );

/** The graph's edges, unique per pair: a recipe, a slaughter or a hunt. */
export const edges = [];
const seen = new Set();
const addEdge = (fromType, toType, kind) => {
  const from = goodByType.get(fromType)?.typeId;
  const to = goodByType.get(toType)?.typeId;
  const key = `${from}>${to}`;
  if (from === undefined || to === undefined || seen.has(key)) return;
  seen.add(key);
  edges.push({ from, to, kind });
};
for (const [output, sources] of recipesOf) {
  const { recipe } = sources[0];
  for (const input of recipe.inputs) addEdge(input.goodType, output, 'recipe');
}
for (const good of data.goods)
  for (const input of good.slaughterInputs) addEdge(input.goodType, good.typeId, 'slaughter');
for (const good of data.goods) {
  if (good.vehicleHouse === null) continue;
  for (const cost of buildingByType.get(good.vehicleHouse)?.cost ?? [])
    addEdge(cost.good, good.typeId, 'recipe');
}
const prey = goodById.get('prey');
for (const id of ['meat', 'leather']) addEdge(prey.typeId, goodById.get(id).typeId, 'hunt');
const meat = goodById.get('meat');
for (const id of ['sheep', 'cattle']) addEdge(goodById.get(id).typeId, meat.typeId, 'slaughter');

export const inputsOf = (type) => edges.filter((e) => e.to === type);
export const outputsOf = (type) => edges.filter((e) => e.from === type);

function walk(start, neighbours) {
  const found = new Set();
  const stack = [start];
  while (stack.length > 0) {
    for (const type of neighbours(stack.pop())) {
      if (!found.has(type)) {
        found.add(type);
        stack.push(type);
      }
    }
  }
  return found;
}
export const upstreamOf = (type) => walk(type, (t) => inputsOf(t).map((e) => e.from));
export const downstreamOf = (type) => walk(type, (t) => outputsOf(t).map((e) => e.to));

/** Raw materials one unit costs through each good's first recipe, stopping where no recipe exists. */
export function rawCost(type, into = new Map(), times = 1) {
  const good = goodByType.get(type);
  const bill =
    good.vehicleHouse === null
      ? recipesOf.get(type)?.[0].recipe.inputs
      : buildingByType.get(good.vehicleHouse)?.cost.map((c) => ({ goodType: c.good, amount: c.amount }));
  if (bill === undefined || bill.length === 0) {
    into.set(type, (into.get(type) ?? 0) + times);
    return into;
  }
  for (const input of bill) rawCost(input.goodType, into, times * input.amount);
  return into;
}

/** The example settlement that shows the status chips; the window reads the running game's discoveries. */
export const DEMO = {
  tribe: 1,
  map: 'Magiczny las',
  jobs: new Set([
    'Budowniczy',
    'Zbieracz',
    'Farmer',
    'Myśliwy',
    'Tragarz',
    'Rybak',
    'Garncarz',
    'Kamieniarz',
    'Młynarz',
    'Cieśla',
  ]),
  goods: new Set(['Pszenica', 'Drewno', 'Glina', 'Kamień', 'Kamienny blok', 'Cegła', 'Mąka']),
  closedOnMap: new Set(['ship_small', 'ship_big', 'work_coin_mint']),
  stock: { Drewno: 209, Pszenica: 225, Kamień: 80, Żelazo: 12 },
};

/** A house's status in the example settlement. */
export function buildingStatus(building) {
  if (DEMO.closedOnMap.has(building.id)) {
    return { kind: 'map', text: 'Ta mapa nie pozwala na ten budynek', short: 'poza mapą' };
  }
  if (building.tech === null) return { kind: 'ok', text: 'Dostępny' };
  const missing = [
    ...building.tech.jobs.filter((j) => !DEMO.jobs.has(j.name)).map((j) => j.name),
    ...building.tech.goods.filter((g) => !DEMO.goods.has(g.name)).map((g) => g.name),
  ];
  return missing.length === 0
    ? { kind: 'ok', text: 'Dostępny' }
    : {
        kind: 'locked',
        text: `Czeka na: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` i ${missing.length - 3} więcej` : ''}`,
        short: `Brak: ${missing[0]}${missing.length > 1 ? ` +${missing.length - 1}` : ''}`,
      };
}
