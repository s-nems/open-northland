import { type Simulation, components } from '@vinland/sim';
import { VIKING_BUILDINGS, grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { placeSandboxBuilding } from '../game/sandbox/index.js';
import { countComponent } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The BUILDING-GEOMETRY gallery: every viking building placed on one flat grid, the review surface
 * for the per-building logic geometry. Open it with **`?scene=building-geometry&debug=geometry`** —
 * the debug overlay then draws each building's extracted footprint over its art: walk-block cells
 * (red), build-exclusion zone (amber), the door node (green), the worker-icon anchor (blue dot) and
 * the anchor node (white cross), so a human can spot any building whose collision or door does not
 * match its graphic. With real `content/` the footprints are the extracted `LogicWalkBlockArea` /
 * `LogicBuildBlockArea` / `LogicDoorPoint` data; without it the clean-room approximations show.
 *
 * The headless half proves the mechanic only (every catalog building places and stands); judging
 * whether the geometry matches the pixels is exactly the human's job here.
 */

/**
 * The gallery roster: every catalog building EXCEPT `work_pottery_02` (typeId 22, the "Defence wall"
 * slot) — the culturesnation mod carries no real building there (its bob binding draws a stray house
 * graphic), so per the user's review it is ignored entirely; the mod is the source of truth.
 */
const GALLERY_BUILDINGS = VIKING_BUILDINGS.filter((b) => b.id !== 'work_pottery_02');

/** Grid pitch in TILES — wide enough that the largest reserved zone (~4 cells half-width) never
 *  overlaps a neighbour's, so each building's overlay reads on its own. */
const GRID_STEP = 8;
const GRID_COLUMNS = 7;
const GRID_ORIGIN = { x: 5, y: 5 };

const GRID_ROWS = Math.ceil(GALLERY_BUILDINGS.length / GRID_COLUMNS);
const MAP_W = GRID_ORIGIN.x * 2 + (GRID_COLUMNS - 1) * GRID_STEP + GRID_STEP;
const MAP_H = GRID_ORIGIN.y * 2 + (GRID_ROWS - 1) * GRID_STEP + GRID_STEP;

/** Zoomed out enough to frame several rows at once; pan for the rest. */
const INITIAL_ZOOM = 0.5;
/** Placement commands resolve on the first steps; nothing else runs — a short run suffices. */
const RUN_TICKS = 10;

function buildingTile(index: number): { x: number; y: number } {
  return {
    x: GRID_ORIGIN.x + (index % GRID_COLUMNS) * GRID_STEP,
    y: GRID_ORIGIN.y + Math.floor(index / GRID_COLUMNS) * GRID_STEP,
  };
}

function build(sim: Simulation): void {
  GALLERY_BUILDINGS.forEach((building, index) => {
    const { x, y } = buildingTile(index);
    placeSandboxBuilding(sim, building.typeId, x, y, HUMAN_PLAYER);
  });
}

export const buildingGeometryScene: SceneDefinition = {
  id: 'building-geometry',
  title: 'Building geometry gallery',
  summary:
    'Every viking building on one grid — add &debug=geometry to overlay each footprint (collision, build zone, door, worker-icon anchor) over its art.',
  seed: 1,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    'Dodaj &debug=geometry do adresu — na każdym budynku pojawia się nakładka geometrii.',
    'ZIELONY romb (drzwi) leży na grafice drzwi budynku — tam gdzie osadnik ma wchodzić.',
    'NIEBIESKA kropka (kotwica ikon pracowników) leży tuż na prawo od drzwi.',
    'CZERWONE romby (kolizja) pokrywają podstawę grafiki — nic nie wystaje daleko poza budynek i żaden kawałek budynku nie stoi poza nimi; wysoka wieża blokuje tylko fundament.',
    'ŻÓŁTY obrys (strefa zakazu budowy) otacza kolizję z zapasem na przejście.',
    'Kliknięcie w grafikę budynku zaznacza go; kliknięcie TUŻ OBOK (w przezroczysty róg) — nie.',
  ],
  checks: [
    {
      label: 'every gallery viking building stands placed on the grid',
      predicate: (sim) => countComponent(sim, components.Building) === GALLERY_BUILDINGS.length,
    },
  ],
};
