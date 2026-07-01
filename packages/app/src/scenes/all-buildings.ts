import type { Simulation } from '@vinland/sim';
import {
  VIKING_BUILDINGS,
  grassTerrain,
  placeVikingBuilding,
  placedBuildingTypes,
  vikingBuildingContent,
} from '../viking-buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **every viking building on one map** — the single testing scene.
 *
 * Places all 41 catalog buildings ({@link VIKING_BUILDINGS}) side by side on grass, each fully built, so a
 * human can confirm at a glance that every type draws ITS own decoded bob (real graphics are the default
 * now — no `?atlas=real` needed). It is also the live proof that the committed catalog is game-ready: the
 * scene names buildings and calls {@link placeVikingBuilding} exactly as a build menu would, and the
 * renderer resolves each one's graphic purely from its `typeId`. The headless half asserts all 41 distinct
 * types were placed; the pixels (each is its own recognisable structure, none a shared cottage) are the
 * human's to judge.
 */

// Layout note — the buildings sit on a comfortably LARGE grass field now. The retained renderer
// (WorldRenderer: terrain meshed once, sprites pooled + culled) makes tile count cheap, so the old
// "keep the grid tiny or the tab crashes" caveat is gone — a big field just proves the fix (see the
// stress-crowd scene for the extreme). Buildings are spread wide enough to read each one when zoomed in.
/** Buildings per row of the placement grid (41 / 7 → 6 rows, the last part-filled). */
const COLUMNS = 7;
/** World tiles between adjacent columns — wide apart on screen so each building reads on its own. */
const COLUMN_STEP = 6;
/** World tiles between adjacent rows — steps each row back so front rows overlap-and-occlude the taller back ones. */
const ROW_STEP = 6;
/** Grid origin (a grass margin around the buildings, so the field extends beyond them to pan over). */
const ORIGIN_X = 8;
const ORIGIN_Y = 8;
/** A big all-grass field (96×96 = 9216 tiles, ~3.4× the old crash threshold) around the lattice. */
const GRID_W = 96;
const GRID_H = 96;
/** Start zoomed out so all 41 frame at once; the human then pans/zooms (interactive camera) to inspect. */
const INITIAL_ZOOM = 0.5;

/** The map tile for the catalog building at `index` — a compact row-major grid (both axes increasing). */
function tileFor(index: number): { x: number; y: number } {
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  return {
    x: ORIGIN_X + col * COLUMN_STEP,
    y: ORIGIN_Y + row * ROW_STEP,
  };
}

/** Place every catalog building by name (its `id`), fully built — exactly as a build menu would. */
function build(sim: Simulation): void {
  VIKING_BUILDINGS.forEach((b, index) => {
    const { x, y } = tileFor(index);
    placeVikingBuilding(sim, b.id, x, y);
  });
}

export const allBuildingsScene: SceneDefinition = {
  id: 'all-buildings',
  title: 'Wszystkie budynki wikingów',
  summary:
    'Wszystkie 41 budynków wikingów stoi obok siebie na trawie — każdy w pełni zbudowany, rysujący SWÓJ własny bob (prawdziwa grafika jest teraz domyślna). Scena testowa: budynki są kładzione przez ten sam mechanizm co menu budowy, po nazwie z katalogu (viking-buildings.ts).',
  seed: 41,
  content: vikingBuildingContent(VIKING_BUILDINGS),
  terrain: grassTerrain(GRID_W, GRID_H),
  build,
  runTicks: 2,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    'Widać wszystkie 41 budynków wikingów, każdy jako osobna, w pełni zbudowana bryła',
    'Każdy budynek rysuje SWÓJ sprite — ŻADEN nie jest szarym prostokątem ani wspólną chatą (placeholderem)',
    'Domy (5 poziomów), magazyny (3), warsztaty, wieże, szkoła i koszary są rozpoznawalnie różne',
    'Prawdziwa grafika ładuje się BEZ flagi ?atlas=real (jest domyślna)',
    'Można przesuwać (środkowy przycisk / strzałki) i przybliżać (kółko), by obejrzeć pojedynczy budynek',
  ],
  checks: [
    {
      label: 'all catalog building types were placed',
      predicate: (sim) => placedBuildingTypes(sim).size === VIKING_BUILDINGS.length,
    },
    {
      label: 'the placed types are exactly the viking building catalog',
      predicate: (sim) => {
        const placed = placedBuildingTypes(sim);
        return VIKING_BUILDINGS.every((b) => placed.has(b.typeId));
      },
    },
  ],
};
