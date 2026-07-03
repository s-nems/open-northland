import type { BuildingFootprint } from '@vinland/data';
import type { Simulation } from '@vinland/sim';
import { components } from '@vinland/sim';
import {
  VIKING,
  type VikingBuilding,
  grassTerrain,
  placeVikingBuilding,
  placedBuildingTypes,
  vikingBuildingContent,
} from '../catalog/buildings.js';
import { type MenuBuildingEntry, buildingsInCategory } from '../hud/building-menu.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: the original LEFT **tool panel** — building menu, game-speed button, statistics/help
 * windows — rebuilt from the extracted GUI atlas + fonts at the OpenVikings-pinned geometry (`?scene=tool-panel`).
 *
 * The panel's mechanics are proven at the lowest level in `packages/app/test/tool-panel.test.ts` (the pinned
 * hit-test, the speed cycle, the category filtering) since they are app/render concerns the sim-only scene
 * harness cannot drive. This scene's HEADLESS half proves the one sim-observable seam — that a building
 * chosen in the menu reaches the world through `placeBuilding` — by placing, in `build`, the very buildings
 * a menu selection would (via {@link placeVikingBuilding}, "exactly what a build menu … would call"). Its
 * BROWSER half is the human's sign-off on the pixels (crisp art, palette colours, transparent icons, hover).
 *
 * Content is SYNTHETIC (catalog typeIds so the real house atlases bind, zod-validated — no copyrighted data),
 * spanning every category so all five tabs (Wszystko / Praca / Magazyn / Dom / Wojsko) have entries.
 */

const IDLE_JOB = 0;
const GRID = 32;

/** A spread of catalog buildings across all five menu categories, so every tab lists something. */
const CATALOG_SET: readonly VikingBuilding[] = [
  { typeId: 1, id: 'headquarters', label: 'Headquarters', kind: 'storage' },
  { typeId: 7, id: 'stock_00', label: 'Warehouse (level 0)', kind: 'storage' },
  { typeId: 2, id: 'home_level_00', label: 'Home (level 0)', kind: 'home' },
  { typeId: 12, id: 'work_farm_00', label: 'Grain farm', kind: 'workplace' },
  { typeId: 13, id: 'work_mill_00', label: 'Mill', kind: 'workplace' },
  { typeId: 14, id: 'work_bakery_00', label: 'Bakery (level 0)', kind: 'workplace' },
  { typeId: 38, id: 'school', label: 'School', kind: 'training' },
  { typeId: 39, id: 'barracks', label: 'Barracks', kind: 'training' },
  { typeId: 40, id: 'tower_00', label: 'Watchtower (level 0)', kind: 'tower' },
];

const MENU_ENTRIES: readonly MenuBuildingEntry[] = CATALOG_SET.map((b) => ({
  typeId: b.typeId,
  label: b.label,
  kind: b.kind,
}));

/**
 * A modest square footprint stamped on every building here so `canPlaceBuilding` ENFORCES the original's
 * free-placement collision rule in this scene — otherwise the synthetic content is footprint-less and every
 * placement validates trivially (why placement felt unrestricted). A 3×3 `reserved` build-exclusion zone
 * (anchor ± {@link RESERVE_RADIUS}) keeps buildings ≥1 empty tile apart and off the map edge; the body is the
 * anchor cell and there are no `blocked` walls (nav is unaffected). The REAL game already carries per-type
 * footprints from the extracted `[GfxHouse]` data, so `?live` enforces this without the stand-in.
 */
const RESERVE_RADIUS = 1;
function squareZone(radius: number): { dx: number; dy: number }[] {
  const cells: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) cells.push({ dx, dy });
  }
  return cells;
}
const SPACING_FOOTPRINT: BuildingFootprint = {
  blocked: [],
  familyBody: [{ dx: 0, dy: 0 }],
  reserved: squareZone(RESERVE_RADIUS),
};

/** The building the "menu" places in the headless proof — the first entry the Praca (work) tab would list. */
const MENU_WORK_PICK = buildingsInCategory(MENU_ENTRIES, 'work')[0]?.typeId ?? 12;
/** Settlers to spawn, so the browser view has something moving under the panel to watch. */
const SETTLERS = [
  { x: 20, y: 12 },
  { x: 21, y: 14 },
  { x: 19, y: 15 },
];

