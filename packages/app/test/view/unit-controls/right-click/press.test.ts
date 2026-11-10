import { MAX_UNIT_ORDER_MEMBERS, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_COLLECTOR, JOB_TRADER } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import {
  sandboxContent,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
} from '../../../../src/game/sandbox/index.js';
import { fixedViewerSeat } from '../../../../src/game/viewer-seat.js';
import type {
  RightClickAsks,
  RightClickContext,
  RightClickHit,
} from '../../../../src/view/unit-controls/right-click/context.js';
import {
  type RightClickInput,
  type RightClickPlan,
  resolveBoardOrOrders,
  resolveRightClick,
  resolveRightClickOrders,
} from '../../../../src/view/unit-controls/right-click/press.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/** One right press resolved whole: the chords, the door marker, the cap, the boarding and the vehicles. */

const CONTENT = sandboxContent();
const COLLECTOR = 1;
const CATAPULT = 10;
const CART = 11;
const SHIP = 12;
const PINNED_SHIP = 13;
const TRADER = 2;
const SECOND_TRADER = 3;
const SAILOR = 5;
const CARRIER = 4;
const TRADERS_SHIP = 14;
const SAILORS_SHIP = 15;
const ENEMY = 20;
const DOOR_SETTLER = 21;
const RESOURCE = 30;
const GOOD = 4;
const TILE = { col: 6, row: 8 };

const vehicle = (id: number, vehicleType: number, hauler: number | null = null): Ent => ({
  id,
  components: {
    Vehicle: { vehicleType, tribe: 1, moored: false, passengers: [], vehicles: [], carrier: null, hauler },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: 2 * ONE, y: 2 * ONE },
  },
});

const trader = (id: number, components: Record<string, unknown> = {}): Ent => ({
  id,
  components: {
    Settler: { jobType: JOB_TRADER },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: ONE, y: ONE },
    ...components,
  },
});

const WORLD = snapshotOf([
  {
    id: COLLECTOR,
    components: {
      Settler: { jobType: JOB_COLLECTOR },
      Owner: { player: HUMAN_PLAYER },
      Position: { x: ONE, y: ONE },
    },
  },
  vehicle(CATAPULT, VEHICLE_CATAPULT),
  vehicle(CART, VEHICLE_HANDCART),
  vehicle(SHIP, VEHICLE_SHIP_SMALL),
  vehicle(PINNED_SHIP, VEHICLE_SHIP_SMALL, COLLECTOR),
  {
    id: CARRIER,
    components: {
      Settler: { jobType: JOB_CARRIER },
      Owner: { player: HUMAN_PLAYER },
      Position: { x: ONE, y: ONE },
    },
  },
  trader(TRADER, { TradeShip: { vehicle: TRADERS_SHIP } }),
  trader(SECOND_TRADER),
  // Commands the ship it rides, with no position of its own.
  {
    id: SAILOR,
    components: {
      Settler: { jobType: JOB_TRADER },
      Owner: { player: HUMAN_PLAYER },
      Rider: { vehicle: SAILORS_SHIP },
    },
  },
  vehicle(TRADERS_SHIP, VEHICLE_SHIP_SMALL, TRADER),
  ((ship: Ent): Ent => ({
    ...ship,
    components: {
      ...ship.components,
      Vehicle: { ...(ship.components.Vehicle as object), passengers: [{ entity: SAILOR }] },
    },
  }))(vehicle(SAILORS_SHIP, VEHICLE_SHIP_SMALL)),
]);

/** The world's settlers: the selected ones take settler orders, the rest are vehicles. */
const SETTLERS: ReadonlySet<number> = new Set([COLLECTOR, TRADER, SECOND_TRADER, CARRIER, SAILOR]);

const NOTHING: RightClickHit = {
  ownSettler: null,
  ownVehicle: null,
  ownBuilding: null,
  site: null,
  building: null,
  enemy: null,
  enemySettler: null,
  wildlife: null,
  claimableLivestock: null,
  creature: null,
  chest: null,
  pile: null,
  resource: null,
  tile: TILE,
};

const ALL_ASKS: RightClickAsks = {
  tradeHouse: true,
  equip: true,
  mooring: true,
  attach: true,
  formation: true,
  pinShip: true,
};

const CONTEXT: RightClickContext = {
  snapshot: WORLD,
  content: CONTENT,
  viewer: fixedViewerSeat(HUMAN_PLAYER),
  asks: ALL_ASKS,
};

