import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Component, type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../catalog/felling.js';
import { CLAY_DEPOSIT_UNITS, MINE_LEVELS } from '../catalog/mining.js';
import { HARVEST_SWING_LENGTH } from '../content/settler-gfx.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **the felling AND mining cycles are LIVE.** A woodcutter walks to a stand of trees and
 * CHOPS each one down over several swings; the tree FALLS, leaving a STUMP and a TRUNK (the felled wood) on
 * the ground; the woodcutter PICKS the wood up and carries it, a load at a time, to a delivery FLAG whose
 * heap grows (ROADMAP Phase 3 "Faithful multi-hit harvest + drop-on-ground"). Below it, a MINER chips a
 * mineral DEPOSIT: each swing drops one unit at its cell as an ORE pile the miner carries off to its own
 * flag, and the deposit's graphic visibly STEPS DOWN a fill level as it empties — vanishing once its last
 * unit is chipped (gathering Step 4). A static row of the OTHER gatherable goods' nodes (rock, iron/gold
 * mine, mushroom) sits across the top as the per-good node graphics showcase (rung-2), untouched — each
 * worker's `allowedAtomics` is its own trade only, so neither digs them.
 *
 * Two consumers of the ONE deterministic run: the headless half asserts the mechanics (every tree felled →
 * a stump each → its yield at the felling flag; the deposit chipped dry → removed → its whole size at the
 * mining flag; goods conserved); the browser half is the human's pixel/animation sign-off (the chop swing,
 * the tree→stump+trunk swap, the mine shrinking level by level, the carried loads, the growing flag heaps).
 * The goods' typeId NUMBERS are scene-local, matched to the decoded graphics by id-SLUG (wood→tree/debris,
 * mud→clay mine, …), so the render binds the right object regardless.
 */

const { Felling, MineDeposit, Position, Resource, Settler, Stockpile, Stump } = components;

// ── goods, id-slug matched to the decoded gathering pipeline. Numbers are scene-local, NOT the original's. ──
const WOOD = 1;
const STONE = 2;
const MUD = 3;
const IRON = 4;
const GOLD = 5;
const MUSHROOM = 6;

// ── harvest atomics (one per raw good; a worker may run ONLY its trade's atomic — the job→atomic gate). ──
const HARVEST_WOOD = 24; // the render's HARVEST_ATOMIC (the woodcut swing)
const HARVEST_MUD = 26; // the mining swing (clay/mud deposit)

const WOODCUTTER = 10; // 10+ band: draws the generic man; the trade is what differs
const MINER = 11;

// ── the felling + mining calibration comes from the ONE global source (catalog/felling + catalog/mining),
//    NOT per-scene numbers — so every scene uses the same pace/yield/deposit-size and can't drift
//    (docs/FIDELITY.md). ──
const CHOPS_TO_FELL = WOOD_CHOPS_TO_FELL;
const TREE_WOOD_YIELD = WOOD_YIELD_PER_NODE;
const MUD_DEPOSIT_UNITS = CLAY_DEPOSIT_UNITS; // the mined deposit's size
const MUD_DEPOSIT_LEVELS = MINE_LEVELS; // its visual fill states (the ls_ground clay mine's 5)

interface Displayable {
  readonly good: number;
  readonly id: string;
  readonly harvest: number;
}

/** The non-wood, non-mined gatherables shown as static display nodes (the per-good node graphics
 *  showcase) — mud is NOT here: it is the ACTIVELY-mined deposit below (so the miner touches only it). */
const DISPLAY_NODES: readonly Displayable[] = [
  { good: STONE, id: 'stone', harvest: 25 },
  { good: IRON, id: 'iron', harvest: 27 },
  { good: GOLD, id: 'gold', harvest: 28 },
  { good: MUSHROOM, id: 'mushroom', harvest: 32 },
];

const MAP_W = 18;
const MAP_H = 14;

/** A full display node's remaining units — arbitrary (a static display never depletes). */
const DISPLAY_NODE_UNITS = 5;

// The felling stand + collection point, laid out on one row so the walk reads clearly left→right.
const STAND_Y = 8;
const TREE_XS = [5, 7, 9] as const; // three trees to fell
const WOODCUTTER_AT = { x: 2, y: STAND_Y };
const FLAG_AT = { x: 13, y: STAND_Y };
const DISPLAY_ROW_Y = 2;

