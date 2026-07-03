import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, components, fx } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **the gathering economy is now VISIBLE.** One standing node of every gatherable good
 * (a tree, a rock, a clay/iron/gold mine, a mushroom), a row of dropped ground piles per good at rising
 * fill amounts, and a bare delivery flag — each drawing its OWN decoded `[GfxLandscape]` graphic instead
 * of the single hardcoded yew tree the renderer used to blit for every resource (docs/ROADMAP.md rung-2
 * "Resource nodes by goodType" + "Loose ground piles + flags rendering").
 *
 * This is a STATIC display: the world is placed once and nothing gathers (the sim mechanics — multi-chop
 * felling, mineral shrink — are Steps 3–4). Its whole point is the pixels, so the browser half is the
 * real deliverable; the headless half asserts the render DATA the human then judges — that every node
 * classifies as a `resource` carrying its `goodType`, every held pile as a `stockpile` with its good +
 * fill, and the empty pile as a bare flag (see `packages/app/test/gathering-render.test.ts`), plus that
 * the world was populated as intended (the {@link SceneDefinition.checks} below).
 *
 * The goods' typeId NUMBERS here are deliberately NOT the original's (wood is 1, not the real 5): the
 * render binds each node/pile by the good's id-SLUG against the decoded `content/ir.json`, so a scene's
 * own numbering resolves the right tree/mine/pile regardless — the same slug join the carry looks use.
 */

const { Position, Resource, Stockpile } = components;

// ── the gatherable goods, id-slug matched to the decoded gathering pipeline (wood→tree, stone→rock,
//    mud→clay mine, iron/gold→ore mines, mushroom→mushroom). Numbers are scene-local, NOT the original's. ──
const WOOD = 1;
const STONE = 2;
const MUD = 3;
const IRON = 4;
const GOLD = 5;
const MUSHROOM = 6;

interface Gatherable {
  readonly good: number;
  readonly id: string;
  readonly harvest: number; // the good's `atomicForHarvesting` (kept faithful, though nothing runs here)
}

/** One node per gatherable good, drawn left→right. Harvest atomics are the original's per-good ids. */
const GATHERABLES: readonly Gatherable[] = [
  { good: WOOD, id: 'wood', harvest: 24 },
  { good: STONE, id: 'stone', harvest: 25 },
  { good: MUD, id: 'mud', harvest: 26 },
  { good: IRON, id: 'iron', harvest: 27 },
  { good: GOLD, id: 'gold', harvest: 28 },
  { good: MUSHROOM, id: 'mushroom', harvest: 32 },
];

const MAP_W = 18;
const MAP_H = 14;

/** A full, undepleted node's remaining units — arbitrary here (Step 2 always draws the full node). */
const NODE_UNITS = 5;

/** The fill amounts the pile rows show, so a human sees the heap grow small → full (the `ls_goods` fill
 *  states run 1..5; 5 is the fullest heap). */
const PILE_FILLS = [1, 3, 5] as const;

/** The goods whose ground piles are shown at every {@link PILE_FILLS} amount — wood + stone read clearly. */
const PILE_GOODS = [
  { good: WOOD, id: 'wood' },
  { good: STONE, id: 'stone' },
] as const;

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-gathering-scene' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      ...GATHERABLES.map((g) => ({ typeId: g.good, id: g.id, weight: 1, atomics: { harvest: g.harvest } })),
    ],
    jobs: [], // a static display — no settlers, so no jobs
    buildings: [], // …and no buildings; the nodes/piles/flag are placed directly in build()
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [{ typeId: VIKING, id: 'viking' }],
  });
}

/** Place a standing resource node of `good` at (x,y). */
function placeNode(sim: Simulation, good: number, harvest: number, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType: good, remaining: NODE_UNITS, harvestAtomic: harvest });
}

/** Place a bare ground pile of `good` holding `amount` units at (x,y) — a Stockpile with no Building. */
function placePile(sim: Simulation, good: number, amount: number, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[good, amount]]) });
}