function press(
  selected: readonly number[],
  hit: Partial<RightClickHit> = {},
  input: Partial<Omit<RightClickInput, 'hit' | 'selected'>> = {},
): RightClickPlan {
  return resolveRightClick(CONTEXT, {
    hit: { ...NOTHING, ...hit },
    doorMarker: null,
    selected: new Set(selected),
    settlers: selected.filter((ref) => SETTLERS.has(ref)).map((ref) => ({ ref, x: 0, y: 0 })),
    mods: { queued: false, landing: 'none' },
    workFlag: false,
    ...input,
  });
}

/** The board-or-orders plan a refused pin falls back to, for one selected settler. */
function boardOrOrders(hit: RightClickHit, settler: number) {
  return resolveBoardOrOrders(
    CONTEXT,
    {
      hit,
      selected: new Set([settler]),
      settlers: [{ ref: settler, x: 0, y: 0 }],
      mods: { queued: false, landing: 'none' },
    },
    null,
  );
}

describe('a right press', () => {
  it('moves the work flags on the chord, except for ships alone, which dock and land their crew', () => {
    const resource = { ref: RESOURCE, goodType: GOOD };
    expect(press([COLLECTOR], { resource }, { workFlag: true })).toEqual({
      kind: 'workFlag',
      units: [COLLECTOR],
      tile: TILE,
      goodType: GOOD,
    });
    const ships = press([SHIP], {}, { workFlag: true, mods: { queued: false, landing: 'passengers' } });
    expect(ships).toMatchObject({
      kind: 'orders',
      vehicles: {
        kind: 'orders',
        groups: [
          {
            vehicles: [SHIP],
            intent: { kind: 'drive', tile: TILE, landing: 'passengers' },
            pending: 'mooring',
          },
        ],
      },
    });
  });

  it('takes a door marker for the person inside, and refuses a gesture past the order cap whole', () => {
    expect(press([COLLECTOR], {}, { doorMarker: { kind: 'settler', ref: DOOR_SETTLER } })).toEqual({
      kind: 'doorSettler',
      settler: DOOR_SETTLER,
    });
    const crowd = Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => RESOURCE + 1 + i);
    const world = snapshotOf(
      crowd.map((id) => ({
        id,
        components: { Settler: { jobType: null }, Owner: { player: HUMAN_PLAYER } },
      })),
    );
    expect(
      resolveRightClick(
        { ...CONTEXT, snapshot: world },
        {
          hit: NOTHING,
          doorMarker: null,
          selected: new Set(crowd),
          settlers: [],
          mods: { queued: false, landing: 'none' },
          workFlag: false,
        },
      ),
    ).toEqual({ kind: 'orderLimit' });
  });

  it('boards an own vehicle under the cursor unless an enemy stands over it', () => {
    expect(press([COLLECTOR], { ownVehicle: CART })).toEqual({
      kind: 'attach',
      attach: { vehicle: CART, settlers: [COLLECTOR], pending: 'attach' },
      onBuilding: null,
    });
    expect(press([COLLECTOR], { ownVehicle: CART, enemy: ENEMY })).toMatchObject({
      kind: 'orders',
      settlers: { groups: [{ intent: { kind: 'attack', enemy: ENEMY } }] },
    });
  });

  it('walks past a pinned ship, which seats nobody, rather than asking to board it', () => {
    expect(press([COLLECTOR], { ownVehicle: PINNED_SHIP })).toMatchObject({
      kind: 'orders',
      settlers: { groups: [{ intent: { kind: 'walk', tile: TILE } }] },
      riders: { kind: 'none' },
      vehicles: { kind: 'none' },
    });
  });

  it('boards the carriers of a selection on a pinned ship, and only them', () => {
    expect(press([COLLECTOR, CARRIER], { ownVehicle: PINNED_SHIP })).toMatchObject({
      kind: 'attach',
      attach: { vehicle: PINNED_SHIP, settlers: [CARRIER] },
    });
  });

  it('pins a free ship to a lone trader standing on the map', () => {
    expect(press([SECOND_TRADER], { ownVehicle: SHIP })).toEqual({
      kind: 'pinShip',
      pin: { trader: SECOND_TRADER, ship: SHIP, unpins: false },
      onBuilding: null,
    });
  });

  it("lets go of the trader's own pinned ship, and asks about one pinned to another trader", () => {
    expect(press([TRADER], { ownVehicle: TRADERS_SHIP })).toMatchObject({
      kind: 'pinShip',
      pin: { trader: TRADER, ship: TRADERS_SHIP, unpins: true },
    });
    expect(press([SECOND_TRADER], { ownVehicle: TRADERS_SHIP })).toMatchObject({
      kind: 'pinShip',
      pin: { trader: SECOND_TRADER, ship: TRADERS_SHIP, unpins: false },
    });
  });

  it('leaves a trader aboard to drive its ship', () => {
    const hit = { ...NOTHING, ownVehicle: SAILORS_SHIP };
    expect(press([SAILOR], hit)).toMatchObject({ kind: 'attach' });
    const selected = new Set([SAILOR]);
    const settlers = [{ ref: SAILOR, x: 0, y: 0 }];
    const mods = { queued: false, landing: 'none' } as const;
    expect(resolveRightClickOrders(CONTEXT, { hit, selected, settlers, mods }, null)).toMatchObject({
      vehicles: { groups: [{ vehicles: [SAILORS_SHIP], intent: { kind: 'drive' } }] },
    });
  });

  it('boards two selected traders as before, a ship taking one', () => {
    expect(press([TRADER, SECOND_TRADER], { ownVehicle: SHIP })).toMatchObject({
      kind: 'attach',
      attach: { vehicle: SHIP, settlers: [TRADER, SECOND_TRADER] },
    });
  });

  it('skips the pin on a Shift click, since a pin is a standing setting', () => {
    const mods = { queued: true, landing: 'none' } as const;
    expect(press([SECOND_TRADER], { ownVehicle: SHIP }, { mods })).toMatchObject({ kind: 'attach' });
  });

  it('leaves a ship to whoever stands over it, a cart to its boarding, and no pin rule to no pin', () => {
    const onShip = { ownVehicle: SHIP };
    expect(press([SECOND_TRADER], { ...onShip, enemy: ENEMY })).toMatchObject({ kind: 'orders' });
    expect(press([SECOND_TRADER], { ...onShip, ownSettler: COLLECTOR })).toMatchObject({ kind: 'orders' });
    expect(press([SECOND_TRADER], { ownVehicle: CART })).toMatchObject({ kind: 'attach' });
    const plan = resolveRightClick(
      { ...CONTEXT, asks: { ...ALL_ASKS, pinShip: false } },
      {
        hit: { ...NOTHING, ...onShip },
        doorMarker: null,
        selected: new Set([SECOND_TRADER]),
        settlers: [{ ref: SECOND_TRADER, x: 0, y: 0 }],
        mods: { queued: false, landing: 'none' },
        workFlag: false,
      },
    );
    expect(plan).toMatchObject({ kind: 'attach' });
  });

  it('hands a refused pin to the boarding, and past a ship that seats nobody to the walk', () => {
    expect(boardOrOrders({ ...NOTHING, ownVehicle: SHIP }, SECOND_TRADER)).toMatchObject({
      kind: 'attach',
      attach: { vehicle: SHIP },
    });
    expect(boardOrOrders({ ...NOTHING, ownVehicle: TRADERS_SHIP }, SECOND_TRADER)).toMatchObject({
      kind: 'orders',
      settlers: { groups: [{ intent: { kind: 'walk', tile: TILE } }] },
    });
  });

  it('splits a vehicle group: the armed strike, the land vehicles drive, the ships wait on their berths', () => {
    expect(
      press([CATAPULT, CART, SHIP], { enemy: ENEMY }, { mods: { queued: true, landing: 'passengers' } }),
    ).toMatchObject({
      kind: 'orders',
      vehicles: {
        kind: 'orders',
        groups: [
          { vehicles: [CATAPULT], intent: { kind: 'strike', enemy: ENEMY } },
          { vehicles: [CART], intent: { kind: 'driveFormation', tile: TILE } },
          {
            vehicles: [SHIP],
            intent: { kind: 'dock', tile: TILE, landing: 'passengers' },
            pending: 'mooring',
          },
        ],
      },
    });
    // Without the mooring rule the ships drive in the formation with the rest.
    const plan = resolveRightClick(
      { ...CONTEXT, asks: { ...ALL_ASKS, mooring: false } },
      {
        hit: NOTHING,
        doorMarker: null,
        selected: new Set([CART, SHIP]),
        settlers: [],
        mods: { queued: false, landing: 'none' },
        workFlag: false,
      },
    );
    expect(plan).toMatchObject({
      vehicles: { groups: [{ vehicles: [CART, SHIP], intent: { kind: 'driveFormation' } }] },
    });
  });
});
