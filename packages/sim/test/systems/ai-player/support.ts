import { type ContentSet, parseContentSet } from '@open-northland/data';
import {
  type AiModuleEnables,
  AiPlayer,
  aiModuleEnables,
  Building,
  Livestock,
  Owner,
  Position,
  Resource,
  UnderConstruction,
} from '../../../src/components/index.js';
import { CommandQueue } from '../../../src/core/command-queue.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  EventBuffer,
  type Fixed,
  nodeOfPosition,
  positionOfNode,
  Rng,
  Simulation,
} from '../../../src/index.js';
import { DEFAULT_BUILD_ORDER, workforceModule } from '../../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { createSignpost, stampResourceFootprintData } from '../../../src/systems/index.js';
import { WEAPON_MAIN_TYPE } from '../../../src/systems/readviews/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { settlerAt } from '../../fixtures/settler.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

/**
 * The shared world builder for the strategic-AI suites: the synthetic content sets, the fixture ids,
 * and the "place an HQ, spawn men, drop resources" helpers every case file assembles a hand-built
 * world from. A case runs a module against that world and inspects the command list it returns.
 */

export const VIKING = 1;
export const SEAT = 2;
export const CIVILIST = 6;
export const BUILDER = 7;
export const COLLECTOR = 8;
export const JOINER = 16;
export const FARMER = 18;
export const BAKER = 20;
export const CARRIER = 24;
export const SCOUT = 27;
export const WOMAN = 5;
export const HQ_TYPE = 1;
export const HOME_TYPE = 2;
export const HOME_TOP_TYPE = 4;
export const FARM_TYPE = 5;
export const WELL_TYPE = 6;
export const MILL_TYPE = 7;
export const BAKERY_TYPE = 8;
export const BAKERY_TOP_TYPE = 9;
export const BREWERY_TYPE = 10;
export const JOINERY_TYPE = 11;
export const BARRACKS_TYPE = 12;
export const STOCK_TYPE = 13;
export const STOCK_TOP_TYPE = 14;
export const TOWER_TYPE = 15;
export const WALL_TYPE = 16;
/** An animal tribe id no fixture civilization uses - the round-up's claimable creatures. */
const COW_TRIBE = 13;
/** The animal farm and its trade - added by {@link husbandryContent} on free fixture slots. */
export const ANIMAL_FARM_TYPE = 17;
export const BREEDER = 22;
/** The armed civilian trade the opening hunt posts at the HQ ({@link huntingContent}). */
export const HUNTER = 15;
export const LEATHER = 8;
export const WOOL = 9;
const MEAT = 10;
/** The joinery's iron-tool product (fixture) - the craft restriction's one selected good. */
export const TOOL_IRON = 7;
/** The stone-collector XP track (fixture = real track id 5) iron's `needforgood` measures. */
export const STONE_XP_TRACK = 5;
/** Raw XP clearing iron's `needforgood` gate: 10 repeats × the stone track's factor 100. */
export const IRON_GATE_XP = 1000;
export const WOOD = 1;
export const MUD = 2;
export const STONE = 4;
export const IRON = 5;
export const WOOD_HARVEST = 24;
export const STONE_HARVEST = 25;
const IRON_HARVEST = 26;
const MUD_HARVEST = 32;
/** The fixture's barren-but-buildable landscape id (grass is 0). */
export const SAND = 2;

export const HQ_X = 30;
export const HQ_Y = 16;

/** The default workforce allocator - collector gating follows the default opening list. */
export const collectModule = workforceModule(DEFAULT_BUILD_ORDER);

/** Fixture resource spots, apart from each other and the HQ so flags and placements never collide.
 *  Iron stands on every map too: the workforce must NOT hire for it until the list reaches the
 *  gated `collector` entry. */
export const RESOURCE_SPOTS = {
  mud: { x: 8, y: 8, good: MUD, harvest: MUD_HARVEST },
  stone: { x: 48, y: 8, good: STONE, harvest: STONE_HARVEST },
  wood: { x: 48, y: 24, good: WOOD, harvest: WOOD_HARVEST },
  iron: { x: 10, y: 26, good: IRON, harvest: IRON_HARVEST },
} as const;

