import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Component, type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../catalog/felling.js';
import {
  CLAY_DEPOSIT_UNITS,
  GOLD_DEPOSIT_UNITS,
  IRON_DEPOSIT_UNITS,
  MINE_LEVELS,
  STONE_DEPOSIT_UNITS,
} from '../catalog/mining.js';
import {
  CLAY_HARVEST_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  HARVEST_TICKS,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  STONE_HARVEST_ATOMIC,
} from '../content/settler-gfx.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **every raw good is gathered LIVE, each by its own trade.** Six "Zbieracz (…)" workers
 * run in parallel lanes — one per good — and each plays that good's OWN authored work motion: the wood
 * gatherer CHOPS trees (axe), the stone/iron/gold gatherers STRIKE the deposit (the shared pickaxe/mining
 * clip), the clay gatherer DIGS with a shovel, the mushroom gatherer PLUCKS. Each mineral is a DEPOSIT the
 * digger chips one ore unit at a time — several strikes per unit, so the dig reads as WORKED not tapped once,
 * and the graphic steps down a fill level and vanishes when dry; wood is a small felling stand (tree → stump +
 * carried log); mushrooms are a trivial patch (one pluck removes each). Every worker carries its harvest, a
 * load at a time, to its own delivery FLAG whose heap grows.
 *
 * Two consumers of the ONE deterministic run: the headless half asserts the mechanics (each good's whole
 * yield reaches its flag; every node/deposit is consumed; goods conserved), the browser half is the human's
 * pixel/animation sign-off — the DISTINCT per-good motion (pickaxe vs axe vs shovel vs pluck), the deposits
 * shrinking level by level, the carried loads NOT tinted the team colour, and the workers/flags drawing IN
 * FRONT of the terrain they stand on. Good typeId NUMBERS are scene-local, matched to the decoded graphics
 * by id-SLUG (wood→tree, mud→clay mine, …) and to the render's per-atomic work clips by the harvest atomic id.
 *
 * FIDELITY: the original models all six as ONE `collector` job (jobtype 8) with per-good jobExperience
 * specialisations, not six job types; the scene splits them into named trades purely for a clear
 * per-resource demo (docs/FIDELITY.md "Gathering work animations"). The bodies + motions are faithful: stone,
 * iron AND gold share the stonecrusher mining strike exactly as the base game maps them (job→clip action
 * 25/27/28 → stonecrushing); clay digs the shovel; wood chops the axe.
 */

const { Felling, MineDeposit, Position, Resource, Settler, Stockpile, Stump } = components;

// ── goods, id-slug matched to the decoded gathering pipeline. Numbers are scene-local, NOT the original's. ──
const WOOD = 1;
const STONE = 2;
const MUD = 3;
const IRON = 4;
const GOLD = 5;
const MUSHROOM = 6;

/**
 * The demo trades' job typeIds start here (`GENERIC_MAN_JOB_BASE + lane`). The band is chosen to satisfy
 * TWO constraints the workers depend on, neither of which a test would otherwise catch:
 *  - OUTSIDE the render's job→body map (woman 5, soldiers 31–41, young 1–4) so every Zbieracz draws the
 *    generic MAN body — the one that authors the `_work_` clips.
 *  - OUTSIDE the sim's behaviour-triggering job ids (`HUNTER_JOB` 15, `SCOUT_JOB` 27) so a picker never
 *    auto-hunts or scouts. 20–25 is that gap; keep any further trade below 27.
 * (A bare `job: 15` before this drew the right body but WAS the hunter id — flagged in review.)
 */
const GENERIC_MAN_JOB_BASE = 20;

/** How a lane's node is worked: a felled tree, a chipped mineral deposit, or a trivial pluck. */
type Mode = 'fell' | 'mine' | 'pick';

/**
 * One gatherer lane: a "Zbieracz (…)" worker, its good, the harvest atomic (which selects both the sim
 * DURATION via {@link HARVEST_TICKS} and the render's per-good work clip), and how many source nodes it
 * works. The `job` typeId comes from {@link GENERIC_MAN_JOB_BASE} (see its constraints). All facts are
 * global (catalog + settler-gfx), never per-scene magic numbers.
 */
