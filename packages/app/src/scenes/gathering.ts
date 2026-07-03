import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Component, type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../catalog/felling.js';
import { HARVEST_SWING_LENGTH } from '../content/settler-gfx.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **the multi-hit harvest + drop-on-ground cycle is now LIVE.** A woodcutter walks to a
 * stand of trees and CHOPS each one down over several swings; the tree FALLS, leaving a STUMP where it
 * stood and a TRUNK (the felled wood) on the ground holding the tree's whole yield; the woodcutter then
 * PICKS the wood up and carries it, a load at a time, to a delivery FLAG, whose heap grows as it fills
 * (ROADMAP Phase 3 "Faithful multi-hit harvest + drop-on-ground"). A static row of the OTHER gatherable
 * goods' nodes (rock, clay/iron/gold mines, mushroom) sits across the top as the per-good node graphics
 * showcase (rung-2), untouched — the woodcutter's `allowedAtomics` is wood only, so it never digs them.
 *
 * Two consumers of the ONE deterministic run: the headless half asserts the CYCLE mechanic (every tree
 * felled → a stump each → the whole yield delivered to the flag, goods conserved); the browser half is
 * the human's pixel/animation sign-off (the chop swing, the tree→stump+trunk swap, the carried log, the
 * growing flag heap). The goods' typeId NUMBERS are scene-local, matched to the decoded graphics by
 * id-SLUG (wood→tree/debris, stone→rock, …), so the render binds the right object regardless.
 */

const { Felling, Position, Resource, Settler, Stockpile, Stump } = components;

// ── goods, id-slug matched to the decoded gathering pipeline. Numbers are scene-local, NOT the original's. ──
const WOOD = 1;
const STONE = 2;
const MUD = 3;
const IRON = 4;
const GOLD = 5;
const MUSHROOM = 6;

// ── harvest atomics (one per raw good; the woodcutter may run ONLY the wood chop — the job→atomic gate). ──
const HARVEST_WOOD = 24; // the render's HARVEST_ATOMIC (the woodcut swing)

const WOODCUTTER = 10; // 10+ band: draws the generic man; the trade is what differs

// ── the felling calibration comes from the ONE global source (catalog/felling), NOT a per-scene number —
//    so every scene that fells trees uses the same pace + yield and can't drift (docs/FIDELITY.md). ──
const CHOPS_TO_FELL = WOOD_CHOPS_TO_FELL;
const TREE_WOOD_YIELD = WOOD_YIELD_PER_NODE;

interface Displayable {
  readonly good: number;
  readonly id: string;
  readonly harvest: number;
}

/** The non-wood gatherables shown as static display nodes (the per-good node graphics showcase). */
const DISPLAY_NODES: readonly Displayable[] = [
  { good: STONE, id: 'stone', harvest: 25 },
  { good: MUD, id: 'mud', harvest: 26 },
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
      ...DISPLAY_NODES.map((g) => ({ typeId: g.good, id: g.id, weight: 1, atomics: { harvest: g.harvest } })),
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOODCUTTER, id: 'woodcutter', allowedAtomics: [HARVEST_WOOD] },
    ],
    buildings: [], // the collection point is a bare delivery flag, placed directly in build()
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // The woodcutter's chop animation (atomic 24) — the planner resolves the chop duration through it.
        atomicBindings: [{ jobType: WOODCUTTER, atomicId: HARVEST_WOOD, animation: 'viking_chop' }],
      },
    ],
    // The chop swing length is the ONE global constant (settler-gfx) — a full windup→impact swing; a
    // scene-local number (this was 6) replays only the windup and restarts every atomic.
    atomicAnimations: [{ id: 'viking_chop', name: 'viking_chop', length: HARVEST_SWING_LENGTH }],
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

/** Place the woodcutter at (x,y). */
function placeWoodcutter(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: WOODCUTTER,
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
  placeWoodcutter(sim, WOODCUTTER_AT.x, WOODCUTTER_AT.y);
  placeFlag(sim, FLAG_AT.x, FLAG_AT.y);
}

/** The wood delivered to the collection flag (its stockpile's wood). */
function flagWood(sim: Simulation): number {
  for (const e of sim.world.query(Stockpile)) {
    // The flag is the bare stockpile at FLAG_AT; a felled trunk is also a bare stockpile, so key on the cell.
    const p = sim.world.get(e, Position);
    if (fx.toInt(p.x) === FLAG_AT.x && fx.toInt(p.y) === FLAG_AT.y) {
      return sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0;
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
  title: 'Ścinanie drzew — rąb, upadek, pień, kłoda i znoszenie',
  summary:
    'Drwal podchodzi do drzew i ŚCINA każde kilkoma uderzeniami; drzewo pada, zostaje PIEŃ, a na ziemi ' +
    'leży KŁODA (całe drewno z drzewa); drwal podnosi drewno i znosi je — porcja po porcji — na FLAGĘ ' +
    'dostaw, której sterta rośnie. U góry statyczny rząd złóż pozostałych surowców (skała, kopalnie, ' +
    'grzyb) jako pokaz grafiki — drwal ich nie rusza (rąbie tylko drewno).',
  seed: 11,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // The full fell→carry→deliver cycle settles at ~tick 1220 (six real-length chop swings per tree);
  // 1500 leaves headroom so the headless checks see the settled end state.
  runTicks: 1500,
  initialZoom: 0.9,
  checklist: [
    'Drwal podchodzi do drzewa i RĄBIE je kilka razy (animacja topora), po czym drzewo znika — a na jego miejscu zostaje PIEŃ/gałęzie i osobno KŁODA (sterta drewna) na ziemi',
    'Drwal PODNOSI drewno z kłody i niesie je (widoczny ładunek) na FLAGĘ; po kilku kursach kłoda znika, a sterta na fladze ROŚNIE',
    'Po ścięciu wszystkich drzew: trzy pnie stoją tam, gdzie rosły drzewa, a całe drewno (3×3 = 9) leży na fladze',
    'Górny rząd złóż (skała, glina, żelazo, złoto, grzyb) stoi nietknięty i każde rysuje SWÓJ obiekt (pokaz grafiki)',
    'Znane skróty (v1): pień rysuje „tree debris” z ls_trees_dead; drzewo pada natychmiast (bez animacji upadku — to krok 7); flaga jest w kolorze gracza 01 (docs/FIDELITY.md)',
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
      label: 'the whole felled yield (3 trees × 3 wood) is delivered to the collection flag',
      predicate: (sim) => flagWood(sim) === TREE_XS.length * TREE_WOOD_YIELD,
    },
    {
      label: 'the static per-good display nodes are untouched (five non-wood nodes remain)',
      predicate: (sim) => count(sim, Resource) === DISPLAY_NODES.length,
    },
  ],
};
