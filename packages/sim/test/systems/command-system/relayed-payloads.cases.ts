import { HomeQualityEffect } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Owner, Palisade, RoadSite, Settler, Vehicle } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  COMMAND_ENVELOPE_VERSION,
  CORE_INVARIANTS,
  type CommandEnvelope,
  checkInvariants,
  type PlayerCommand,
  parseCommandEnvelope,
  Simulation,
} from '../../../src/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/stances.js';
import { testContent } from '../../fixtures/content.js';
import { grassCellMap } from '../../fixtures/terrain.js';
import {
  CARPENTER,
  GATE_ROW,
  HEADQUARTERS,
  SAWMILL,
  VIKING,
  WALL_ROW,
  WALL_ROWS,
  WOOD,
  WOODCUTTER,
} from './support.js';

const SEAT = 0;
const RIVAL = 1;
// Job, vehicle and good ids of the fixture content beyond the ones `support.ts` names.
const SCOUT = 27;
const SOLDIER = 31;
const CARRIER = 36;
const CART = 1;
const SHIP = 3;
const CATAPULT = 5;
const SHOES = 8;
const MEAD = 13;
const SWORD = 9;

/**
 * Integers the payload parser admits but no honest client sends: the relay forwards any safe integer, so
 * each one must end in a refusal or a clamp, never in a throw that stops the tick for every client.
 */
const HOSTILE_INTEGERS = [-1, 2 ** 31, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
const TICKS_PER_PAYLOAD = 2;

/** The seat's assets every template aims at, so a payload passes the authority gate and reaches its handler. */
interface Targets {
  readonly worker: Entity;
  readonly scout: Entity;
  readonly soldier: Entity;
  readonly carrier: Entity;
  readonly rival: Entity;
  readonly hq: Entity;
  readonly sawmill: Entity;
  readonly cart: Entity;
  readonly ship: Entity;
  readonly catapult: Entity;
  readonly wall: Entity;
  readonly roadSite: Entity;
}

function seatWorld(): { sim: Simulation; targets: Targets } {
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: { ...grassCellMap(16, 16), landscapes: { types: WALL_ROWS, placements: [] } },
  });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HEADQUARTERS,
    x: 10,
    y: 10,
    tribe: VIKING,
    owner: SEAT,
  });
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: SAWMILL,
    x: 20,
    y: 10,
    tribe: VIKING,
    owner: SEAT,
  });
  for (const jobType of [WOODCUTTER, SCOUT, SOLDIER, CARRIER]) {
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x: 6, y: 20, tribe: VIKING, owner: SEAT });
  }
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: SOLDIER, x: 8, y: 22, tribe: VIKING, owner: RIVAL });
  for (const vehicleType of [CART, SHIP, CATAPULT]) {
    sim.enqueueSetup({ kind: 'createVehicle', vehicleType, x: 14, y: 24, tribe: VIKING, owner: SEAT });
  }
  for (const x of [8, 9, 10, 11, 12]) {
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL_ROW,
      x,
      y: 2,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: false,
    });
  }
  sim.enqueueSetup({ kind: 'placeRoadSite', x: 4, y: 4, tribe: VIKING, owner: SEAT });
  sim.step();
  const w = sim.world;
  const all = w.canonicalEntities();
  const nth = (list: readonly Entity[], i: number): Entity => {
    const e = list[i];
    if (e === undefined) throw new Error(`seat world lacks entity ${i} of ${list.length}`);
    return e;
  };
  const settlersOf = (player: number) =>
    all.filter((e) => w.has(e, Settler) && w.tryGet(e, Owner)?.player === player);
  const mine = settlersOf(SEAT);
  const buildings = all.filter((e) => w.has(e, Building));
  const vehicles = all.filter((e) => w.has(e, Vehicle));
  return {
    sim,
    targets: {
      worker: nth(mine, 0),
      scout: nth(mine, 1),
      soldier: nth(mine, 2),
      carrier: nth(mine, 3),
      rival: nth(settlersOf(RIVAL), 0),
      hq: nth(buildings, 0),
      sawmill: nth(buildings, 1),
      cart: nth(vehicles, 0),
      ship: nth(vehicles, 1),
      catapult: nth(vehicles, 2),
      wall: nth(
        all.filter((e) => w.has(e, Palisade)),
        2,
      ),
      roadSite: nth(
        all.filter((e) => w.has(e, RoadSite)),
        0,
      ),
    },
  };
}

