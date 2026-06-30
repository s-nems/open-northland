import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, type TerrainMap, components } from '@vinland/sim';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **the `house02` skin closes the viking building set** (Render breadth ladder, rung 1 —
 * "complete the viking building set").
 *
 * The stock, brewery and coin mint were the LAST viking `[GfxHouse]` types still drawing the shared
 * representative cottage — their bobs live only on the `house02` palette skin, which was decoded on disk
 * but not loaded. This scene places those three so a human can confirm each now draws ITS own bob from the
 * two newly-loaded `house02` families:
 *  - **stock** (typeId 7) → `ls_houses_viking.bmd` recoloured `house02` (bob 53),
 *  - **brewery** (typeId 16) → `ls_houses_viking2.bmd` recoloured `house02` (bob 220),
 *  - **coin mint** (typeId 33) → `ls_houses_viking2.bmd` recoloured `house02` (bob 170).
 *
 * Under `?atlas=real` each draws its own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join,
 * `real-sprites.ts` `buildingBobRefsByType` over the `BUILDING_FAMILIES` list) — three recognisably
 * different structures, none the shared cottage. No new sim mechanic: this proves the render-side
 * `house02`-family load, which a human must eyeball (an agent can't self-judge pixels); the headless half
 * only asserts the three distinct building types were placed.
 */

const GRASS = 0;
const VIKING = 1;

const { Building } = components;

/**
 * One viking building per `house02`-family type — the `typeId`s are the real `[GfxHouse]` `LogicType`
 * values the render keys its per-type bob lookup on (`buildingBobRefsByType`), so the synthetic content's
 * ids match what `?atlas=real` draws. None of these three resolved to a bob before this rung (the `house02`
 * skin was unloaded → they fell back to the representative cottage).
 *
 * Laid out as ONE screen row at a constant depth (`x + y = 18`) because two of the bobs are large (coin
 * mint 398×384, brewery 389×344 native): the iso projection is `screenX = (x−y)·32`, `screenY = (x+y)·16`,
 * so a constant `x + y` keeps them on one line and a step of 6 in `x` (with `y` falling to match) spaces
 * them `(2·6)·32 = 384px` apart — comfortably wider than the largest drawn sprite (~279px at
 * `BUILDING_SCALE`). Ordered left→right by ascending `x − y` so the SMALL stock sits left and the LARGE
 * coin mint right.
 */
const BUILDINGS: ReadonlyArray<{ typeId: number; id: string; kind: string; x: number; y: number }> = [
  { typeId: 7, id: 'viking-stock', kind: 'storage', x: 3, y: 15 }, // viking.house02 bob 53, 155×152, screenX −384
  { typeId: 16, id: 'viking-brewery', kind: 'workplace', x: 9, y: 9 }, // viking2.house02 bob 220, 389×344, screenX 0
  { typeId: 33, id: 'viking-coin-mint', kind: 'workplace', x: 15, y: 3 }, // viking2.house02 bob 170, 398×384, screenX 384
];

const WIDTH = 19;
const HEIGHT = 19;

/**
 * A tiny synthetic content set: the three viking building types as passive structures (no workers, no
 * stock) plus the viking tribe with no `jobEnables*` edges, so every type is an ungated start building
 * and places immediately. Carries NO copyrighted data; `parseContentSet` (zod) fails loudly on drift.
 */
function vikingHouse02Content(): ContentSet {
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: 'vinland-acceptance-scene' },
      locale: 'eng',
    },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: BUILDINGS.map((b) => ({ typeId: b.typeId, id: b.id, kind: b.kind })),
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [{ typeId: VIKING, id: 'viking' }],
  });
}

/** An all-grass grid wide enough to space the three houses across one screen row without overlap. */
function vikingHouse02Terrain(): TerrainMap {
  return { width: WIDTH, height: HEIGHT, typeIds: new Array(WIDTH * HEIGHT).fill(GRASS) };
}

/** Place each building via the one mutation seam (`placeBuilding`), exactly like a UI would. */
function build(sim: Simulation): void {
  for (const b of BUILDINGS) {
    sim.enqueue({ kind: 'placeBuilding', buildingType: b.typeId, x: b.x, y: b.y, tribe: VIKING });
  }
}

/** The distinct building typeIds currently placed in the world. */
function placedBuildingTypes(sim: Simulation): Set<number> {
  const types = new Set<number>();
  for (const e of sim.world.query(Building)) types.add(sim.world.get(e, Building).buildingType);
  return types;
}

export const vikingHouse02Scene: SceneDefinition = {
  id: 'viking-house02',
  title: 'Skóra house02 — domyka komplet budynków wikingów',
  summary:
    'Magazyn, browar i mennica — ostatnie typy budynków wikingów, które rysowały wspólną chatę. Każdy rysuje teraz SWÓJ sprite z nowo wczytanych atlasów house02 (ls_houses_viking.house02, ls_houses_viking2.house02). Po tym kroku ŻADEN budynek wikingów nie używa już placeholdera.',
  seed: 17,
  content: vikingHouse02Content(),
  terrain: vikingHouse02Terrain(),
  build,
  runTicks: 5,
  checklist: [
    'Widać TRZY różne budynki, każdy o innym kształcie (wymaga ?atlas=real)',
    'Magazyn (z lewej) jest mały; browar i mennica (w środku/z prawej) są wyraźnie większe',
    'Browar i mennica to dwa odrębne, rozpoznawalne budynki — nie ta sama bryła',
    'ŻADEN budynek nie jest szarym prostokątem ani wspólną chatą (placeholderem)',
    'Budynki nie nachodzą na siebie — każdy w pełni widoczny',
  ],
  checks: [
    {
      label: 'all three distinct building types were placed',
      predicate: (sim) => placedBuildingTypes(sim).size === BUILDINGS.length,
    },
    {
      label: 'the placed types are exactly the three house02-family viking types',
      predicate: (sim) => {
        const placed = placedBuildingTypes(sim);
        return BUILDINGS.every((b) => placed.has(b.typeId));
      },
    },
  ],
};