// The mining demo on the bottom row: miner → deposit → its own flag (kept nearest the deposit so the
// miner delivers here, not to the distant felling flag; far from the trees so the woodcutter uses its own).
const MINE_ROW_Y = 12;
const MINER_AT = { x: 2, y: MINE_ROW_Y };
const DEPOSIT_AT = { x: 6, y: MINE_ROW_Y };
const MINE_FLAG_AT = { x: 10, y: MINE_ROW_Y };

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-gathering-scene' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      // Wood declares the felling lifecycle (chops + whole yield) — the sim stamps it onto each tree as a
      // Felling component. The landscape-stage refs are a render join the synthetic scene doesn't model.
      {
        typeId: WOOD,
        id: 'wood',
        weight: 1,
        atomics: { harvest: HARVEST_WOOD },
        gathering: { bioLandscape: true, chopsToFell: CHOPS_TO_FELL, yieldPerNode: TREE_WOOD_YIELD },
      },
      // Mud/clay declares the MINING lifecycle (deposit size + fill levels) — the sim stamps it onto the
      // deposit as a MineDeposit component; a chip drops one ore unit at its cell and the node shrinks a
      // level until removed. `bioLandscape: false` (mined, not living, like the other minerals).
      {
        typeId: MUD,
        id: 'mud',
        weight: 1,
        atomics: { harvest: HARVEST_MUD },
        gathering: { bioLandscape: false, depositSize: MUD_DEPOSIT_UNITS, depositLevels: MUD_DEPOSIT_LEVELS },
      },
      ...DISPLAY_NODES.map((g) => ({ typeId: g.good, id: g.id, weight: 1, atomics: { harvest: g.harvest } })),
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [HARVEST_WOOD] },
      { typeId: MINER, id: 'miner', allowedAtomics: [HARVEST_MUD] },
    ],
    buildings: [], // the collection point is a bare delivery flag, placed directly in build()
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // The chop (atomic 24) + mine (atomic 26) swings — the planner resolves each duration through these.
        atomicBindings: [
          { jobType: WOODCUTTER, atomicId: HARVEST_WOOD, animation: 'viking_chop' },
          { jobType: MINER, atomicId: HARVEST_MUD, animation: 'viking_mine' },
        ],
      },
    ],
    // The chop/mine swing length is the ONE global constant (settler-gfx) — a full windup→impact swing; a
    // scene-local number (this was 6) replays only the windup and restarts every atomic.
    atomicAnimations: [
      { id: 'viking_chop', name: 'viking_chop', length: HARVEST_SWING_LENGTH },
      { id: 'viking_mine', name: 'viking_mine', length: HARVEST_SWING_LENGTH },
    ],
  });
}

/** Place a standing FELLABLE wood tree at (x,y): its felling spec comes from the wood good's `gathering`. */
function placeTree(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: WOOD, remaining: TREE_WOOD_YIELD, harvestAtomic: HARVEST_WOOD });
  sim.world.add(e, Felling, { chopsLeft: CHOPS_TO_FELL });
}

/** Place a static (single-hit) display node of `good` at (x,y) — the per-good node graphics showcase. */
function placeDisplayNode(sim: Simulation, good: number, harvest: number, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: good, remaining: DISPLAY_NODE_UNITS, harvestAtomic: harvest });
}

/** Place a standing MINED mud deposit at (x,y): the deposit spec (size + fill levels) comes from the mud
 *  good's `gathering`. Each chip drops one ore unit and the node shrinks a level until it is removed. */
function placeDeposit(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: MUD, remaining: MUD_DEPOSIT_UNITS, harvestAtomic: HARVEST_MUD });
  sim.world.add(e, MineDeposit, { initial: MUD_DEPOSIT_UNITS, levels: MUD_DEPOSIT_LEVELS });
}

/** Place a worker of `jobType` at (x,y) — a woodcutter (fells wood) or a miner (chips the mud deposit). */
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

function build(sim: Simulation): void {
  // The static per-good node showcase across the top.
  DISPLAY_NODES.forEach((g, i) => placeDisplayNode(sim, g.good, g.harvest, 3 + i * 3, DISPLAY_ROW_Y));
  // The felling stand + the woodcutter + the delivery flag.
  for (const x of TREE_XS) placeTree(sim, x, STAND_Y);
  placeWorker(sim, WOODCUTTER, WOODCUTTER_AT.x, WOODCUTTER_AT.y);
  placeFlag(sim, FLAG_AT.x, FLAG_AT.y);
  // The mining demo: a miner chips the mud deposit dry, carrying each ore unit to its own flag.
  placeDeposit(sim, DEPOSIT_AT.x, DEPOSIT_AT.y);
  placeWorker(sim, MINER, MINER_AT.x, MINER_AT.y);
  placeFlag(sim, MINE_FLAG_AT.x, MINE_FLAG_AT.y);
}

