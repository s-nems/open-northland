import {
  type BuildingFootprint,
  type ContentSet,
  type FootprintCell,
  IR_VERSION,
  parseContentSet,
} from '@vinland/data';
import { type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **the profession economy** — gatherers dig raw goods and bring them home, a porter
 * ferries loose piles into the warehouse, and a smith turns iron + wood into a sword and carries it back.
 * Every character does exactly ONE trade (the data-driven job → atomic gate), and the two delivery
 * routes the original uses are both on screen:
 *
 *  - the WOODCUTTER (drewno) and MINER (żelazo) are bound to the WAREHOUSE, so they haul their harvest
 *    straight into its store — the "deliver to the warehouse you're assigned to" route;
 *  - the STONEMASON (kamień) and CLAY-DIGGER (glina) trek in from the far west and are bound to a FLAG (a
 *    bare ground pile) beside the warehouse, so they drop their harvest on the ground there — the "deliver
 *    to a flag" route — and the PORTER (tragarz), bound to the warehouse, ferries those loose piles home;
 *  - the SMITH (kowal), bound to the FORGE, fetches ONLY the goods its recipe needs (iron + wood) out of
 *    the warehouse, forges a sword, and hauls the finished sword back to the warehouse;
 *  - a CIVILIAN (cywil) has no job and just stands — "cywil nie robi nic".
 *
 * Nothing about the chain is hard-coded: the smith's inputs are the FORGE recipe, the gate on who may
 * dig what is each job's `allowedAtomics`, and the delivery target is each settler's `JobAssignment`. The
 * headless half proves the WHOLE loop closed — a finished sword reached the warehouse (which can only
 * happen if the gather → deliver → porter → fetch → forge → return chain all ran) and the flag route fed
 * it stone + clay. The pixels (who swings what, the visible carried goods, the diagonal walk) are the
 * human's checklist.
 */

const { Building, JobAssignment, Position, Resource, Settler, Stockpile } = components;

// ── goods (ids chosen so the render draws each carried load with its own look: log / stone / mud / ingot
//    / sword — see content/settler-gfx.ts CARRY_SEQ_SUFFIX) ──
const WOOD = 1;
const STONE = 2;
const CLAY = 3; // id 'mud' — the original's clay good, and the authored mud-carry walk
const IRON = 4;
const SWORD = 5; // id 'sword_shord' — the short sword, matching the sword carry-walk

// ── harvest atomics (one per raw good, so a job that may dig wood cannot dig ore — the job→atomic gate) ──
const HARVEST_WOOD = 24; // 24 = the render's HARVEST_ATOMIC (the woodcut swing)
const HARVEST_STONE = 25;
const HARVEST_CLAY = 26;
const HARVEST_IRON = 27;

// ── jobs (ids in the 10+ band: unmapped by the character roster, so each draws the generic man; the
//    trade is what differs, not the body) ──
const WOODCUTTER = 10;
const STONEMASON = 11;
const CLAY_DIGGER = 12;
const MINER = 13;
const SMITH = 14;
const PORTER = 15;

// ── buildings (real viking typeIds so the renderer draws a stock building + a smithy, while THIS content
//    gives them the recipe/worker/stock the sim runs) ──
const WAREHOUSE = 7; // stock_00 — a passive store
const FORGE = 31; // work_smithy_00 — the sword workshop

const MAP_W = 20;
const MAP_H = 14;

/** How long one forging cycle takes, in ticks — short enough that a sword lands well inside the run. */
const FORGE_TICKS = 60;

/**
 * A rectangular `w`×`h` building body anchored at its top-left, with a 1-cell keep-out `reserved` ring
 * around it and a `door` on one edge. This is ordinary footprint DATA — the very same shape every real
 * (extracted `[GfxHouse]`) building carries. The sim's GLOBAL collision + placement systems read it and
 * do the rest for free: `buildingBlockedCells` blocks the walls so a settler routes AROUND the building
 * and enters through the door, and `canPlaceBuilding` keeps other buildings out of the reserved ring so
 * two can't be stacked. Synthetic scene content just has to declare it (real content gets it from the
 * pipeline); nothing here is scene-local behavior. `familyBody` == `blocked` (no upgrade levels).
 */
function rectFootprint(w: number, h: number, door: FootprintCell): BuildingFootprint {
  const body: FootprintCell[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) body.push({ dx, dy });
  const reserved: FootprintCell[] = [];
  for (let dy = -1; dy <= h; dy++) for (let dx = -1; dx <= w; dx++) reserved.push({ dx, dy });
  return { blocked: body, familyBody: body, reserved, door };
}

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-craft-chain-scene' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: WOOD, id: 'wood', weight: 1, atomics: { harvest: HARVEST_WOOD } },
      { typeId: STONE, id: 'stone', weight: 1, atomics: { harvest: HARVEST_STONE } },
      { typeId: CLAY, id: 'mud', weight: 1, atomics: { harvest: HARVEST_CLAY } },
      { typeId: IRON, id: 'iron', weight: 1, atomics: { harvest: HARVEST_IRON } },
      { typeId: SWORD, id: 'sword_shord', weight: 1 },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [HARVEST_WOOD] },
      { typeId: STONEMASON, id: 'stonemason', allowedAtomics: [HARVEST_STONE] },
      { typeId: CLAY_DIGGER, id: 'clay_digger', allowedAtomics: [HARVEST_CLAY] },
      { typeId: MINER, id: 'miner', allowedAtomics: [HARVEST_IRON] },
      { typeId: SMITH, id: 'smith' }, // no harvest atomic — a producer, gated by being the forge's worker
      { typeId: PORTER, id: 'porter' }, // no harvest atomic — ferries loose piles into its warehouse
    ],
    buildings: [
      {
        typeId: WAREHOUSE,
        id: 'warehouse',
        kind: 'storage',
        // A 2×2 body; the door sits just off the SOUTH-east front (dx1,dy2) so a settler stands in FRONT
        // of the sprite (a strictly greater iso depth, col+row) — visible at the entrance, never hidden
        // behind the building or standing off beside it.
        footprint: rectFootprint(2, 2, { dx: 1, dy: 2 }),
        stock: [
          { goodType: WOOD, capacity: 50, initial: 0 },
          { goodType: STONE, capacity: 50, initial: 0 },
          { goodType: CLAY, capacity: 50, initial: 0 },
          { goodType: IRON, capacity: 50, initial: 0 },
          { goodType: SWORD, capacity: 50, initial: 0 },
        ],
      },
      {
        typeId: FORGE,
        id: 'forge',
        kind: 'workplace',
        // A 2×2 body; the door is on the SOUTH-east front (dx1,dy2), NOT the north side. A north door
        // sits at a LOWER iso depth than the building body, so the forge sprite would draw on top of and
        // hide the smith standing there. With a front door the smith walks AROUND the forge to the door
        // and stands there in front of it (visible) to work.
        footprint: rectFootprint(2, 2, { dx: 1, dy: 2 }),
        workers: [{ jobType: SMITH, count: 1 }],
        stock: [
          { goodType: IRON, capacity: 10, initial: 0 },
          { goodType: WOOD, capacity: 10, initial: 0 },
          { goodType: SWORD, capacity: 10, initial: 0 },
        ],
        produces: [SWORD],
        recipe: {
          inputs: [
            { goodType: IRON, amount: 1 },
            { goodType: WOOD, amount: 1 },
          ],
          outputs: [{ goodType: SWORD, amount: 1 }],
          ticks: FORGE_TICKS,
        },
      },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // Every gatherer's harvest atomic plays the same swing animation (the mod authors one generic
        // harvest motion for the man body; per-resource swings are a future asset). Length 16 → a full
        // windup→strike swing, like the woodcut.
        atomicBindings: [
          { jobType: WOODCUTTER, atomicId: HARVEST_WOOD, animation: 'viking_harvest' },
          { jobType: STONEMASON, atomicId: HARVEST_STONE, animation: 'viking_harvest' },
          { jobType: CLAY_DIGGER, atomicId: HARVEST_CLAY, animation: 'viking_harvest' },
          { jobType: MINER, atomicId: HARVEST_IRON, animation: 'viking_harvest' },
        ],
      },
    ],
    atomicAnimations: [{ id: 'viking_harvest', name: 'viking_harvest', length: 16 }],
  });
}

