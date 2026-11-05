import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Building,
  ComputerColony,
  HaulFlag,
  Position,
  Settler,
  Stockpile,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { playerCommand, positionOfNode, type Simulation } from '../../../../../src/index.js';
import {
  farDigPorters,
  porterFlagOrders,
} from '../../../../../src/systems/computer-player/colony/settlement/haulers.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { blankColony, colonyWorld, looseColonyEnv } from '../../../../fixtures/colony-islands.js';
import { CARRIER, COLLECTOR, SEAT, STOCK_TOP_TYPE, VIKING, WOOD } from '../../support.js';

/** The colony's store in the east island's south-west, past the porter's round from every deposit, and the
 *  porters' spawn beside it. */
const STORE_AT = { x: 150, y: 106 };
const PORTER_AT = { x: 156, y: 100 };
/** A dig by the wood nearest the store, where the colony posts its woodcutter, past the porter's round. */
const FAR_DIG = { x: 172, y: 92 };
/** A dig inside the round. */
const NEAR_DIG = { x: 158, y: 100 };
const HEAP_WOOD = 5;
/** Long enough for a porter to walk out to the far dig and back a few times, a decision beat included. */
const HAUL_TICKS = minutesToTicks(6);

interface HeapWorld {
  readonly sim: Simulation;
  readonly store: Entity;
  readonly porters: readonly Entity[];
  readonly gatherer: Entity;
  readonly heap: Entity;
  readonly land: number;
}

/** A built top-tier store on the east island with `porters` posted, a wood gatherer whose flag stands at
 *  `dig` and a heap of wood by `heapAt`; with `running`, the seat's colony there runs. */
function heapWorld(
  porters: number,
  dig: { x: number; y: number },
  running: boolean,
  heapAt: { x: number; y: number } = dig,
): HeapWorld {
  const sim = colonyWorld();
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: STOCK_TOP_TYPE,
    ...STORE_AT,
    tribe: VIKING,
    owner: SEAT,
    force: true,
    underConstruction: false,
  });
  for (let i = 0; i < porters; i++)
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: CARRIER, ...PORTER_AT, tribe: VIKING, owner: SEAT });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: COLLECTOR, ...dig, tribe: VIKING, owner: SEAT });
  sim.step();
  const terrain = sim.terrain;
  const seat = aiControlEntity(sim.world, SEAT);
  if (terrain === undefined || seat === null) throw new Error('setup: no terrain or AI seat');
  const store = [...sim.world.query(Building)].find(
    (e) => sim.world.get(e, Building).buildingType === STOCK_TOP_TYPE,
  );
  if (store === undefined) throw new Error('setup: no store');
  const newest = [...sim.world.query(Settler)].sort((a, b) => a - b).slice(-(porters + 1));
  const gatherer = newest.pop() as Entity;
  for (const porter of newest)
    sim.enqueue(
      playerCommand(SEAT, { kind: 'assignWorker', entity: porter, building: store, jobPriority: [CARRIER] }),
    );
  sim.enqueue(playerCommand(SEAT, { kind: 'setWorkFlag', entity: gatherer, x: dig.x, y: dig.y }));
  sim.enqueue(playerCommand(SEAT, { kind: 'setGatherGood', entity: gatherer, goodType: WOOD }));
  sim.step();
  const heap = sim.world.create();
  sim.world.add(heap, Position, positionOfNode(heapAt.x + 2, heapAt.y));
  sim.world.add(heap, Stockpile, { amounts: new Map([[WOOD, HEAP_WOOD]]) });
  const land = terrain.componentOf(terrain.nodeAt(STORE_AT.x, STORE_AT.y));
  if (running)
    sim.world.add(seat, ComputerColony, { colonies: [blankColony(land)], rejected: [], retryAt: 0 });
  return { sim, store, porters: newest, gatherer, heap, land };
}

const woodIn = (sim: Simulation, e: Entity): number => sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0;

/** The colony's porter orders over `w`, and the porters it wants, read in one decision. */
function decide(w: HeapWorld) {
  const env = looseColonyEnv(w.sim, blankColony(w.land));
  return { orders: porterFlagOrders(env, w.store), wanted: farDigPorters(env, w.store) };
}

describe("a colony's porters", () => {
  it('keep the store’s round, and one more takes in each dig past it', () => {
    const far = heapWorld(2, FAR_DIG, false);
    const [keeper, hauler] = far.porters;
    const { orders, wanted } = decide(far);
    expect(wanted).toBe(1);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ kind: 'setWorkFlag', entity: hauler });
    expect(orders.some((o) => 'entity' in o && o.entity === keeper)).toBe(false);

    const near = heapWorld(2, NEAR_DIG, false);
    expect(decide(near)).toEqual({ orders: [], wanted: 0 });
    // A flag left over from a dig that moved into the round goes.
    near.sim.enqueue(
      playerCommand(SEAT, { kind: 'setWorkFlag', entity: near.porters[1] as Entity, ...FAR_DIG }),
    );
    near.sim.step();
    expect(decide(near).orders).toEqual([{ kind: 'clearHaulFlag', entity: near.porters[1] }]);

    // A heap its dig's flag moved on from is a dig as well.
    const left = heapWorld(2, NEAR_DIG, false, FAR_DIG);
    expect(decide(left)).toMatchObject({
      orders: [{ kind: 'setWorkFlag', entity: left.porters[1] }],
      wanted: 1,
    });
  });

  it('bring a far heap into the store, which the store’s round alone leaves where it lies', () => {
    const idle = heapWorld(2, FAR_DIG, false);
    idle.sim.run(HAUL_TICKS);
    expect(woodIn(idle.sim, idle.store)).toBe(0);
    expect(woodIn(idle.sim, idle.heap)).toBe(HEAP_WOOD);

    const colony = heapWorld(2, FAR_DIG, true);
    colony.sim.run(HAUL_TICKS);
    expect(colony.sim.world.has(colony.porters[1] as Entity, HaulFlag)).toBe(true);
    expect(woodIn(colony.sim, colony.store)).toBeGreaterThan(0);
  });
});
