import type { Entity, Simulation } from '@open-northland/sim';
import { components, ONE } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HOME_00,
  dropSandboxGood,
  JOB_BUILDER,
  placeSandboxBuilding,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The BUILDER-CONSTRUCTION scene: prove the original's "place a foundation, builders raise it" flow.
 *
 * Each home is placed as a grey FOUNDATION (`underConstruction`) — it already collides, but stands at 0%
 * with a near-0 Health pool. Beside each foundation sits its build material (its `construction` cost —
 * wood + stone), and a pair of BUILDERS (jobtype 7) do the rest with no per-scene code: a builder walks to
 * the foundation, and when it has no material to install fetches a needed good from the pile itself and
 * carries it over ("budowniczy sam zanosi surowce"), then hammers the building up a swing at a time. With
 * two builders on a site the work parallelises — one hauls the next material while the other hammers. The
 * building's sprite grows from the foundation as its `built` rises, and its Health ramps 0→max alongside —
 * finishing only when both the builder work AND every material are in.
 *
 * The sites sit in well-separated clusters (each with its own material + builders) so the demo reads
 * clearly and the builders don't pile onto one shared yard. The headless half asserts the mechanic: after
 * the run no foundation remains under construction and every home stands fully built at full Health. The
 * browser half is where a human judges the pixels — the foundations visibly rising, builders swinging and
 * hauling, the two builders on a site sharing the work.
 */

const MAP_W = 48;
const MAP_H = 24;
const INITIAL_ZOOM = 0.7;
/** Long enough for the builders to haul every material and hammer all the homes up (headless gate only —
 *  the browser view runs continuously, so a human watches the whole build regardless). */
const RUN_TICKS = 3000;

const SITE_ROW_Y = 7;
const SITE_XS = [8, 24, 40] as const; // three foundations in well-separated clusters
const YARD_ROW_Y = 12; // each site's own material pile row, a few tiles below it
const BUILDER_ROW_Y = 16; // the two builders assigned to each site start below its material
const BUFFER = 1; // a spare unit per material so a site never just-barely starves

/** The home type's build-material cost — the goods a builder must deliver + hammer in (read from content
 *  so the scene stays data-driven). */
function homeConstructionCost(sim: Simulation): ReadonlyArray<{ goodType: number; amount: number }> {
  return sim.content.buildings.find((b) => b.typeId === BUILDING_HOME_00)?.construction ?? [];
}

function build(sim: Simulation): void {
  const cost = homeConstructionCost(sim);
  for (const siteX of SITE_XS) {
    // A grey foundation, placed under construction (already colliding, standing at 0%).
    placeSandboxBuilding(sim, BUILDING_HOME_00, siteX, SITE_ROW_Y, HUMAN_PLAYER, { underConstruction: true });
    // Its OWN material beside it — one pile per cost good, enough for this site (plus a spare). A builder
    // fetches from here and carries it up; the site caps intake at its cost, so a spare simply rests.
    cost.forEach((line, i) => {
      dropSandboxGood(sim, line.goodType, siteX + i, YARD_ROW_Y, line.amount + BUFFER);
    });
    // Two builders per site — enough to parallelise haul + hammer, placed a tile apart so they don't stack.
    spawnSandboxSettler(sim, JOB_BUILDER, siteX - 1, BUILDER_ROW_Y, HUMAN_PLAYER);
    spawnSandboxSettler(sim, JOB_BUILDER, siteX + 1, BUILDER_ROW_Y, HUMAN_PLAYER);
  }
}

const { Building, Health, UnderConstruction } = components;

/** The scene home type's full HP, read from content for the checks (undefined if it carries no pool). */
function homeMaxHp(sim: Simulation): number | undefined {
  return sim.content.buildings.find((b) => b.typeId === BUILDING_HOME_00)?.hitpoints;
}

/** Every placed home of the scene's residence type. */
function homes(sim: Simulation): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_HOME_00) out.push(e);
  }
  return out;
}

export const constructionScene: SceneDefinition = {
  id: 'construction',
  title: 'Budowa budynkow',
  summary:
    'Stawiasz fundamenty (szare obrysy), a budowniczowie sami znoszą surowce i walą młotkami, powoli ' +
    'wznosząc budynki do góry — % budowy i życie rosną, aż budynek jest gotowy.',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    'Na starcie budynki to szare FUNDAMENTY (0%), które już blokują ruch — nie postawiony budynek, tylko jego obrys.',
    'Budowniczowie chodzą do fundamentów; gdy brakuje surowca, sami idą po niego do składu i przynoszą go na budowę.',
    'Budowniczy wali młotkiem — grafika budynku ROŚNIE do góry, a % budowy i pasek życia rosną razem z pracą.',
    'Kilku budowniczych pracuje równolegle: jeden nosi surowiec, inny w tym czasie buduje (optymalizacja).',
    'Dwaj budowniczowie przy tym samym placu stoją w RÓŻNYCH miejscach obok fundamentu — nie nakładają się ' +
      'w jednym punkcie (krótkie mijanki przy odkładaniu surowca są OK).',
    'Gdy praca i wszystkie surowce są gotowe, budynek kończy się (100%, pełne życie) i przestaje przyciągać materiał.',
  ],
  checks: [
    {
      label: 'every foundation has been raised — none remains under construction',
      predicate: (sim) => {
        let sites = 0;
        for (const _e of sim.world.query(UnderConstruction)) sites++;
        return sites === 0;
      },
    },
    {
      label: 'every home stands fully built at full Health',
      predicate: (sim) => {
        const maxHp = homeMaxHp(sim);
        if (maxHp === undefined) return false;
        const built = homes(sim);
        if (built.length !== SITE_XS.length) return false;
        return built.every((e) => {
          const b = sim.world.get(e, Building);
          const h = sim.world.tryGet(e, Health);
          return b.built >= ONE && h !== undefined && h.hitpoints === maxHp;
        });
      },
    },
  ],
};
