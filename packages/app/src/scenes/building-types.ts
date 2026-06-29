import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, type TerrainMap, components } from '@vinland/sim';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **each building type draws its own house bob** (Render breadth ladder, rung 1).
 *
 * Six viking buildings — a well, a hive, a farm, a home, a bakery and the **headquarters** — stand side
 * by side on grass. Under `?atlas=real` each draws ITS own decoded house bob (the `[GfxHouse]`
 * `LogicType` → `GfxBobId` join, `real-sprites.ts` `buildingBobRefsByType`), NOT one shared cottage reused
 * for every type — so the small well/hive and the large home/bakery read as distinct structures at their
 * real relative sizes. The HQ proves the **multi-`.bmd`** path: its canonical bob lives in a *different*
 * atlas (`ls_houses_viking4.bmd` bob 34) than the others' `ls_houses_viking.house01`, so it draws from a
 * named `SpriteSheet.families` layer. No new sim mechanic: this proves the render-side per-type frame
 * selection, which a human must eyeball (an agent can't self-judge pixels); the headless half only asserts
 * the six distinct building types were placed.
 */

const GRASS = 0;
const VIKING = 1;

const { Building } = components;

/**
 * The viking building types this scene showcases — the `typeId`s are the real `[GfxHouse]` `LogicType`
 * values the render keys its per-type bob lookup on (`buildingBobRefsByType`), so the synthetic content's
 * ids match what `?atlas=real` draws. The HQ (typeId 1) draws from the viking4 family atlas; the rest
 * from the default `ls_houses_viking.house01` layer.
 *
 * Laid out in **two screen rows** because the native house bobs are large (the HQ alone is ~430px wide at
 * native size): the iso projection is `screenX = (x−y)·32`, `screenY = (x+y)·16`, and the camera scale
 * magnifies sprites AND spacing together, so the only way to stop the big sprites overlapping is more
 * WORLD spacing. The three LARGE buildings (home / bakery / HQ) sit in a widely-spaced BACK row
 * (`x + y = 10`, ~256px apart on screen); the three SMALLER buildings (well / hive, plus the medium farm)
 * sit in a FRONT row (`x + y = 18`, nearer the camera and well below the big ones) each in front of a big
 * one — and the SHORTEST (the well) is paired under the tallest big (the HQ) so a front sprite never hides
 * a big one's body.
 */
const BUILDINGS: ReadonlyArray<{ typeId: number; id: string; kind: string; x: number; y: number }> = [
  // BACK row — the large buildings, widely spaced so home / bakery / HQ read as distinct structures.
  { typeId: 6, id: 'viking-home', kind: 'home', x: 1, y: 9 }, // large (299×340), screenX 224
  { typeId: 15, id: 'viking-bakery', kind: 'workplace', x: 5, y: 5 }, // large (315×234), screenX 480
  { typeId: 1, id: 'viking-hq', kind: 'storage', x: 9, y: 1 }, // HQ — viking4 bob 34 (433×380), screenX 736
  // FRONT row — the small buildings, nearer the camera, one in front of each big (shortest under the HQ).
  { typeId: 11, id: 'viking-hive', kind: 'workplace', x: 5, y: 13 }, // small (64×89), under home, screenX 224
  { typeId: 12, id: 'viking-farm', kind: 'workplace', x: 9, y: 9 }, // medium (129×150), under bakery, screenX 480
  { typeId: 10, id: 'viking-well', kind: 'storage', x: 13, y: 5 }, // small (63×88), under HQ, screenX 736
];

const WIDTH = 15;
const HEIGHT = 15;

/**
 * A tiny synthetic content set: the six viking building types as passive structures (no workers, no
 * stock) plus the viking tribe with no `jobEnables*` edges, so every type is an ungated start building
 * and places immediately. Carries NO copyrighted data; `parseContentSet` (zod) fails loudly on drift.
 */
function buildingTypesContent(): ContentSet {
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

/** An all-grass grid wide enough to space the six houses across the two screen rows without overlap. */
function buildingTypesTerrain(): TerrainMap {
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

export const buildingTypesScene: SceneDefinition = {
  id: 'building-types',
  title: 'Typy budynków (każdy swój bob)',
  summary:
    'Sześć różnych budynków wikingów (studnia, ul, farma, dom, piekarnia, kwatera główna) stoi obok siebie — każdy rysuje SWÓJ własny sprite domu, nie jeden wspólny. Kwatera główna pochodzi z innego atlasu (ls_houses_viking4.bmd).',
  seed: 11,
  content: buildingTypesContent(),
  terrain: buildingTypesTerrain(),
  build,
  runTicks: 5,
  checklist: [
    'Widać SZEŚĆ różnych budynków, każdy o innym kształcie (wymaga ?atlas=real)',
    'Studnia i ul są małe; dom i piekarnia wyraźnie większe — proporcje się różnią',
    'Kwatera główna (z prawej, w głębi) to OKAZAŁY budynek, wyraźnie inny niż zwykły dom',
    'ŻADEN budynek nie jest szarym prostokątem (placeholderem)',
    'Domy nie nachodzą na siebie tak, by któregoś nie dało się rozpoznać',
  ],
  checks: [
    {
      label: 'all six distinct building types were placed',
      predicate: (sim) => placedBuildingTypes(sim).size === BUILDINGS.length,
    },
    {
      label: 'the placed types are exactly the showcased viking types',
      predicate: (sim) => {
        const placed = placedBuildingTypes(sim);
        return BUILDINGS.every((b) => placed.has(b.typeId));
      },
    },
  ],
};