export function aiSim(seed = 1): Simulation {
  const sim = new Simulation({ seed, content: aiContent(), map: grassNodeMap(64, 32) });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  return sim;
}

export function ctxOf(sim: Simulation, tick = 0): SystemContext {
  return {
    content: aiContent(),
    rng: new Rng(1),
    tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

export function placeHq(sim: Simulation, x = HQ_X, y = HQ_Y): void {
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, x, y, tribe: VIKING, owner: SEAT });
}

export function spawnMen(sim: Simulation, count: number, jobType = CIVILIST): void {
  // Rows of 28 keep every spawn inside the 64-wide fixture map, whatever the count.
  for (let i = 0; i < count; i++) {
    const x = 4 + 2 * (i % 28);
    const y = 4 + 2 * Math.floor(i / 28);
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner: SEAT });
  }
}

export function placeResources(
  sim: Simulation,
  spots: readonly { x: number; y: number; good: number; harvest: number }[] = Object.values(RESOURCE_SPOTS),
  remaining = 5,
): void {
  for (const spot of spots) {
    sim.enqueueSetup({
      kind: 'placeResource',
      good: spot.good,
      x: spot.x,
      y: spot.y,
      remaining,
      harvestAtomic: spot.harvest,
    });
  }
}

export function entityOfBuilding(sim: Simulation, buildingType: number): Entity {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === buildingType) return e;
  }
  throw new Error(`setup: building ${buildingType} missing`);
}

/** Force-finish every open construction site; an upgrade site adopts its tier. */
export function completeSites(sim: Simulation): void {
  for (const e of [...sim.world.query(UnderConstruction)]) {
    sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: e });
  }
  sim.step();
}

/** Flag `player`'s seat AI-driven - the state `setPlayerAi` lands, which the garrison hire reads. */
export function makeAiSeat(sim: Simulation, player: number, modules?: Partial<AiModuleEnables>): void {
  sim.world.add(sim.world.create(), AiPlayer, { player, modules: aiModuleEnables(modules) });
}

/** Stand the seat's post at a node-centred `position` (see `positionOfNode`), linked as the erect would. */
export function plantPost(sim: Simulation, position: { x: Fixed; y: Fixed }): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('plantPost needs a mapped sim');
  const n = nodeOfPosition(position.x, position.y);
  createSignpost(sim.world, terrain, terrain.nodeAt(n.hx, n.hy), SEAT);
}

/** The fixture HQ is footprint-less; the door tests need one shaped like the extracted `[GfxHouse]`
 *  records - a walled body with the door outside it, on the west side. */
export const HQ_DOOR = { dx: -1, dy: 0 };
const HQ_FOOTPRINT = {
  blocked: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  familyBody: [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
  ],
  reserved: [-1, 0, 1].flatMap((dy) => [-1, 0, 1, 2].map((dx) => ({ dx, dy }))),
  door: HQ_DOOR,
};

export function doorHqContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    buildings: base.buildings.map((b) => (b.typeId === HQ_TYPE ? { ...b, footprint: HQ_FOOTPRINT } : b)),
  });
}

export function plantPostAtHq(sim: Simulation): void {
  plantPost(sim, sim.world.get(entityOfBuilding(sim, HQ_TYPE), Position));
}

/** Content whose headquarters offers the hunter slot the opening hunt is posted on - the base
 *  fixture's HQ carries transport and collector slots only, so the plan finds no seat there. The
 *  trade must be spelled `hunter`: the job role is read off the id slug. */
export function huntingContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: HUNTER, id: 'hunter' }],
    buildings: base.buildings.map((b) =>
      b.typeId === HQ_TYPE ? { ...b, workers: [...b.workers, { jobType: HUNTER, count: 3 }] } : b,
    ),
  });
}

/** Content with the two-breeder animal farm the herd split needs. Its recipes carry only the three
 *  products the restriction names - the real feed → token → hide chain is the livestock suite's
 *  concern, not the allocator's. */
