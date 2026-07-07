import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Simulation, components, fx, systems } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import type { SceneDefinition } from './types.js';

const { MoveGoal, Position, Resource, Settler } = components;

const WOOD = 1;
const STONE = 2;
const CLAY = 3;
const MUSHROOM = 4;
const IDLE_JOB = 0;
const HUT = 2;

const RESOURCE_LOGIC_BASE = 3000;
const RESOURCE_GFX_BASE = 4000;

const WORKER_START = { x: 1, y: 4 };
const WORKER_TARGET = { x: 12, y: 4 };
const BLOCKERS = [
  { goodType: WOOD, atomic: 24, x: 6, y: 3 },
  { goodType: STONE, atomic: 25, x: 6, y: 4 },
  { goodType: WOOD, atomic: 24, x: 6, y: 5 },
];
const NON_BLOCKERS = [
  { goodType: CLAY, atomic: 26, x: 3, y: 4 },
  { goodType: MUSHROOM, atomic: 32, x: 4, y: 4 },
];
const REJECTED_BUILDING_AT = { x: 5, y: 4 };
const ACCEPTED_BUILDING_AT = { x: 10, y: 7 };

const HUT_FOOTPRINT = {
  blocked: [{ dx: 0, dy: 0 }],
  familyBody: [{ dx: 0, dy: 0 }],
  reserved: [{ dx: 0, dy: 0 }],
  door: { dx: 0, dy: 1 },
};

function logicType(goodType: number): number {
  return RESOURCE_LOGIC_BASE + goodType;
}

function gfxIndex(goodType: number): number {
  return RESOURCE_GFX_BASE + goodType;
}

function resourceId(goodType: number): string {
  if (goodType === WOOD) return 'wood';
  if (goodType === STONE) return 'stone';
  if (goodType === CLAY) return 'mud';
  return 'mushroom';
}

function harvestAtomic(goodType: number): number {
  if (goodType === WOOD) return 24;
  if (goodType === STONE) return 25;
  if (goodType === CLAY) return 26;
  return 32;
}

function walkBlockAreas(goodType: number): number[][] {
  if (goodType === CLAY || goodType === MUSHROOM) return [];
  return [[3, 0, 0, 1]];
}

function buildBlockAreas(goodType: number): number[][] {
  if (goodType === CLAY || goodType === MUSHROOM) return [];
  return [
    [3, -1, 0, 1],
    [3, 0, 0, 1],
    [3, 1, 0, 1],
  ];
}

function workAreas(goodType: number): number[][] {
  if (goodType === MUSHROOM) return [[1, 0, 0, 1]];
  if (goodType === CLAY)
    return [
      [3, -1, 0, 1],
      [3, 0, 0, 1],
      [3, 1, 0, 1],
    ];
  return [
    [3, -1, 0, 1],
    [3, 1, 0, 1],
  ];
}

function content(): ContentSet {
  const goods = [WOOD, STONE, CLAY, MUSHROOM];
  return parseContentSet({
    manifest: {
      version: IR_VERSION,
      generatedFrom: { game: 'synthetic-resource-footprints-scene' },
      locale: 'eng',
    },
    goods: [
      { typeId: 0, id: 'none' },
      ...goods.map((goodType) => ({
        typeId: goodType,
        id: resourceId(goodType),
        weight: 1,
        atomics: { harvest: harvestAtomic(goodType) },
        gathering: { bioLandscape: goodType !== STONE && goodType !== CLAY },
      })),
    ],
    jobs: [{ typeId: IDLE_JOB, id: 'idle' }],
    buildings: [
      {
        typeId: HUT,
        id: 'home_level_00',
        kind: 'house',
        footprint: HUT_FOOTPRINT,
      },
    ],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      ...goods.map((goodType) => ({
        typeId: logicType(goodType),
        id: `${resourceId(goodType)}_node`,
        walkable: true,
        buildable: true,
      })),
    ],
    landscapeGfx: goods.map((goodType) => ({
      index: gfxIndex(goodType),
      editName: `footprint ${resourceId(goodType)}`,
      logicType: logicType(goodType),
      maxValency: 3,
      isWorkable: true,
      walkBlockAreas: walkBlockAreas(goodType),
      buildBlockAreas: buildBlockAreas(goodType),
      workAreas: workAreas(goodType),
    })),
    gatheringPipeline: goods.map((goodType) => ({
      goodType,
      goodId: resourceId(goodType),
      harvest: { landscapeType: logicType(goodType), gfxIndices: [gfxIndex(goodType)] },
    })),
    tribes: [{ typeId: VIKING, id: 'viking' }],
  });
}

function placeResource(sim: Simulation, goodType: number, atomic: number, x: number, y: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Resource, { goodType, remaining: 99, harvestAtomic: atomic });
  if (!systems.stampResourceFootprint(sim.world, sim.content, e, goodType)) {
    throw new Error(`resource-footprints: missing footprint for ${resourceId(goodType)}`);
  }
}