interface Gatherer {
  readonly good: number;
  readonly id: string;
  readonly job: number;
  readonly jobName: string;
  readonly atomic: number;
  readonly anim: string;
  readonly mode: Mode;
  /** Source nodes placed in the lane: trees (fell), 1 deposit (mine), mushrooms in the patch (pick). */
  readonly nodes: number;
  /** Mine deposit size — units chipped out one at a time (also the shrink-by-level denominator). */
  readonly depositUnits?: number;
  readonly depositLevels?: number;
}

const GATHERERS: readonly Gatherer[] = [
  {
    good: WOOD,
    id: 'wood',
    job: GENERIC_MAN_JOB_BASE, // 20 (wood lane)
    jobName: 'Zbieracz (Drewno)',
    atomic: HARVEST_ATOMIC,
    anim: 'viking_collector_harvest_tree',
    mode: 'fell',
    nodes: 2, // a two-tree stand
  },
  {
    good: STONE,
    id: 'stone',
    job: GENERIC_MAN_JOB_BASE + 1, // stone
    jobName: 'Zbieracz (Kamień)',
    atomic: STONE_HARVEST_ATOMIC,
    anim: 'viking_collector_harvest_stone',
    mode: 'mine',
    nodes: 1,
    depositUnits: STONE_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: MUD,
    id: 'mud',
    job: GENERIC_MAN_JOB_BASE + 2, // clay
    jobName: 'Zbieracz (Glina)',
    atomic: CLAY_HARVEST_ATOMIC,
    anim: 'viking_collector_harvest_mud',
    mode: 'mine',
    nodes: 1,
    depositUnits: CLAY_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: IRON,
    id: 'iron',
    job: GENERIC_MAN_JOB_BASE + 3, // iron
    jobName: 'Zbieracz (Żelazo)',
    atomic: IRON_HARVEST_ATOMIC,
    anim: 'viking_collector_harvest_iron',
    mode: 'mine',
    nodes: 1,
    depositUnits: IRON_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: GOLD,
    id: 'gold',
    job: GENERIC_MAN_JOB_BASE + 4, // gold
    jobName: 'Zbieracz (Złoto)',
    atomic: GOLD_HARVEST_ATOMIC,
    anim: 'viking_collector_harvest_gold',
    mode: 'mine',
    nodes: 1,
    depositUnits: GOLD_DEPOSIT_UNITS,
    depositLevels: MINE_LEVELS,
  },
  {
    good: MUSHROOM,
    id: 'mushroom',
    job: GENERIC_MAN_JOB_BASE + 5, // mushroom
    jobName: 'Zbieracz (Grzyby)',
    atomic: MUSHROOM_HARVEST_ATOMIC,
    anim: 'viking_collector_harvest_mushroom',
    mode: 'pick',
    nodes: 3, // a small patch, one pluck each
  },
];

const MAP_W = 11;
const MAP_H = 15;

// Each gatherer gets a horizontal lane: worker → node(s) → flag, laid out left→right so the cycle reads
// clearly. Lanes stack down the map (one per good). The flag sits nearest its own lane so the worker
// delivers home, not to a neighbour.
//
// FRAMING: `cameraFor` centres the view on the SETTLERS (the leftmost lane element, `WORKER_X`), so the
// lane extends to the RIGHT of screen-centre — and the browser's instruction panel covers the right edge.
// The span (worker→flag) is kept SHORT and {@link gatheringScene.initialZoom} modest so the delivery flag
// never lands under that panel (the "flaga zakryta" report): 6 cells at 0.8× keeps the flag well clear.
const LANE_Y0 = 2; // first lane's row
const LANE_STEP = 2; // rows between lanes
const WORKER_X = 2;
const NODE_X0 = 5; // first source node (a stand/patch grows right from here)
const FLAG_X = 8;

/** The whole yield a lane delivers to its flag: its felled trees × per-tree wood, its deposit size, or one
 *  per plucked mushroom. The headless conservation check keys on this. */