type Payload = Readonly<Record<string, unknown>>;

/** One or more well-formed payloads per seat command, keyed so a new seat command cannot be left out. */
function seatPayloads(t: Targets): { readonly [K in PlayerCommand['kind']]: readonly Payload[] } {
  const node = { x: 5, y: 5 };
  return {
    learn: [
      { entity: t.worker, house: t.hq, target: 'job', typeId: CARPENTER },
      { entity: t.worker, house: t.hq, target: 'good', typeId: WOOD },
    ],
    payTribute: [{ player: SEAT, slot: 0 }],
    declareDiplomacy: [{ player: SEAT, other: RIVAL, state: 'enemy' }],
    attachTradeHouse: [{ entity: t.carrier, house: t.hq }],
    detachTradeHouse: [{ entity: t.carrier, house: t.hq }],
    setTradeImport: [{ entity: t.carrier, house: t.hq, good: WOOD, on: true }],
    setTradeImportLimits: [{ entity: t.carrier, house: t.hq, good: WOOD, upTo: 5, keep: 1 }],
    clearTradeImports: [{ entity: t.carrier }],
    setTradeAgreement: [{ entity: t.carrier, agreement: 0 }],
    cancelTraining: [{ entity: t.worker }],
    exploreArea: [{ entity: t.scout, ...node }],
    orderNeed: [{ entity: t.worker, need: 'hunger' }],
    setRegeneration: [{ entity: t.soldier, enabled: false }],
    unassignBuilder: [{ entity: t.worker }],
    assignBuilder: [{ entity: t.worker, site: t.hq }],
    assignHouse: [{ entity: t.worker, house: t.hq }],
    assignHouseGroup: [{ members: [{ entity: t.worker }], house: t.hq }],
    assignWorker: [{ entity: t.worker, building: t.sawmill, jobPriority: [CARPENTER] }],
    assignWorkerGroup: [{ building: t.sawmill, members: [{ entity: t.worker, jobPriority: [CARPENTER] }] }],
    attachToVehicle: [{ entity: t.soldier, vehicle: t.catapult }],
    attackMoveUnit: [
      { entity: t.soldier, ...node },
      { entity: t.soldier, ...node, queued: true },
    ],
    boardVehicle: [{ entity: t.soldier }],
    detachFromVehicle: [{ entity: t.soldier }],
    attackUnit: [{ entity: t.soldier, target: t.rival }],
    attackWithVehicle: [
      { vehicle: t.catapult, target: { kind: 'ground', hx: 4, hy: 4 } },
      { vehicle: t.catapult, target: { kind: 'entity', entity: t.rival } },
    ],
    cancelUpgrade: [{ building: t.hq }],
    demolish: [{ building: t.sawmill }],
    demolishPalisade: [{ palisade: t.wall }],
    demolishSignpost: [{ signpost: t.hq }],
    equipGood: [
      { entity: t.worker, group: 'boots', slot: 0, goodType: SHOES },
      { entity: t.worker, group: 'misc', slot: 0, goodType: MEAD },
    ],
    leaveCarrier: [{ vehicle: t.cart }],
    loadIntoVehicle: [{ vehicle: t.cart, carrier: t.ship }],
    makeChild: [{ entity: t.worker, child: 'male' }],
    marry: [{ entity: t.worker }],
    moveUnit: [
      { entity: t.worker, ...node },
      { entity: t.worker, ...node, queued: true },
    ],
    moveVehicle: [{ vehicle: t.cart, ...node }],
    dockVehicle: [{ vehicle: t.ship, ...node }],
    renameSettler: [{ entity: t.worker, name: 'Ragna' }],
    openChest: [
      { entity: t.worker, chest: t.hq },
      { entity: t.worker, chest: t.hq, queued: true },
    ],
    placeBuilding: [
      { buildingType: SAWMILL, ...node, tribe: VIKING },
      { buildingType: SAWMILL, ...node, tribe: VIKING, paper: { kind: 'placeAny', param: 0 } },
    ],
    placePalisade: [{ gfxIndex: WALL_ROW, ...node, tribe: VIKING }],
    convertPalisadeGate: [{ palisade: t.wall, gfxIndex: GATE_ROW }],
    placeRoadSite: [{ ...node, tribe: VIKING }],
    cancelRoadSite: [{ roadSite: t.roadSite }],
    placeSignpost: [
      { entity: t.scout, ...node },
      { entity: t.scout, ...node, queued: true },
    ],
    setAssistantCounter: [{ player: SEAT, counter: 'extraMen', value: 3, infinite: false }],
    setAssistantGrant: [{ player: SEAT, goodType: SHOES, enabled: true }],
    setAssistantPostGraduates: [{ player: SEAT, enabled: true }],
    setAssistantMoveFlags: [{ player: SEAT, enabled: true }],
    setAssistantWeaponVeto: [{ player: SEAT, goodType: SWORD, vetoed: true }],
    setProductionGoods: [{ entity: t.worker, goods: [WOOD] }],
    setProductionCount: [{ entity: t.worker, goodType: WOOD, count: 3 }],
    setDefenceMode: [{ building: t.hq, enabled: true }],
    setGatherGood: [{ entity: t.worker, goodType: WOOD }],
    setHouseholdGoodUse: [{ player: SEAT, effect: HomeQualityEffect.options[0], allowed: true }],
    setJob: [{ entity: t.worker, jobType: CARPENTER }],
    setPalisadeGateMode: [{ palisade: t.wall, mode: 'automatic' }],
    setPalisadeGate: [{ palisade: t.wall, open: true }],
    setStance: [{ entity: t.soldier, mode: MILITARY_MODE.ATTACK }],
    setVehicleStance: [{ vehicle: t.catapult, stance: 'hold' }],
    setWorkFlag: [{ entity: t.worker, ...node }],
    clearHaulFlag: [{ entity: t.worker }],
    stopVehicle: [{ vehicle: t.cart }],
    setVehicleWanted: [{ vehicle: t.cart, goodType: WOOD, amount: 3 }],
    clearVehicleWanted: [{ vehicle: t.cart }],
    trainSoldier: [{ entity: t.worker, house: t.hq }],
    unassignHouse: [{ entity: t.worker }],
    unloadPeople: [{ vehicle: t.ship }],
    unassignWorker: [{ entity: t.worker }],
    unequipGood: [{ entity: t.worker, group: 'boots', slot: 0 }],
    upgradeBuilding: [{ building: t.hq }],
  };
}