function build(sim: Simulation): void {
  // A headquarters + a warehouse to seat the economy, then the SAME `placeBuilding` a menu selection issues
  // (the work-tab's first building) — the sim-observable proof that the menu → world seam works.
  placeVikingBuilding(sim, 1, 8, 10);
  placeVikingBuilding(sim, 7, 8, 15);
  placeVikingBuilding(sim, MENU_WORK_PICK, 14, 12);
  for (const s of SETTLERS) {
    sim.enqueue({ kind: 'spawnSettler', jobType: IDLE_JOB, x: s.x, y: s.y, tribe: VIKING });
  }
}

function population(sim: Simulation): number {
  let n = 0;
  for (const _ of sim.world.query(components.Settler)) n++;
  return n;
}

export const toolPanelScene: SceneDefinition = {
  id: 'tool-panel',
  title: 'Lewy panel narzędzi: menu budowy, prędkość gry, statystyki',
  summary:
    'Oryginalny lewy pasek narzędzi zbudowany z wyekstrahowanego atlasu GUI, czcionek .fnt i geometrii ' +
    'przypiętej do OpenVikings (skala 1×, `?uiscale=2|3` powiększa). Przycisk PRĘDKOŚCI cyklicznie zmienia ' +
    'tempo gry (x1 → x2 → x3 → pauza), przycisk BUDYNKI otwiera menu z kategoriami ' +
    '(Wszystko/Praca/Magazyn/Dom/Wojsko) — klik budynku włącza tryb stawiania, klik na mapie stawia go ' +
    '(placeBuilding, z regułą odstępu: budynku nie postawisz zbyt blisko innego ani przy krawędzi mapy). ' +
    'STATYSTYKI/POMOC otwierają okno z danymi HUD w oryginalnej czcionce. Panel przejmuje kliknięcia nad ' +
    'sobą (nie trafiają w świat). Ten sam panel jest GLOBALNY — pokazuje się też w `?live` i innych scenach.',
  seed: 11,
  content: vikingBuildingContent(CATALOG_SET, () => SPACING_FOOTPRINT),
  terrain: grassTerrain(GRID, GRID),
  build,
  runTicks: 300,
  initialZoom: 1,
  checklist: [
    'Pasek narzędzi po LEWEJ rysuje się oryginalną grafiką, ostro (poprawne kolory palety); nie zajmuje całej wysokości',
    'Panel (pasek + ikony) ma PRZEZROCZYSTE tło — widać teren pod spodem, nie czarne prostokąty zakrywające go',
    'Najechanie na przycisk podświetla go (stan hover)',
    'Przycisk PRĘDKOŚCI zmienia grafikę i tempo: x1 → x2 → x3 → pauza (osadnicy przyspieszają / zatrzymują się)',
    'Przycisk BUDYNKI otwiera okno menu; zakładki po polsku: Wszystko / Praca / Magazyn / Dom / Wojsko',
    'Klik budynku w menu → baner „stawiania"; klik na mapie stawia budynek (pojawia się nowa bryła)',
    'Reguła odstępu działa: tuż obok istniejącego budynku (lub przy krawędzi mapy) klik NIE stawia budynku',
    'STATYSTYKI (lub POMOC) otwiera okno z danymi HUD w oryginalnej czcionce',
    'Kliknięcie NAD panelem/oknem nie zaznacza jednostek ani nie wydaje rozkazu w świecie',
  ],
  checks: [
    {
      label: 'the headquarters + warehouse the panel seats the economy with were placed',
      predicate: (sim) => placedBuildingTypes(sim).has(1) && placedBuildingTypes(sim).has(7),
    },
    {
      label: "the menu's work-tab building reached the world through placeBuilding",
      predicate: (sim) => placedBuildingTypes(sim).has(MENU_WORK_PICK),
    },
    {
      label: 'the settlers the human watches under the panel are alive',
      predicate: (sim) => population(sim) === SETTLERS.length,
    },
  ],
};