function expectedYield(g: Gatherer): number {
  if (g.mode === 'fell') return g.nodes * WOOD_YIELD_PER_NODE;
  if (g.mode === 'mine') return g.depositUnits ?? 0;
  return g.nodes; // pick: one unit per node
}

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-gathering-scene' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      ...GATHERERS.map((g) => ({
        typeId: g.good,
        id: g.id,
        weight: 1,
        atomics: { harvest: g.atomic },
        gathering:
          g.mode === 'fell'
            ? { bioLandscape: true, chopsToFell: WOOD_CHOPS_TO_FELL, yieldPerNode: WOOD_YIELD_PER_NODE }
            : g.mode === 'mine'
              ? { bioLandscape: false, depositSize: g.depositUnits ?? 0, depositLevels: g.depositLevels ?? 0 }
              : { bioLandscape: true }, // mushroom: a trivial pickup (no felling, no deposit)
      })),
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      // One named "Zbieracz (…)" per good; each may run ONLY its own harvest atomic, so a worker gathers
      // exactly its lane's good (the job→atomic gate keeps the trades from poaching each other's nodes).
      ...GATHERERS.map((g) => ({
        typeId: g.job,
        id: `zbieracz_${g.id}`,
        name: g.jobName,
        allowedAtomics: [g.atomic],
      })),
    ],
    buildings: [], // the collection points are bare delivery flags, placed directly in build()
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // The collector's per-good harvest binding (`setatomic <job> <atomic> "<anim>"`): the sim resolves
        // each harvest's DURATION through this → the atomicAnimation length below. The render binds the
        // work CLIP off the atomic id separately (settler-gfx CHARACTER_SPECS), so these names need only match.
        atomicBindings: GATHERERS.map((g) => ({ jobType: g.job, atomicId: g.atomic, animation: g.anim })),
      },
    ],
    // Faithful per-good harvest durations (DATA — atomicanimations.ini via HARVEST_TICKS): a dig runs longer
    // than a chop, so a deposit reads as WORKED, not tapped once.
    atomicAnimations: GATHERERS.map((g) => ({
      id: g.anim,
      name: g.anim,
      length: HARVEST_TICKS[g.atomic] ?? 1,
    })),
  });
}

/** Place a standing FELLABLE wood tree at (x,y): its felling spec comes from the wood good's `gathering`. */
function placeTree(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, {
    goodType: WOOD,
    remaining: WOOD_YIELD_PER_NODE,
    harvestAtomic: HARVEST_ATOMIC,
  });
  sim.world.add(e, Felling, { chopsLeft: WOOD_CHOPS_TO_FELL });
}

/** Place a MINED mineral deposit at (x,y): each chip drops one ore unit and the node shrinks a fill level
 *  until removed. Deposit size + levels come from the good's mining calibration. */
function placeDeposit(sim: Simulation, g: Gatherer, x: number, y: number): void {
  const units = g.depositUnits ?? 0;
  const levels = g.depositLevels ?? 0;
  // A deposit with no units is a permanent phantom: the planner skips a `remaining<=0` node and the
  // drain-then-remove path never runs, so it would linger un-harvestable AND fail a `count(Resource)===0`
  // check. Fail loud at placement rather than hang the run (programmer error — a mined good needs units).
  if (units <= 0)
    throw new Error(`placeDeposit: mined good '${g.id}' needs positive depositUnits (got ${units})`);
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: g.good, remaining: units, harvestAtomic: g.atomic });
  sim.world.add(e, MineDeposit, { initial: units, levels });
}

/** Place a trivial-pickup node (a mushroom) at (x,y) — one pluck adds it to the back and removes the node. */
function placePickNode(sim: Simulation, g: Gatherer, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: g.good, remaining: 1, harvestAtomic: g.atomic });
}

/** Place a worker of `jobType` at (x,y). */
function placeWorker(sim: Simulation, jobType: number, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
}

/** Place a bare delivery flag at (x,y) — an EMPTY Stockpile with no Building (the collection point). */
function placeFlag(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map() });
}

/** The flag cell for gatherer index `i`. */
function flagCell(i: number): { x: number; y: number } {
  return { x: FLAG_X, y: LANE_Y0 + i * LANE_STEP };
}

function build(sim: Simulation): void {
  GATHERERS.forEach((g, i) => {
    const y = LANE_Y0 + i * LANE_STEP;
    placeWorker(sim, g.job, WORKER_X, y);
    for (let n = 0; n < g.nodes; n++) {
      const x = NODE_X0 + n;
      if (g.mode === 'fell') placeTree(sim, x, y);
      else if (g.mode === 'mine') placeDeposit(sim, g, x, y);
      else placePickNode(sim, g, x, y);
    }
    placeFlag(sim, FLAG_X, y);
  });
}

/** The units of `good` delivered to the collection flag at cell `at` — its bare stockpile's amount. A
 *  felled trunk / ore pile is also a bare stockpile, so key on the flag's cell (they lie at the node). */
