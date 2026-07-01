import { type Simulation, components } from '@vinland/sim';
import { MIN_ZOOM } from '../camera.js';
import {
  VIKING,
  VIKING_BUILDINGS,
  grassTerrain,
  placeVikingBuilding,
  placedBuildingTypes,
  vikingBuildingContent,
} from '../viking-buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **the render-scale stress test** — a huge map with a big building lattice and
 * thousands of settlers, the load the retained {@link import('@vinland/render').WorldRenderer} exists
 * to sustain. The old immediate-mode renderer crashed the tab at ~2700 tiles (one Pixi object churned
 * per tile/entity every frame); this scene is a 256×256 grid (65 536 tiles) with ~2.5k bobs, so the
 * browser half is the human's proof that pooling + culling + batching hold a frame rate — read the FPS
 * overlay (bottom-left), pan across the big map, and zoom out to the floor (a big battle-scale slab, NOT
 * the whole map — that's deliberately capped; terrain + sprites are culled to the framed viewport).
 *
 * The headless half stays a deterministic MECHANIC check (never FPS — an agent can't self-judge
 * performance): it asserts the full building catalog was placed and the settler crowd is the expected
 * size, and the harness re-runs it for byte-identical determinism. The crowd is **idle** (job 0, no
 * work) on purpose — that isolates RENDER throughput from sim AI cost; an animated/walking crowd (which
 * needs the AI to path thousands of units) is a separate slice.
 */

/** The idle job (content `jobs:[{typeId:0}]`) every crowd settler takes — no work, so no sim AI churn. */
const IDLE_JOB = 0;

/** Square side of the stress map, in tiles. 256×256 = 65 536 tiles — ~24× the old crash threshold. */
const MAP = 256;
/** Buildings on a coarse lattice (every 16 tiles from 8), cycling through the whole catalog. */
const BUILDING_STEP = 16;
const BUILDING_ORIGIN = 8;
/** Settlers on a finer lattice (every 5 tiles from 2), skipping building cells — the ~2.5k-bob crowd. */
const SETTLER_STEP = 5;
const SETTLER_ORIGIN = 2;
/** Start at the zoom-out floor ({@link MIN_ZOOM}, referenced so the two can't drift) so the widest
 *  supported view — a big slab of the map + crowd, the battle-scale framing we target — greets the
 *  reviewer; they zoom in from there. */
const INITIAL_ZOOM = MIN_ZOOM;

const { Settler } = components;

/** One placement on the map: its tile + (for a building) which catalog type to draw. */
interface Placement {
  readonly x: number;
  readonly y: number;
}

/** Every building placement, cycling the catalog across a coarse lattice (so all 41 types appear). */
function buildingPlacements(): (Placement & { readonly typeId: number })[] {
  const out: (Placement & { readonly typeId: number })[] = [];
  let i = 0;
  for (let y = BUILDING_ORIGIN; y < MAP; y += BUILDING_STEP) {
    for (let x = BUILDING_ORIGIN; x < MAP; x += BUILDING_STEP) {
      const building = VIKING_BUILDINGS[i % VIKING_BUILDINGS.length];
      if (building !== undefined) out.push({ x, y, typeId: building.typeId });
      i++;
    }
  }
  return out;
}

/** Every settler placement — the fine lattice minus the cells a building already occupies. */
function settlerPlacements(buildingCells: ReadonlySet<number>): Placement[] {
  const out: Placement[] = [];
  for (let y = SETTLER_ORIGIN; y < MAP; y += SETTLER_STEP) {
    for (let x = SETTLER_ORIGIN; x < MAP; x += SETTLER_STEP) {
      if (!buildingCells.has(y * MAP + x)) out.push({ x, y });
    }
  }
  return out;
}

const BUILDINGS = buildingPlacements();
const BUILDING_CELLS = new Set(BUILDINGS.map((b) => b.y * MAP + b.x));
const SETTLERS = settlerPlacements(BUILDING_CELLS);

/** Live settler count — the crowd-size mechanic the headless check asserts (mirrors `placedBuildingTypes`). */
function settlerCount(sim: Simulation): number {
  let n = 0;
  for (const _ of sim.world.query(Settler)) n++;
  return n;
}

function build(sim: Simulation): void {
  for (const b of BUILDINGS) placeVikingBuilding(sim, b.typeId, b.x, b.y);
  for (const s of SETTLERS) {
    sim.enqueue({ kind: 'spawnSettler', jobType: IDLE_JOB, x: s.x, y: s.y, tribe: VIKING });
  }
}

export const stressCrowdScene: SceneDefinition = {
  id: 'stress-crowd',
  title: 'Test wydajności — wielka mapa + tłum',
  summary: `Wielka mapa ${MAP}×${MAP} (${MAP * MAP} kafli) z pełną kratą budynków i ~${SETTLERS.length} postaciami naraz — dowód, że renderer (pooling + culling + batching) utrzymuje płynność tam, gdzie stary crashował. Sprawdź licznik FPS (lewy dolny róg), przewijaj po mapie i oddalaj (do limitu — widok „bitwy”, duży kawał mapy; NIE cała mapa naraz — to celowo ograniczone). Teren i postacie poza kadrem są cullowane. Tłum jest bezczynny celowo (izoluje koszt renderowania od AI symulacji).`,
  seed: 256,
  // Same synthetic content the all-buildings scene uses (every catalog building, an idle job, grass,
  // viking tribe) — the one source of truth stays in viking-buildings.ts.
  content: vikingBuildingContent(VIKING_BUILDINGS),
  terrain: grassTerrain(MAP, MAP),
  build,
  runTicks: 2,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    `Ogromna mapa ${MAP}×${MAP} (${MAP * MAP} kafli) renderuje się bez zawieszki ani crashu`,
    `Przy maksymalnym oddaleniu widać duży kawał mapy z setkami/tysiącami postaci naraz (~${SETTLERS.length} w całej scenie)`,
    'Płynne przewijanie (środkowy przycisk / strzałki) po całej mapie i zoom (kółko) do limitu oddalenia',
    'Przy przybliżeniu drawn ≪ entities (culling tnie niewidoczne postacie), a pooled pozostaje ograniczone',
    // Render skaluje się do wielkości ekranu (culling + chunkowany teren) i sim do liczby jednostek
    // (kandydaci per-tick + dormancy + indeks kaflowy): krok sim ~2 ms/tick @ ~2848, render ~1 ms.
    'FPS (lewy dolny róg) trzyma wysoką wartość mimo tysięcy postaci — koszt nie skacze przy przewijaniu w pusty obszar',
  ],
  checks: [
    {
      label: 'the whole viking building catalog was placed (all 41 types across the lattice)',
      predicate: (sim) => placedBuildingTypes(sim).size === VIKING_BUILDINGS.length,
    },
    {
      label: 'the settler crowd is the expected lattice size',
      predicate: (sim) => settlerCount(sim) === SETTLERS.length,
    },
  ],
};