/** The units of `good` delivered to the collection flag at cell `at` — its bare stockpile's amount. A
 *  felled trunk / ore pile is also a bare stockpile, so key on the flag's cell (they lie elsewhere). */
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

export const gatheringScene: SceneDefinition = {
  id: 'gathering',
  title: 'Zbieranie: ścinanie drzew i wydobycie złoża (kłody, ruda, poziomy)',
  summary:
    'U góry drwal ŚCINA drzewa kilkoma uderzeniami — drzewo pada, zostaje PIEŃ i KŁODA na ziemi, którą ' +
    'drwal znosi na FLAGĘ. Niżej GÓRNIK kuje ZŁOŻE gliny: każde uderzenie zrzuca jedną bryłę RUDY, którą ' +
    'górnik znosi na swoją flagę, a grafika złoża co jakiś czas OBNIŻA się o poziom, aż złoże ZNIKA po ' +
    'wykuciu ostatniej bryły. U góry statyczny rząd pozostałych złóż (skała, żelazo, złoto, grzyb) jako ' +
    'pokaz grafiki — każdy robotnik rusza tylko swój surowiec.',
  seed: 11,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // The fell→carry→deliver cycle settles ~tick 1220; the mine chips its deposit (size CLAY_DEPOSIT_UNITS)
  // dry a good while before that. 1500 leaves headroom so the headless checks see the settled end state.
  runTicks: 1500,
  initialZoom: 0.9,
  checklist: [
    'Drwal RĄBIE drzewo kilka razy (animacja topora), po czym drzewo znika — zostaje PIEŃ/gałęzie i osobno KŁODA (sterta drewna); drwal ją PODNOSI i znosi na FLAGĘ (sterta rośnie), po ścięciu wszystkich zostają trzy pnie i całe drewno (3×3 = 9) na fladze',
    'GÓRNIK podchodzi do ZŁOŻA gliny i KUJE je: pod złożem pojawia się bryła RUDY, którą górnik zabiera i niesie na swoją flagę — i tak bryła po bryle, aż całe wydobycie (CLAY_DEPOSIT_UNITS) trafi na flagę górnika',
    'W trakcie kucia grafika ZŁOŻA wyraźnie OBNIŻA się o poziom (mniejsza kupka), a po wykuciu ostatniej bryły złoże ZNIKA z mapy',
    'Górny rząd złóż (skała, żelazo, złoto, grzyb) stoi nietknięty i każde rysuje SWÓJ obiekt (pokaz grafiki)',
    'Znane skróty (v1): pień rysuje „tree debris”; drzewo/złoże znika natychmiast (bez animacji upadku — krok 7); ruda to grafika stopnia pickup (clay ore); flagi w kolorze gracza 01; górnik zabiera każdą bryłę osobno (batching do kalibracji — docs/FIDELITY.md)',
  ],
  checks: [
    {
      label: 'every tree is felled — no Felling nodes remain (the whole stand came down)',
      predicate: (sim) => count(sim, Felling) === 0,
    },
    {
      label: 'one stump is left where each tree stood (three trees → three stumps)',
      predicate: (sim) => count(sim, Stump) === TREE_XS.length,
    },
    {
      label: 'the whole felled yield (3 trees × 3 wood) is delivered to the felling flag',
      predicate: (sim) => flagGood(sim, FLAG_AT, WOOD) === TREE_XS.length * TREE_WOOD_YIELD,
    },
    {
      label: 'the mud deposit is chipped dry and removed (no MineDeposit remains)',
      predicate: (sim) => count(sim, MineDeposit) === 0,
    },
    {
      label: 'the whole mined deposit is delivered to the mining flag (goods conserved end to end)',
      predicate: (sim) => flagGood(sim, MINE_FLAG_AT, MUD) === MUD_DEPOSIT_UNITS,
    },
    {
      label: 'the static per-good display nodes are untouched (four non-mined nodes remain)',
      predicate: (sim) => count(sim, Resource) === DISPLAY_NODES.length,
    },
  ],
};
