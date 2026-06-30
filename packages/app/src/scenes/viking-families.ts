import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, type TerrainMap, components } from '@vinland/sim';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **every viking building family draws from its own decoded atlas** (Render breadth
 * ladder, rung 1 — "load the rest of the viking families").
 *
 * Where `building-types` showcases the default `ls_houses_viking.house01` layer (plus the HQ from the
 * viking4 family), this scene proves the **four newly-loaded families** each route their types to the
 * right atlas — a building per family, all distinct `.bmd`×palette skins:
 *  - **mill** (typeId 13) → `ls_houses_viking.bmd` recoloured `housemiller01`,
 *  - **smithy** (typeId 31) → `ls_houses_viking2.bmd` `house01`,
 *  - **armory** (typeId 27) → `ls_houses_viking3.bmd` `house01`,
 *  - **temple** (typeId 37) → `ls_houses_viking4.bmd` recoloured `housedruid01`.
 *
 * Under `?atlas=real` each draws ITS own house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join,
 * `real-sprites.ts` `buildingBobRefsByType` over the `BUILDING_FAMILIES` list) — four recognisably
 * different structures, none the shared cottage. No new sim mechanic: this proves the render-side
 * multi-family load, which a human must eyeball (an agent can't self-judge pixels); the headless half
 * only asserts the four distinct building types were placed.
 */

const GRASS = 0;
const VIKING = 1;

const { Building } = components;

/**
 * One viking building per newly-loaded atlas family — the `typeId`s are the real `[GfxHouse]` `LogicType`
 * values the render keys its per-type bob lookup on (`buildingBobRefsByType`), so the synthetic content's
 * ids match what `?atlas=real` draws from each family atlas. None of these four resolved to a bob before
 * this rung (their families were unloaded → they fell back to the representative cottage).
 *
 * Laid out as ONE screen row at a constant depth (`x + y = 16`) because the native house bobs are large
 * (the temple is 344×317): the iso projection is `screenX = (x−y)·32`, `screenY = (x+y)·16`, so a constant
 * `x + y` keeps them on one line and a step of 5 in `x` (with `y` falling to match) spaces them
 * `(2·5)·32 = 320px` apart — comfortably wider than the largest drawn sprite (~241px at `BUILDING_SCALE`).
 * Ordered left→right by ascending `x − y` so the SMALL mill sits left and the LARGE temple right.
 */
const BUILDINGS: ReadonlyArray<{ typeId: number; id: string; kind: string; x: number; y: number }> = [
  { typeId: 13, id: 'viking-mill', kind: 'workplace', x: 1, y: 15 }, // housemiller01, 152×231, screenX −448
  { typeId: 31, id: 'viking-smithy', kind: 'workplace', x: 6, y: 10 }, // viking2/house01, 294×203, screenX −128
  { typeId: 27, id: 'viking-armory', kind: 'workplace', x: 11, y: 5 }, // viking3/house01, 292×276, screenX 192
  { typeId: 37, id: 'viking-temple', kind: 'training', x: 16, y: 0 }, // housedruid01, 344×317, screenX 512
];

const WIDTH = 17;
const HEIGHT = 17;

/**
 * A tiny synthetic content set: the four viking building types as passive structures (no workers, no
 * stock) plus the viking tribe with no `jobEnables*` edges, so every type is an ungated start building
 * and places immediately. Carries NO copyrighted data; `parseContentSet` (zod) fails loudly on drift.
 */
function vikingFamiliesContent(): ContentSet {
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

/** An all-grass grid wide enough to space the four houses across one screen row without overlap. */
function vikingFamiliesTerrain(): TerrainMap {
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

export const vikingFamiliesScene: SceneDefinition = {
  id: 'viking-families',
  title: 'Rodziny budynków (każda ze swojego atlasu)',
  summary:
    'Cztery budynki wikingów — młyn, kuźnia, zbrojownia i świątynia — stoją w rzędzie. Każdy rysuje SWÓJ sprite z innego zdekodowanego atlasu (ls_houses_viking.housemiller01, viking2, viking3, viking4.housedruid01), nie wspólnej chaty.',
  seed: 13,
  content: vikingFamiliesContent(),
  terrain: vikingFamiliesTerrain(),
  build,
  runTicks: 5,
  checklist: [
    'Widać CZTERY różne budynki, każdy o innym kształcie (wymaga ?atlas=real)',
    'Młyn (z lewej) jest wąski i wysoki; świątynia (z prawej) jest największa — kształty się różnią',
    'Kuźnia i zbrojownia (w środku) to dwa odrębne, rozpoznawalne budynki',
    'ŻADEN budynek nie jest szarym prostokątem (placeholderem)',
    'Budynki nie nachodzą na siebie — każdy w pełni widoczny',
  ],
  checks: [
    {
      label: 'all four distinct building types were placed',
      predicate: (sim) => placedBuildingTypes(sim).size === BUILDINGS.length,
    },
    {
      label: 'the placed types are exactly the four newly-loaded-family viking types',
      predicate: (sim) => {
        const placed = placedBuildingTypes(sim);
        return BUILDINGS.every((b) => placed.has(b.typeId));
      },
    },
  ],
};