function flagGood(sim: Simulation, at: { x: number; y: number }, good: number): number {
  for (const e of sim.world.query(Stockpile)) {
    const p = sim.world.get(e, Position);
    if (fx.toInt(p.x) === at.x && fx.toInt(p.y) === at.y) {
      return sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
    }
  }
  return 0;
}

function count<T>(sim: Simulation, component: Component<T>): number {
  let n = 0;
  for (const _ of sim.world.query(component)) n++;
  return n;
}

const WOOD_TREES = GATHERERS.filter((g) => g.mode === 'fell').reduce((n, g) => n + g.nodes, 0);

export const gatheringScene: SceneDefinition = {
  id: 'gathering',
  title: 'Zbieranie: każdy surowiec swoim zawodem (drewno, kamień, glina, żelazo, złoto, grzyby)',
  summary:
    'Sześciu ZBIERACZY pracuje równolegle, każdy swój surowiec i swoją animacją: Zbieracz (Drewno) RĄBIE ' +
    'drzewa, Zbieracz (Kamień/Żelazo/Złoto) KUJE złoże KILOFEM (ta sama animacja górnicza), Zbieracz ' +
    '(Glina) KOPIE ŁOPATĄ, Zbieracz (Grzyby) ZRYWA grzyby. Kucie/kopanie trwa kilka uderzeń na bryłę, złoże ' +
    'co chwilę obniża się o poziom i znika. Każdy znosi urobek bryła po bryle na swoją FLAGĘ. Niesiony ' +
    'surowiec ma swój kolor (nie kolor gracza), a robotnik i flaga rysują się PRZED terenem, na którym stoją.',
  seed: 11,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // Six lanes run in parallel; the slowest (the largest deposit at faithful per-good durations) settles well
  // inside this. Headroom so the headless checks see the fully-settled end state.
  runTicks: 3000,
  // Modest default so all six lanes — worker THROUGH the delivery flag — sit clear of the instruction
  // panel on the right (see the FRAMING note by the layout constants); the human can scroll-zoom in.
  initialZoom: 0.8,
  checklist: [
    'Każdy Zbieracz gra INNĄ animację pracy: Drewno = topór (rąbanie), Kamień/Żelazo/Złoto = KILOF ' +
      '(ta sama animacja górnicza dla całej trójki), Glina = ŁOPATA, Grzyby = zrywanie — a nie wszyscy jak drwal',
    'Kucie/kopanie TRWA kilka uderzeń na każdą bryłę, a nie „raz i już niesie” — kilof/łopata pracują ' +
      'zauważalnie dłużej niż topór',
    'Każde ZŁOŻE (kamień/glina/żelazo/złoto) obniża się o poziom w miarę wykuwania i ZNIKA po ostatniej ' +
      'bryle; drzewo pada i zostaje pień; grzyby znikają po zerwaniu',
    'Niesiony surowiec ma swój naturalny kolor — drewno brązowe, glina/ruda w swoim kolorze, NIE niebieskie ' +
      '(nie kolor frakcji); tylko strój robotnika jest w kolorze gracza',
    'Robotnik stojący na złożu/pniu i FLAGA na ziemi rysują się PRZED terenem (nie chowają się za nim)',
    'Znane skróty (v1): pień rysuje „tree debris”; drzewo/złoże znika natychmiast (bez animacji upadku); ' +
      'kamień/żelazo/złoto dzielą jedną animację górniczą (brak osobnej animacji kilofa — docs/FIDELITY.md)',
  ],
  checks: [
    {
      label: 'every tree in the wood stand is felled — no Felling nodes remain',
      predicate: (sim) => count(sim, Felling) === 0,
    },
    {
      label: 'one stump is left where each tree stood',
      predicate: (sim) => count(sim, Stump) === WOOD_TREES,
    },
    {
      label: 'every mineral deposit is chipped dry and removed (no MineDeposit remains)',
      predicate: (sim) => count(sim, MineDeposit) === 0,
    },
    {
      label: 'every source node is fully consumed (trees felled, deposits drained, mushrooms plucked)',
      predicate: (sim) => count(sim, Resource) === 0,
    },
    {
      label: 'each good is delivered WHOLE to its own gatherer flag (goods conserved end to end)',
      predicate: (sim) => GATHERERS.every((g, i) => flagGood(sim, flagCell(i), g.good) === expectedYield(g)),
    },
  ],
};