// ── layout (map 20×14). The warehouse sits upper-right and the forge is offset DIAGONALLY to its
//    lower-left — far enough that the two (over-sized) building sprites have clear daylight between them,
//    not just the logical keep-out rings. Their reserved zones don't touch, so canPlaceBuilding would
//    accept the layout. Wood + iron sit east so their direct hauls into the warehouse are short; the flag
//    sits just west of the warehouse so the PORTER's ferry is a short, visible hop right beside it, while
//    the stone + clay diggers trek in from the far west to fill it. ──
const WAREHOUSE_AT = { x: 14, y: 3 }; // 2×2 body (14,3)-(15,4); front door at (15,5)
const FORGE_AT = { x: 11, y: 10 }; // 2×2 body (11,10)-(12,11); front door at (12,12)
const FLAG_AT = { x: 10, y: 3 }; // a bare ground pile just west of the warehouse

interface Cluster {
  readonly good: number;
  readonly harvest: number;
  readonly nodes: ReadonlyArray<{ x: number; y: number }>;
  readonly gatherer: { x: number; y: number; job: number; deliverTo: 'warehouse' | 'flag' };
}

/** Units per node — enough iron + wood for several swords; stone + clay just enough to show the flag route. */
const NODE_UNITS = 4;

const CLUSTERS: readonly Cluster[] = [
  // Wood + iron → delivered STRAIGHT to the warehouse (the "assigned to the warehouse" route). Their
  // nodes sit east of the buildings (x ≥ 16), clear of both reserved keep-out rings.
  {
    good: WOOD,
    harvest: HARVEST_WOOD,
    nodes: [
      { x: 17, y: 2 },
      { x: 18, y: 2 },
    ],
    gatherer: { x: 17, y: 3, job: WOODCUTTER, deliverTo: 'warehouse' },
  },
  {
    good: IRON,
    harvest: HARVEST_IRON,
    nodes: [
      { x: 15, y: 11 },
      { x: 15, y: 12 },
    ],
    gatherer: { x: 14, y: 11, job: MINER, deliverTo: 'warehouse' },
  },
  // Stone + clay → dropped at the FLAG (the "deliver to a flag on the ground" route); the porter ferries them.
  // Their nodes sit at the far west edge so the gather leg is the long, visible trek in to the flag.
  {
    good: STONE,
    harvest: HARVEST_STONE,
    nodes: [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ],
    gatherer: { x: 3, y: 3, job: STONEMASON, deliverTo: 'flag' },
  },
  {
    good: CLAY,
    harvest: HARVEST_CLAY,
    nodes: [
      { x: 2, y: 11 },
      { x: 3, y: 11 },
    ],
    gatherer: { x: 3, y: 10, job: CLAY_DIGGER, deliverTo: 'flag' },
  },
];

