import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, type TerrainMap, components } from '@vinland/sim';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **each building type draws its own house bob** (Render breadth ladder, rung 1).
 *
 * Five viking buildings — a home, a well, a hive, a farm and a bakery — stand side by side on grass.
 * Under `?atlas=real` each draws ITS own decoded `ls_houses_viking.bmd` house (the `[GfxHouse]`
 * `LogicType` → `GfxBobId` join, `real-sprites.ts` `VIKING_HOUSE01_BOBS`), NOT one shared cottage reused
 * for every type — so the small well/hive and the large home/bakery read as distinct structures at their
 * real relative sizes. No new sim mechanic: this proves the render-side per-type frame selection, which a
 * human must eyeball (an agent can't self-judge pixels); the headless half only asserts the five distinct
 * building types were placed.
 */

const GRASS = 0;
const VIKING = 1;

const { Building } = components;

/**
 * The viking building types this scene showcases — the `typeId`s are the real `[GfxHouse]` `LogicType`
 * values the render keys its per-type bob lookup on (`VIKING_HOUSE01_BOBS`), so the synthetic content's
 * ids match what `?atlas=real` draws. Ordered front-to-back (small houses nearest the camera) over the
 * placement cells below so the large homes/bakeries behind aren't occluded by the small wells in front.
 */
const BUILDINGS: ReadonlyArray<{ typeId: number; id: string; kind: string; x: number; y: number }> = [
  { typeId: 10, id: 'viking-well', kind: 'storage', x: 1, y: 9 }, // small (63×88)
  { typeId: 11, id: 'viking-hive', kind: 'workplace', x: 3, y: 7 }, // small (64×89)
  { typeId: 12, id: 'viking-farm', kind: 'workplace', x: 5, y: 5 }, // medium (129×150)
  { typeId: 6, id: 'viking-home', kind: 'home', x: 7, y: 3 }, // large (299×340)
  { typeId: 15, id: 'viking-bakery', kind: 'workplace', x: 9, y: 1 }, // large (315×234)
];

const WIDTH = 11;
const HEIGHT = 11;

/**
 * A tiny synthetic content set: the five viking building types as passive structures (no workers, no
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

/** An all-grass grid wide enough to space the five houses along a screen-horizontal line. */
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
    'Pięć różnych budynków wikingów (dom, studnia, ul, farma, piekarnia) stoi obok siebie — każdy rysuje SWÓJ własny sprite domu, nie jeden wspólny.',
  seed: 11,
  content: buildingTypesContent(),
  terrain: buildingTypesTerrain(),
  build,
  runTicks: 5,
  checklist: [
    'Widać PIĘĆ różnych budynków, każdy o innym kształcie (wymaga ?atlas=real)',
    'Studnia i ul są małe; dom i piekarnia wyraźnie większe — proporcje się różnią',
    'ŻADEN budynek nie jest szarym prostokątem (placeholderem)',
    'Domy nie nachodzą na siebie tak, by któregoś nie dało się rozpoznać',
  ],
  checks: [
    {
      label: 'all five distinct building types were placed',
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
