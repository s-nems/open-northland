import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import {
  sandboxContent,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
} from '../../../../src/game/sandbox/index.js';
import { fixedViewerSeat } from '../../../../src/game/viewer-seat.js';
import type { RightClickHit } from '../../../../src/view/unit-controls/right-click/context.js';
import {
  resolveVehicleRightClick,
  type VehicleGroup,
  type VehiclePlan,
} from '../../../../src/view/unit-controls/right-click/vehicles.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/** One selected vehicle's right click: what it strikes, boards or drives to. */

const CATAPULT = 1;
const CART = 2;
const SHIP = 3;
const SHIP_AT_SEA = 4;
const PINNED_SHIP = 7;
const TRADER = 8;
const COMMANDER = 5;
const PASSENGER = 6;
const ENEMY_SOLDIER = 20;
const ENEMY_HOUSE = 21;
const TILE = { col: 6, row: 8 };

const vehicle = (
  id: number,
  vehicleType: number,
  moored = false,
  passengers: readonly number[] = [],
): Ent => ({
  id,
  components: {
    Vehicle: {
      vehicleType,
      tribe: 1,
      moored,
      passengers: passengers.map((entity) => ({ entity, inside: true })),
      vehicles: [],
      carrier: null,
    },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: 2 * ONE, y: 2 * ONE },
  },
});

/** A settler aboard `vehicle`, off the map; the vehicle's last seat is its commander's. */
const aboard = (id: number, vehicleRef: number): Ent => ({
  id,
  components: {
    Settler: { jobType: null },
    Owner: { player: HUMAN_PLAYER },
    Rider: { vehicle: vehicleRef, boarding: false, leaving: null },
  },
});

/** The ship with `Vehicle.hauler` naming the trader it is pinned to. */
const pinned = (ship: Ent, trader: number): Ent => ({
  ...ship,
  components: {
    ...ship.components,
    Vehicle: { ...(ship.components.Vehicle as object), hauler: trader },
  },
});

const WORLD = snapshotOf([
  vehicle(CATAPULT, VEHICLE_CATAPULT, false, [PASSENGER, COMMANDER]),
  vehicle(CART, VEHICLE_HANDCART),
  vehicle(SHIP, VEHICLE_SHIP_SMALL, true),
  vehicle(SHIP_AT_SEA, VEHICLE_SHIP_SMALL),
  pinned(vehicle(PINNED_SHIP, VEHICLE_SHIP_SMALL, true), TRADER),
  aboard(COMMANDER, CATAPULT),
  aboard(PASSENGER, CATAPULT),
]);

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

function resolve(
  selected: number,
  hit: Partial<RightClickHit>,
  { mooring = true, landsCrew = false }: { mooring?: boolean; landsCrew?: boolean } = {},
): VehiclePlan {
  return resolveVehicleRightClick(
    { snapshot: WORLD, content: sandboxContent(), viewer: fixedViewerSeat(HUMAN_PLAYER), asks: { mooring } },
    new Set([selected]),
    { ...NOTHING, ...hit },
    { queued: false, landsCrew },
  );
}

/** The one group a single vehicle's plan holds. */
function groupOf(plan: VehiclePlan): VehicleGroup {
  const group = plan.kind === 'orders' && plan.groups.length === 1 ? plan.groups[0] : undefined;
  if (group === undefined) throw new Error(`not one group: ${plan.kind}`);
  return group;
}

describe("a single vehicle's right click", () => {
  it('strikes an enemy human before boarding, boards before any other enemy, and only when armed', () => {
    const underCursor = { enemySettler: ENEMY_SOLDIER, enemy: ENEMY_SOLDIER, ownVehicle: SHIP };
    expect(groupOf(resolve(CATAPULT, underCursor)).intent).toEqual({ kind: 'strike', enemy: ENEMY_SOLDIER });
    expect(groupOf(resolve(CATAPULT, { enemy: ENEMY_HOUSE, ownVehicle: SHIP })).intent).toEqual({
      kind: 'loadInto',
      carrier: SHIP,
    });
    expect(groupOf(resolve(CATAPULT, { enemy: ENEMY_HOUSE })).intent).toEqual({
      kind: 'strike',
      enemy: ENEMY_HOUSE,
    });
    // An unarmed cart drives through any enemy.
    expect(groupOf(resolve(CART, underCursor)).intent).toEqual({ kind: 'loadInto', carrier: SHIP });
    expect(groupOf(resolve(CART, { enemy: ENEMY_HOUSE })).intent).toMatchObject({ kind: 'drive' });
  });

  it('boards only an own moored ship, never one at sea, and a ship never boards', () => {
    expect(groupOf(resolve(CART, { ownVehicle: SHIP_AT_SEA })).intent).toMatchObject({ kind: 'drive' });
    expect(groupOf(resolve(SHIP_AT_SEA, { ownVehicle: SHIP })).intent).toMatchObject({ kind: 'drive' });
  });

  it('drives past a moored ship pinned to a trader, whose slot the route keeps', () => {
    expect(groupOf(resolve(CART, { ownVehicle: PINNED_SHIP })).intent).toMatchObject({ kind: 'drive' });
  });

  it("waits on a ship's mooring rule and carries the crew landing; a land vehicle drives at once", () => {
    expect(groupOf(resolve(SHIP, {}, { landsCrew: true }))).toEqual({
      vehicles: [SHIP],
      intent: { kind: 'drive', tile: TILE, lands: true },
      pending: 'mooring',
    });
    expect(groupOf(resolve(SHIP, {}, { mooring: false }))).not.toHaveProperty('pending');
    expect(groupOf(resolve(CART, {}))).not.toHaveProperty('pending');
  });

  it('takes its commander aboard for the vehicle, and no other passenger', () => {
    expect(groupOf(resolve(COMMANDER, { enemy: ENEMY_HOUSE }))).toMatchObject({
      vehicles: [CATAPULT],
      intent: { kind: 'strike', enemy: ENEMY_HOUSE },
    });
    expect(resolve(PASSENGER, { enemy: ENEMY_HOUSE })).toEqual({ kind: 'none' });
  });
});
