import { IR_VERSION, parseContentSet } from '@vinland/data';
import { ONE, type Simulation, components, systems } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../viking-buildings.js';
import type { SceneDefinition } from './types.js';

/**
 * Acceptance scene: **free house placement, collision, doors, and staged construction** — the original's
 * building-ground model end-to-end:
 *
 *  - three construction sites start as GREY FOUNDATIONS (`built = 0`) that already occupy their ground;
 *  - idle settlers haul wood from a stocked mill to each site; as materials land, the site's `built`
 *    fraction rises and the render swaps in the successive `[GfxHouse]` construction-stage graphics
 *    until the finished body stands (real graphics are the default);
 *  - the finished home keeps accumulating the NEXT tier's cost and UPGRADES (level 0 → 1 — its bob
 *    grows), the births→housing chain's rozbudowa half;
 *  - every building walk-blocks its body cells from the foundation tick — carriers visibly route
 *    AROUND the walls, and pick up / deposit standing at each building's DOOR cell, never on the body;
 *  - a fourth placement, overlapping the first site's reserved zone, is REJECTED by the free-placement
 *    collision rule (only three sites ever stand).
 *
 * Content is SYNTHETIC (zod-validated, no copyrighted data): catalog typeIds so the real atlases bind
 * per type, with hand-authored footprints/costs that exercise the extracted-data shape.
 */

const NONE_GOOD = 0;
const WOOD = 1;
const IDLE_JOB = 0;

/** Catalog typeIds (the real viking `[GfxHouse]` `LogicType` ids) so real graphics bind per type. */
const HOME_0 = 2;
const HOME_1 = 3;
const MILL = 13;
const BAKERY = 14;
const WELL = 10;

/** Wood units to build / upgrade each demo type (small, so the run finishes in a few hundred ticks). */
const BUILD_COST = 4;

// A compact synthetic footprint shared by the demo types: a 2×2 body, a one-cell margin ring around
// it (the reserved zone), and a door on the west side — outside the walls, inside the zone, exactly
// the extracted `[GfxHouse]` shape (blocked ⊆ familyBody ⊆ reserved, door adjacent to the body).
const BODY_2X2 = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
];
const DEMO_FOOTPRINT = {
  blocked: BODY_2X2,
  familyBody: BODY_2X2,
  reserved: [-1, 0, 1, 2].flatMap((dy) => [-1, 0, 1, 2].map((dx) => ({ dx, dy }))),
  door: { dx: -1, dy: 0 },
};

const GRID = 40;
/** The stocked wood source (a mill pre-filled with wood the carriers draw from). */
const MILL_AT = { x: 8, y: 18 };
/** The three construction sites, spread so their reserved zones stay clear of each other. */
const SITES = [
  { typeId: HOME_0, x: 18, y: 12 },
  { typeId: BAKERY, x: 24, y: 18 },
  { typeId: WELL, x: 18, y: 24 },
];
/** The rejected fourth placement: its body would land inside the home site's reserved ring. */
const REJECTED_AT = { x: 16, y: 12 };
/** Idle settlers (the carriers) spawn east of the mill, so their hauls cross the sites' ground. */
const SETTLERS = [
  { x: 12, y: 16 },
  { x: 12, y: 20 },
  { x: 13, y: 18 },
  { x: 12, y: 18 },
];

function housePlacementContent() {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'vinland-acceptance-scene' }, locale: 'eng' },
    goods: [
      { typeId: NONE_GOOD, id: 'none' },
      { typeId: WOOD, id: 'wood', weight: 1 },
    ],
    jobs: [{ typeId: IDLE_JOB, id: 'idle' }],
    buildings: [
      {
        // The wood source: an unstaffed-by-design "mill" whose stockpile starts FULL of wood declared
        // as its recipe output — the carrier scan hauls a workplace's outputs to any store with room
        // (the construction sites), which is exactly the material-delivery path construction uses.
        typeId: MILL,
        id: 'work_mill_00',
        kind: 'workplace',
        stock: [{ goodType: WOOD, capacity: 60, initial: 60 }],
        produces: [WOOD],
        recipe: { inputs: [], outputs: [{ goodType: WOOD, amount: 1 }], ticks: 20 },
        footprint: DEMO_FOOTPRINT,
      },
      {
        typeId: HOME_0,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: WOOD, amount: BUILD_COST }],
        footprint: DEMO_FOOTPRINT,
      },
      {
        // The next home tier: a finished level-0 home advertises THIS cost and upgrades once it
        // accumulates it (the rozbudowa half) — its bob then grows to the level-1 body.
        typeId: HOME_1,
        id: 'home_level_01',
        kind: 'home',
        homeSize: 2,
        construction: [{ goodType: WOOD, amount: BUILD_COST }],
        footprint: DEMO_FOOTPRINT,
      },
      {
        typeId: BAKERY,
        id: 'work_bakery_00',
        kind: 'workplace',
        construction: [{ goodType: WOOD, amount: BUILD_COST }],
        footprint: DEMO_FOOTPRINT,
      },
      {
        typeId: WELL,
        id: 'work_well_00',
        kind: 'workplace',
        construction: [{ goodType: WOOD, amount: BUILD_COST }],
        footprint: DEMO_FOOTPRINT,
      },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    tribes: [{ typeId: VIKING, id: 'viking' }],
  });
}