export function husbandryContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: LEATHER, id: 'leather', weight: 1 },
      { typeId: WOOL, id: 'wool', weight: 1 },
      { typeId: MEAT, id: 'meat', weight: 1 },
    ],
    jobs: [...base.jobs, { typeId: BREEDER, id: 'breeder' }],
    buildings: [
      ...base.buildings,
      {
        typeId: ANIMAL_FARM_TYPE,
        id: 'work_animal_farm',
        kind: 'workplace' as const,
        workers: [
          { jobType: BREEDER, count: 2 },
          { jobType: CARRIER, count: 1 },
        ],
        recipes: [
          { inputs: [], outputs: [{ goodType: MEAT, amount: 1 }], ticks: 180 },
          {
            inputs: [{ goodType: WOOD, amount: 1 }],
            outputs: [{ goodType: LEATHER, amount: 1 }],
            ticks: 180,
          },
          { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [{ goodType: WOOL, amount: 1 }], ticks: 180 },
        ],
        construction: [{ goodType: WOOD, amount: 2 }],
        stock: [
          { goodType: WOOD, capacity: 5, initial: 5 },
          { goodType: LEATHER, capacity: 5, initial: 0 },
          { goodType: WOOL, capacity: 5, initial: 0 },
          { goodType: MEAT, capacity: 5, initial: 0 },
        ],
      },
    ],
  });
}

/** The armed soldier classes {@link armedContent} binds, and the goods that arm them (real bands).
 *  The base fixture's weapon rows carry no `goodtype`, so only these three classes can be equipped -
 *  and only while the seat has the good in store (`workforce/garrison.ts`). */
export const SWORDSMAN = 34;
export const SPEARMAN = 32;
export const BOWMAN = 40;
export const SWORD = 41;
export const SPEAR = 39;
export const BOW = 37;

/** Content whose short sword, wooden spear and short bow are craftable goods a recruit can be armed
 *  with: the base fixture binds the spear and bow classes already, but weaponless (no `goodtype`), so
 *  no seat can field any of the three on it. */
export function armedContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: SWORD, id: 'sword_short', weight: 1 },
      { typeId: SPEAR, id: 'spear_wooden', weight: 1 },
      { typeId: BOW, id: 'bow_short', weight: 1 },
    ],
    jobs: [...base.jobs, { typeId: SWORDSMAN, id: 'soldier_sword_short' }],
    weapons: [
      ...base.weapons.map((w) => {
        if (w.jobType === BOWMAN) return { ...w, mainType: WEAPON_MAIN_TYPE.BOW, goodType: BOW };
        return w.jobType === SPEARMAN ? { ...w, goodType: SPEAR } : w;
      }),
      {
        typeId: 7,
        id: 'viking_sword_short',
        tribeType: VIKING,
        jobType: SWORDSMAN,
        mainType: WEAPON_MAIN_TYPE.SWORD,
        goodType: SWORD,
        minRange: 1,
        maxRange: 1,
      },
    ],
  });
}

/** A livestock creature standing on node (x, y), owned by `player` when given - the shape
 *  `spawnHerd` lands: a `Settler` of an animal tribe with no trade, marked {@link Livestock}. */
export function placeAnimal(sim: Simulation, x: number, y: number, player?: number): Entity {
  const animal = settlerAt(sim, { jobType: null, tribe: COW_TRIBE, position: positionOfNode(x, y) });
  sim.world.add(animal, Livestock, {});
  if (player !== undefined) sim.world.add(animal, Owner, { player });
  return animal;
}

/** A standing wall Resource whose footprint walk-blocks exactly `cells` - anchored on remote open
 *  ground so the anchor's own node (which a Resource blocks for placement) seals nothing nearby. */
export function wallOver(sim: Simulation, cells: readonly { x: number; y: number }[]): void {
  const anchor = { x: 2, y: 2 };
  const wall = sim.world.create();
  sim.world.add(wall, Position, positionOfNode(anchor.x, anchor.y));
  sim.world.add(wall, Resource, { goodType: WOOD, remaining: 1, harvestAtomic: WOOD_HARVEST });
  stampResourceFootprintData(sim.world, wall, {
    walk: cells.map((c) => ({ dx: c.x - anchor.x, dy: c.y - anchor.y })),
    build: [],
    work: [],
  });
}
