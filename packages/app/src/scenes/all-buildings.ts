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

// Layout note — the terrain is kept SMALL on purpose. `buildScene` emits a draw item per tile with no
// culling and `renderScene` rebuilds every sprite each frame with no pooling, so tile count = sprites
// churned per frame. The old scenes used 15×15..19×19 (~225..361 tiles); a big field (52×52 ≈ 2704) churns
// thousands of sprites per frame and crashes the tab. This grid stays in the proven-safe range.
/** Buildings per row of the placement grid (41 / 7 → 6 rows, the last part-filled). */
const COLUMNS = 7;
/** World tiles between adjacent columns — ~96 px apart on screen (iso `(x−y)·32`); wide enough to read. */
const COLUMN_STEP = 3;
/** World tiles between adjacent rows — steps each row back so front rows overlap-and-occlude the taller back ones. */
const ROW_STEP = 3;
/** Grid origin (a small grass margin around the buildings). */
const ORIGIN_X = 2;
const ORIGIN_Y = 2;
/** All-grass grid, sized to just contain the lattice (max tile ≈ (20, 17)) — ~440 tiles, safely small. */
const GRID_W = 22;
const GRID_H = 20;
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