const PORTER_AT = { x: 12, y: 4 }; // right beside the warehouse — a short, visible flag → warehouse ferry
const SMITH_AT = { x: 11, y: 7 }; // between the buildings, near the forge door; it paths onto the door to work
const CIVILIAN_AT = { x: 4, y: 12 }; // off in the SW corner, unmistakably a bystander — "cywil nie robi nic"

/** Create a built building of `buildingType` at (x,y) with an empty store. */
function placeBuilding(sim: Simulation, buildingType: number, x: number, y: number): number {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: fx.fromInt(1), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

/** A bare ground pile / flag: a positioned store with NO building. */
function placeFlag(sim: Simulation, x: number, y: number): number {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

function placeSettler(sim: Simulation, x: number, y: number, job: number | null, boundTo?: number): number {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: job,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  if (boundTo !== undefined) sim.world.add(e, JobAssignment, { workplace: boundTo });
  return e;
}

function build(sim: Simulation): void {
  // Buildings + flag first (created directly so their entity ids exist for the JobAssignments below —
  // no placeBuilding command / mid-build step, so the whole scene is one deterministic pass).
  const warehouse = placeBuilding(sim, WAREHOUSE, WAREHOUSE_AT.x, WAREHOUSE_AT.y);
  const forge = placeBuilding(sim, FORGE, FORGE_AT.x, FORGE_AT.y);
  const flag = placeFlag(sim, FLAG_AT.x, FLAG_AT.y);

  // Resource clusters + their gatherers. A gatherer is BOUND to where it delivers (the warehouse for
  // wood/iron, the flag for stone/clay); its `allowedAtomics` is the single harvest it may run.
  for (const cluster of CLUSTERS) {
    for (const n of cluster.nodes) {
      const node = sim.world.create();
      sim.world.add(node, Position, { x: fx.fromInt(n.x), y: fx.fromInt(n.y) });
      sim.world.add(node, Resource, {
        goodType: cluster.good,
        remaining: NODE_UNITS,
        harvestAtomic: cluster.harvest,
      });
    }
    const target = cluster.gatherer.deliverTo === 'warehouse' ? warehouse : flag;
    placeSettler(sim, cluster.gatherer.x, cluster.gatherer.y, cluster.gatherer.job, target);
  }

  // The porter (ferries flag piles → warehouse), the smith (forge loop), and an idle civilian.
  placeSettler(sim, PORTER_AT.x, PORTER_AT.y, PORTER, warehouse);
  placeSettler(sim, SMITH_AT.x, SMITH_AT.y, SMITH, forge);
  placeSettler(sim, CIVILIAN_AT.x, CIVILIAN_AT.y, null); // cywil — no job, does nothing
}

/** The warehouse store's amount of `good`. */
function warehouseGood(sim: Simulation, good: number): number {
  for (const e of sim.world.query(Building, Stockpile)) {
    if (sim.world.get(e, Building).buildingType !== WAREHOUSE) continue;
    return sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return 0;
}

function settlersWithJob(sim: Simulation, job: number): number {
  let n = 0;
  for (const e of sim.world.query(Settler)) {
    if (sim.world.get(e, Settler).jobType === job) n++;
  }
  return n;
}

export const craftChainScene: SceneDefinition = {
  id: 'craft-chain',
  title: 'Zawody — zbieracze, tragarz, kowal i kuźnia',
  summary:
    'Każda postać ma JEDEN zawód: drwal tnie drewno, górnik kopie żelazo (oboje niosą surowiec prosto ' +
    'do magazynu), kamieniarz i kopacz gliny zrzucają swój urobek na FLAGĘ (stertę na ziemi), a TRAGARZ ' +
    'znosi te sterty do magazynu. KOWAL bierze z magazynu tylko to, czego wymaga receptura (żelazo + ' +
    'drewno), wykuwa miecz w kuźni i odnosi gotowy miecz do magazynu. Cywil nic nie robi — stoi. Nic w ' +
    'łańcuchu nie jest zahardkodowane: wejścia kowala to receptura kuźni, a kto co kopie to bramka ' +
    'zawód→atomic.',
  seed: 7,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // Enough for the whole loop with margin (observed: first sword banks ~tick 310; the slowest check,
  // clay ferried the long flag→porter→warehouse route, lands ~tick 856 — the porter clears the lower-id
  // stone first). 1200 clears all four checks comfortably without bloating the determinism double-run.
  runTicks: 1200,
  // Zoom out so the whole 20×14 board — both delivery routes, the flag, the warehouse and the forge —
  // reads at once next to the checklist panel.
  initialZoom: 0.62,
  checklist: [
    'Każdy zbieracz kopie TYLKO swój surowiec: drwal → drewno, górnik → żelazo, kamieniarz → kamień, kopacz → glina (zamach przy złożu, potem marsz z WIDOCZNYM ładunkiem — kłoda / kamień / glina / sztaba)',
    'Drwal i górnik niosą surowiec prosto do magazynu; kamieniarz i kopacz przynoszą urobek z dalekiego zachodu na FLAGĘ tuż obok magazynu, a tragarz kursuje flaga → magazyn (krótki, widoczny odcinek — tragarz jest zajęty przy samym magazynie)',
    'Kowal kursuje magazyn → kuźnia: bierze żelazo i drewno (nie kamień/glinę), OBCHODZI kuźnię i wchodzi przez drzwi (nie przenika przez ścianę), stoi na progu gdy kuje, po czym niesie MIECZ z powrotem do magazynu',
    'Magazyn i kuźnia stoją osobno, z wolnym pasem między nimi — kolizja i strefa odstępu budynków działa globalnie (z footprintów), więc nie da się ich postawić na sobie',
    'Cywil (w lewym-dolnym rogu, z dala od magazynu) stoi bezczynnie — nic nie kopie ani nie nosi ("cywil nie robi nic")',
    'Postacie idą po skosie prosto do celu (nie schodkami/łukiem) — po naprawie pathfindingu',
    'Znane braki (następny krok — grafika świata): złoża wciąż rysują się jak drzewa, a sterty na ziemi i flaga są jeszcze niewidoczne — rozpoznaj surowiec po ładunku, który niesie postać',
  ],
  checks: [
    {
      label:
        'the full chain closed: a finished SWORD reached the warehouse (gather → deliver → smith fetch → forge → return)',
      predicate: (sim) => warehouseGood(sim, SWORD) >= 1,
    },
    {
      label: 'the direct route fed the warehouse its sword inputs (wood + iron delivered by their gatherers)',
      predicate: (sim) =>
        warehouseGood(sim, WOOD) + warehouseGood(sim, SWORD) >= 1 &&
        warehouseGood(sim, IRON) + warehouseGood(sim, SWORD) >= 1,
    },
    {
      label: 'the flag route ran: the porter ferried stone AND clay from the flag into the warehouse',
      predicate: (sim) => warehouseGood(sim, STONE) >= 1 && warehouseGood(sim, CLAY) >= 1,
    },
    {
      label: 'every trade is staffed by exactly one worker, plus the idle civilian',
      predicate: (sim) =>
        settlersWithJob(sim, WOODCUTTER) === 1 &&
        settlersWithJob(sim, MINER) === 1 &&
        settlersWithJob(sim, STONEMASON) === 1 &&
        settlersWithJob(sim, CLAY_DIGGER) === 1 &&
        settlersWithJob(sim, SMITH) === 1 &&
        settlersWithJob(sim, PORTER) === 1 &&
        settlersWithJob(sim, null as unknown as number) === 1,
    },
  ],
};