type Path = readonly (string | number)[];

function integerPaths(value: unknown, path: Path = []): Path[] {
  if (typeof value === 'number') return [path];
  if (Array.isArray(value)) return value.flatMap((member: unknown, i) => integerPaths(member, [...path, i]));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, member]) => integerPaths(member, [...path, key]));
  }
  return [];
}

function withValueAt(payload: Payload, path: Path, value: number): Payload {
  const copy = structuredClone(payload) as Record<string | number, unknown>;
  let at = copy;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>;
  const last = path.at(-1);
  if (last !== undefined) at[last] = value;
  return copy;
}

function seatEnvelope(kind: string, payload: Payload): CommandEnvelope {
  return parseCommandEnvelope({
    v: COMMAND_ENVELOPE_VERSION,
    origin: 'player',
    player: SEAT,
    command: { kind, ...payload },
  });
}

describe('CommandSystem - relayed seat payloads', () => {
  it('refuses or clamps every hostile integer a peer can send without stopping the tick', () => {
    let world = seatWorld();
    const failures: string[] = [];
    for (const [kind, payloads] of Object.entries(seatPayloads(world.targets))) {
      for (const payload of payloads) {
        // A well-formed payload must parse, or every hostile variant below would be skipped unseen.
        seatEnvelope(kind, payload);
        for (const path of integerPaths(payload)) {
          for (const value of HOSTILE_INTEGERS) {
            const label = `${kind} ${path.join('.')}=${value}`;
            // The relay client parses each remote envelope first; what it refuses never reaches the sim.
            let envelope: CommandEnvelope;
            try {
              envelope = seatEnvelope(kind, withValueAt(payload, path, value));
            } catch {
              continue;
            }
            try {
              world.sim.enqueue(envelope);
              world.sim.run(TICKS_PER_PAYLOAD);
            } catch (error) {
              failures.push(`${label}: ${String(error)}`);
              world = seatWorld();
              continue;
            }
            const broken = checkInvariants(world.sim.world, world.sim.content, CORE_INVARIANTS);
            if (broken.length > 0) failures.push(`${label}: ${broken.join('; ')}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