function build(sim: Simulation): void {
  sim.enqueue({ kind: 'placeBuilding', buildingType: MILL, x: MILL_AT.x, y: MILL_AT.y, tribe: VIKING });
  for (const site of SITES) {
    sim.enqueue({
      kind: 'placeBuilding',
      buildingType: site.typeId,
      x: site.x,
      y: site.y,
      tribe: VIKING,
      underConstruction: true,
    });
  }
  // The overlap: its 2×2 body (x∈[16..17]) would stand inside the home site's reserved ring
  // (x∈[17..20] × y∈[11..14]) — the free-placement rule must reject it (still logged for replay).
  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: WELL,
    x: REJECTED_AT.x,
    y: REJECTED_AT.y,
    tribe: VIKING,
    underConstruction: true,
  });
  for (const s of SETTLERS) {
    sim.enqueue({ kind: 'spawnSettler', jobType: IDLE_JOB, x: s.x, y: s.y, tribe: VIKING });
  }
}

/** Every placed building entity's live component, in a plain array (checks read it repeatedly). */
function buildings(sim: Simulation): { buildingType: number; built: number; level: number }[] {
  const out: { buildingType: number; built: number; level: number }[] = [];
  for (const e of sim.world.query(components.Building)) out.push(sim.world.get(e, components.Building));
  return out;
}

const RUN_TICKS = 900;

export const housePlacementScene: SceneDefinition = {
  id: 'house-placement',
  title: 'Stawianie domów: kolizje, fundament, fazy budowy, drzwi',
  summary:
    'Trzy place budowy zaczynają jako szare fundamenty (już zajmują teren), osadnicy noszą drewno z młyna, ' +
    'a wraz z dostawami budynek przechodzi kolejne fazy graficzne aż stanie — dom po ukończeniu dodatkowo ' +
    'ROZBUDOWUJE się na poziom 1. Budynki mają kolizję (tragarze je obchodzą) i punkt wejścia: interakcja ' +
    'zawsze przy DRZWIACH. Czwarte stawianie — za blisko pierwszego placu — zostaje odrzucone.',
  seed: 7,
  content: housePlacementContent(),
  terrain: grassTerrain(GRID, GRID),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 1,
  checklist: [
    'Na starcie 3 place budowy pokazują SZARY fundament (nie gotowy budynek, nie placeholder)',
    'W miarę dostaw drewna pojawiają się kolejne fazy budowy (rusztowanie/szkielet), na końcu gotowa bryła',
    'Ukończony dom po chwili ROZBUDOWUJE się — bryła zmienia się na większą (poziom 1)',
    'Tragarze OMIJAJĄ budynki (nie przechodzą przez bryłę) i zatrzymują się przy DRZWIACH (z lewej strony), nie na środku dachu',
    'Stoją tylko 3 budynki + młyn — czwarte stawianie (za blisko domu) zostało odrzucone',
  ],
  checks: [
    {
      label: 'the overlapping fourth placement was rejected (mill + exactly 3 sites stand)',
      predicate: (sim) => buildings(sim).length === 4,
    },
    {
      label: 'every construction site finished (built reached ONE through material delivery)',
      predicate: (sim) => buildings(sim).every((b) => b.built >= ONE),
    },
    {
      label: 'the home upgraded to level 1 after finishing (the next-tier accumulation)',
      predicate: (sim) => buildings(sim).some((b) => b.buildingType === HOME_1 && b.level === 1),
    },
    {
      label: 'building bodies walk-block their cells (the nav overlay is non-empty)',
      predicate: (sim) => {
        const terrain = sim.terrain;
        if (terrain === undefined) return false;
        const ctx = {
          content: sim.content,
          rng: sim.rng,
          tick: sim.tick,
          events: sim.events,
          commands: sim.commands,
          terrain,
        };
        return systems.buildingBlockedCells(sim.world, ctx, terrain).size >= 4 * BODY_2X2.length;
      },
    },
    {
      label: 'no settler ever ended up standing inside a building body',
      predicate: (sim) => {
        const terrain = sim.terrain;
        if (terrain === undefined) return false;
        const ctx = {
          content: sim.content,
          rng: sim.rng,
          tick: sim.tick,
          events: sim.events,
          commands: sim.commands,
          terrain,
        };
        const blocked = systems.buildingBlockedCells(sim.world, ctx, terrain);
        for (const e of sim.world.query(components.Settler, components.Position)) {
          const p = sim.world.get(e, components.Position);
          const cell = terrain.cellAtClamped(Math.round(p.x / ONE), Math.round(p.y / ONE));
          if (blocked.has(cell)) return false;
        }
        return true;
      },
    },
  ],
};