/** Place a bare delivery flag at (x,y) — an EMPTY Stockpile with no Building (a designated collection point). */
function placeFlag(sim: Simulation, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map() });
}

const NODE_ROW_Y = 2;
const PILE_ROW_Y = [6, 8] as const; // wood piles on row 6, stone piles on row 8
const FLAG_AT = { x: 2, y: 11 };

function build(sim: Simulation): void {
  // One node per gatherable good, spread along the top row.
  GATHERABLES.forEach((g, i) => placeNode(sim, g.good, g.harvest, 2 + i * 2, NODE_ROW_Y));
  // Two rows of ground piles (wood, stone), each at rising fill amounts so the heap visibly grows.
  PILE_GOODS.forEach((pg, row) => {
    PILE_FILLS.forEach((fill, i) => placePile(sim, pg.good, fill, 2 + i * 3, PILE_ROW_Y[row] as number));
  });
  // A bare delivery flag (empty pile).
  placeFlag(sim, FLAG_AT.x, FLAG_AT.y);
}

/** Count the resource nodes (entities carrying a {@link Resource}). */
function nodeCount(sim: Simulation): number {
  let n = 0;
  for (const _ of sim.world.query(Resource)) n++;
  return n;
}

/** Count the bare ground piles/flags (a {@link Stockpile} with NO {@link Building}). */
function stockpileCount(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (!sim.world.has(e, components.Building)) n++;
  }
  return n;
}

/** Count the EMPTY bare stockpiles (delivery flags — holding no goods). */
function flagCount(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Stockpile)) {
    if (sim.world.has(e, components.Building)) continue;
    if (sim.world.get(e, Stockpile).amounts.size === 0) n++;
  }
  return n;
}

export const gatheringScene: SceneDefinition = {
  id: 'gathering',
  title: 'Ekonomia zbierania — surowce, sterty i flaga',
  summary:
    'Statyczna wystawa grafiki świata: po jednym stojącym złożu każdego surowca (drzewo, skała, kopalnia ' +
    'gliny/żelaza/złota, grzyb), rzędy zrzuconych stert danego surowca o rosnącej wielkości oraz pusta ' +
    'flaga dostaw. Każdy obiekt rysuje SWOJĄ grafikę (a nie jedną zahardkodowaną cisę). Nic tu nie zbiera ' +
    '— mechanika ścinania i kurczenia złóż to kolejne kroki; tu liczą się piksele.',
  seed: 11,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 2, // static — a couple of ticks just to settle a stable snapshot
  initialZoom: 0.85,
  checklist: [
    'Każde złoże w górnym rzędzie rysuje SWÓJ obiekt: drewno → drzewo, kamień → skała/głazy, glina → kopalnia gliny, żelazo → kopalnia żelaza, złoto → kopalnia złota, grzyb → grzyb (żadne nie jest już cisą)',
    'Sterty na ziemi (rzędy poniżej) wyglądają jak sterty TEGO surowca (kłody drewna, bryły kamienia) i ROSNĄ z ilością — mała sterta przy 1, pełna przy 5',
    'Flaga (lewy dół) czyta się jak wbita w ziemię tabliczka/flaga dostaw, nie jak sterta ani skrzynia',
    'Proporcje: złoża i sterty pasują wielkością do terenu (jak drzewo/dom), nie są olbrzymie ani malutkie',
    'Znany skrót (v1): flaga jest w kolorze gracza 01; swap na kolor właściciela to osobny krok (docs/FIDELITY.md)',
  ],
  checks: [
    {
      label: 'one standing node per gatherable good (six distinct resource nodes placed)',
      predicate: (sim) => nodeCount(sim) === GATHERABLES.length,
    },
    {
      label: 'the ground piles + the delivery flag are all bare stockpiles (no building store among them)',
      predicate: (sim) => stockpileCount(sim) === PILE_GOODS.length * PILE_FILLS.length + 1,
    },
    {
      label: 'exactly one bare delivery flag (an empty stockpile) is present',
      predicate: (sim) => flagCount(sim) === 1,
    },
  ],
};