function build(sim: Simulation): void {
  for (const r of [...BLOCKERS, ...NON_BLOCKERS]) placeResource(sim, r.goodType, r.atomic, r.x, r.y);

  const worker = sim.world.create();
  sim.world.add(worker, Position, { x: fx.fromInt(WORKER_START.x), y: fx.fromInt(WORKER_START.y) });
  sim.world.add(worker, Settler, {
    tribe: VIKING,
    jobType: IDLE_JOB,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  if (sim.terrain === undefined) throw new Error('resource-footprints scene expects terrain');
  sim.world.add(worker, MoveGoal, { cell: sim.terrain.cellAt(WORKER_TARGET.x, WORKER_TARGET.y) });

  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: HUT,
    x: REJECTED_BUILDING_AT.x,
    y: REJECTED_BUILDING_AT.y,
    tribe: VIKING,
  });
  sim.enqueue({
    kind: 'placeBuilding',
    buildingType: HUT,
    x: ACCEPTED_BUILDING_AT.x,
    y: ACCEPTED_BUILDING_AT.y,
    tribe: VIKING,
  });
}

function ctxOf(sim: Simulation): systems.SystemContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function cellBlocked(sim: Simulation, x: number, y: number): boolean {
  if (sim.terrain === undefined) return false;
  return systems.dynamicBlockedCells(sim.world, ctxOf(sim), sim.terrain).has(sim.terrain.cellAt(x, y));
}

function settlerAtTarget(sim: Simulation): boolean {
  for (const e of sim.world.query(Settler, Position)) {
    const p = sim.world.get(e, Position);
    if (fx.toInt(p.x) === WORKER_TARGET.x && fx.toInt(p.y) === WORKER_TARGET.y) return true;
  }
  return false;
}

function placedBuildingCells(sim: Simulation): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (const e of sim.world.query(components.Building, Position)) {
    const p = sim.world.get(e, Position);
    cells.push({ x: fx.toInt(p.x), y: fx.toInt(p.y) });
  }
  return cells;
}

export const resourceFootprintsScene: SceneDefinition = {
  id: 'resource-footprints',
  title: 'Footprinty surowców: ruch i stawianie przy drzewach/złożach',
  summary:
    'Osadnik idzie z lewej na prawą stronę przez tor testowy. Glina i grzyby na trasie NIE blokują ruchu, ' +
    'ale ściana drzew/kamienia pośrodku już tak — powinien ją obejść. Jedna próba budowy przy kamieniu ' +
    'zostaje odrzucona przez resource build-block ring; drugi domek dalej od zasobów zostaje postawiony.',
  seed: 19,
  content: content(),
  terrain: grassTerrain(14, 9),
  build,
  runTicks: 240,
  initialZoom: 1,
  checklist: [
    'Osadnik przechodzi przez glinę/grzyby na prostej trasie — te niskie zasoby nie blokują chodzenia',
    'Na środku omija pionową przeszkodę z drzew/kamienia — nie przechodzi przez ich anchor tile',
    'Przy kamieniu NIE pojawia się domek z odrzuconej próby budowy; widoczny jest tylko domek dalej od surowców',
    'To jest scena diagnostyczna footprintu: ma być łatwo zobaczyć „co blokuje”, nie pokaz ekonomii',
  ],
  checks: [
    {
      label: 'wood/stone nodes block movement but clay/mushrooms do not',
      predicate: (sim) =>
        BLOCKERS.every((r) => cellBlocked(sim, r.x, r.y)) &&
        NON_BLOCKERS.every((r) => !cellBlocked(sim, r.x, r.y)),
    },
    {
      label: 'the near-resource building was rejected and the far one was accepted',
      predicate: (sim) => {
        const cells = placedBuildingCells(sim);
        return (
          cells.length === 1 &&
          cells[0]?.x === ACCEPTED_BUILDING_AT.x &&
          cells[0]?.y === ACCEPTED_BUILDING_AT.y
        );
      },
    },
    {
      label: 'a building cannot be placed in the stone build-block ring, but clay does not reject it',
      predicate: (sim) => {
        if (sim.terrain === undefined) return false;
        const ctx = ctxOf(sim);
        return (
          !systems.canPlaceBuilding(
            sim.world,
            ctx,
            sim.terrain,
            HUT,
            REJECTED_BUILDING_AT.x,
            REJECTED_BUILDING_AT.y,
          ) &&
          systems.canPlaceBuilding(
            sim.world,
            ctx,
            sim.terrain,
            HUT,
            NON_BLOCKERS[0]?.x ?? 0,
            NON_BLOCKERS[0]?.y ?? 0,
          )
        );
      },
    },
    {
      label: 'the walker reached the far side, proving the route detoured around blockers',
      predicate: settlerAtTarget,
    },
  ],
};
