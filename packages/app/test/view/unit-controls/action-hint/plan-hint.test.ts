import { ONE, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_IDLE } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import {
  BUILDING_HOME_00,
  sandboxContent,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
} from '../../../../src/game/sandbox/index.js';
import { fixedViewerSeat } from '../../../../src/game/viewer-seat.js';
import {
  type HintAnswers,
  type PlanHint,
  planHint,
} from '../../../../src/view/unit-controls/action-hint/plan-hint.js';
import type { RightClickHit } from '../../../../src/view/unit-controls/right-click/context.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/** The label names what the click's own plan does: its largest order, the trade a post gives, or the
 *  refusal the sim would answer with. */

const CONTENT = sandboxContent();
const buildingType = (slug: string): number => {
  const row = CONTENT.buildings.find((b) => b.id === slug);
  if (row === undefined) throw new Error(`the sandbox has no ${slug}`);
  return row.typeId;
};
/** One smith's post and one carrier's. */
const SMITHY = buildingType('work_smithy_00');
const SMITH_JOB = 1013;
const CARRIER_JOB = 24;
/** Only a gatherer's post, which the right click never fills. */
const GATHERERS_ONLY = buildingType('work_joinery_00');
/** A home for one family. */
const HUT = BUILDING_HOME_00;
const TRADER_JOB = 25;
const SCHOOL = ((): number => {
  const school = CONTENT.buildings.find((row) => systems.isSchoolType(row));
  if (school === undefined) throw new Error('the sandbox has no school');
  return school.typeId;
})();

const BUILDING = 100;
const CART = 200;
const SHIP = 201;
const SECOND_CART = 202;
const STAFF = 300;
const TILE = { col: 6, row: 8 };

const settler = (id: number, jobType: number, extra: Record<string, unknown> = {}): Ent => ({
  id,
  components: {
    Settler: { jobType },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: ONE, y: ONE },
    ...extra,
  },
});

const house = (type: number): Ent => ({
  id: BUILDING,
  components: {
    Building: { buildingType: type, tribe: 1, built: ONE, level: 0 },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: 4 * ONE, y: 4 * ONE },
  },
});

const vehicle = (
  id: number,
  vehicleType: number,
  passengers: unknown[] = [],
  hauler: number | null = null,
): Ent => ({
  id,
  components: {
    Vehicle: { vehicleType, tribe: 1, moored: false, passengers, vehicles: [], carrier: null, hauler },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: 2 * ONE, y: 2 * ONE },
  },
});

const GROUND: RightClickHit = {
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
const ON_BUILDING: Partial<RightClickHit> = { ownBuilding: BUILDING, building: BUILDING };

const UNANSWERED: HintAnswers = {
  tradeHouseAttach: () => undefined,
  vehicleAttach: () => undefined,
  tradeShipPin: () => undefined,
  jobChoice: () => undefined,
  docks: () => false,
};

function hintOf(
  entities: readonly Ent[],
  selected: readonly number[],
  hit: Partial<RightClickHit> = {},
  answers: Partial<HintAnswers> = {},
  landsCrew = false,
): PlanHint | null {
  const snapshot = snapshotOf(entities);
  const settlers = selected
    .filter((ref) => entities.find((e) => e.id === ref)?.components.Settler !== undefined)
    .map((ref) => ({ ref, x: 0, y: 0 }));
  return planHint(
    {
      snapshot,
      content: CONTENT,
      viewer: fixedViewerSeat(HUMAN_PLAYER),
      asks: { tradeHouse: true, equip: true, mooring: true, attach: true, formation: true, pinShip: true },
      answers: { ...UNANSWERED, ...answers },
    },
    {
      hit: { ...GROUND, ...hit },
      doorMarker: null,
      selected: new Set(selected),
      settlers,
      mods: { queued: false, landsCrew },
      workFlag: false,
    },
  );
}

const action = (verb: string, job: number | null = null) => ({ tone: 'action', action: verb, job });

describe('the right-click hint', () => {
  it('names the order most of the selection takes, the settlers first on a tie', () => {
    const walkers = [settler(1, JOB_IDLE), settler(2, JOB_IDLE)];
    const cart = vehicle(CART, VEHICLE_HANDCART);
    expect(hintOf([...walkers, cart], [1, 2, CART])).toMatchObject(action('walk'));
    expect(hintOf([walkers[0] as Ent, cart], [1, CART])).toMatchObject(action('walk'));
    expect(hintOf([cart], [CART])).toMatchObject(action('drive'));
  });

  it('names nothing over an own settler, whom the click selects', () => {
    expect(hintOf([settler(1, JOB_IDLE), settler(2, JOB_IDLE)], [1], { ownSettler: 2 })).toBeNull();
  });

  it('sails a ship, and moors it where the berth preview finds a shore', () => {
    const ship = vehicle(SHIP, VEHICLE_SHIP_SMALL);
    expect(hintOf([ship], [SHIP])).toMatchObject(action('sail'));
    expect(hintOf([ship], [SHIP], {}, { docks: () => true })).toMatchObject(action('moor'));
    expect(hintOf([ship], [SHIP], {}, { docks: () => true }, true)).toMatchObject(action('moorAndLand'));
  });

  it('names the trade a post gives only when every seated worker is known to take the same one', () => {
    const idle = [settler(1, JOB_IDLE), settler(2, JOB_IDLE)];
    const smithy = house(SMITHY);
    const mayChoose = { jobChoice: () => true };
    expect(hintOf([idle[0] as Ent, smithy], [1], ON_BUILDING, mayChoose)).toMatchObject(
      action('work', SMITH_JOB),
    );
    // Unanswered, the trade stays unnamed.
    expect(hintOf([idle[0] as Ent, smithy], [1], ON_BUILDING)).toMatchObject(action('work', null));
    // One smith's post: the second man becomes the carrier.
    expect(hintOf([...idle, smithy], [1, 2], ON_BUILDING, mayChoose)).toMatchObject(action('work', null));
    // A smith keeps his trade.
    expect(hintOf([settler(1, SMITH_JOB), smithy], [1], ON_BUILDING)).toMatchObject(action('work', null));
  });

  it('refuses a full post, a full home and a post or building nobody selected may take', () => {
    const staff = [
      settler(STAFF, SMITH_JOB, { JobAssignment: { workplace: BUILDING } }),
      settler(STAFF + 1, CARRIER_JOB, { JobAssignment: { workplace: BUILDING } }),
    ];
    const noPlace = { tone: 'refusal', refusal: 'noFreePlaces' };
    expect(hintOf([settler(1, JOB_IDLE), ...staff, house(SMITHY)], [1], ON_BUILDING)).toEqual(noPlace);
    const family = settler(STAFF, JOB_IDLE, { Residence: { home: BUILDING } });
    expect(hintOf([settler(1, JOB_IDLE), family, house(HUT)], [1], ON_BUILDING)).toEqual(noPlace);
    expect(hintOf([settler(1, JOB_IDLE), house(HUT)], [1], ON_BUILDING)).toMatchObject(action('live'));
    const cannot = { tone: 'refusal', refusal: 'cannotWorkHere' };
    expect(hintOf([settler(1, JOB_IDLE), house(GATHERERS_ONLY)], [1], ON_BUILDING)).toEqual(cannot);
    // A woman takes no post.
    const woman = settler(1, JOB_IDLE, { Female: { female: true } });
    expect(hintOf([woman, house(SMITHY)], [1], ON_BUILDING)).toEqual(cannot);
  });

  it('refuses a route stop every asked trader was refused, and a vehicle with no seat free', () => {
    const trader = settler(1, TRADER_JOB);
    const onHouse = { building: BUILDING };
    const foreign = { ...house(SMITHY), components: { ...house(SMITHY).components, Owner: { player: 9 } } };
    expect(hintOf([trader, foreign], [1], onHouse)).toMatchObject(action('addToRoute'));
    expect(hintOf([trader, foreign], [1], onHouse, { tradeHouseAttach: () => false })).toEqual({
      tone: 'refusal',
      refusal: 'cannotAddToRoute',
    });
    const rider = settler(2, JOB_IDLE);
    const onCart = { ownVehicle: CART };
    const openCart = vehicle(CART, VEHICLE_HANDCART, [null]);
    expect(hintOf([rider, openCart], [2], onCart)).toMatchObject(action('board'));
    expect(hintOf([rider, openCart], [2], onCart, { vehicleAttach: () => false })).toEqual({
      tone: 'refusal',
      refusal: 'cannotBoard',
    });
    expect(hintOf([rider, vehicle(CART, VEHICLE_HANDCART, [{ entity: STAFF }])], [2], onCart)).toEqual({
      tone: 'refusal',
      refusal: 'noRoom',
    });
  });

  it('reads a pinned ship as full by its ordinary seats, the commander slot being its trader', () => {
    const carrier = settler(2, CARRIER_JOB);
    const onShip = { ownVehicle: SHIP };
    const open = vehicle(SHIP, VEHICLE_SHIP_SMALL, [null, null], STAFF);
    const taken = vehicle(SHIP, VEHICLE_SHIP_SMALL, [{ entity: BUILDING }, null], STAFF);
    expect(hintOf([carrier, open], [2], onShip)).toMatchObject(action('board'));
    expect(hintOf([carrier, taken], [2], onShip)).toEqual({
      tone: 'refusal',
      refusal: 'noRoom',
    });
  });

  it('names the pin of a free ship until the sim refuses it, then what the click does instead', () => {
    const trader = settler(1, TRADER_JOB);
    const ship = vehicle(SHIP, VEHICLE_SHIP_SMALL, [null]);
    const onShip = { ownVehicle: SHIP };
    expect(hintOf([trader, ship], [1], onShip)).toMatchObject(action('pinShip'));
    expect(hintOf([trader, ship], [1], onShip, { tradeShipPin: () => true })).toMatchObject(
      action('pinShip'),
    );
    expect(hintOf([trader, ship], [1], onShip, { tradeShipPin: () => false })).toMatchObject(action('board'));
  });

  it("names the unpin of the trader's own ship, and the walk past one pinned to another", () => {
    const trader = settler(1, TRADER_JOB, { TradeShip: { vehicle: SHIP } });
    const onShip = { ownVehicle: SHIP };
    const pinned = vehicle(SHIP, VEHICLE_SHIP_SMALL, [], 1);
    expect(hintOf([trader, pinned], [1], onShip)).toMatchObject(action('unpinShip'));
    const other = settler(2, TRADER_JOB);
    expect(hintOf([other, pinned], [2], onShip, { tradeShipPin: () => false })).toMatchObject(action('walk'));
  });

  it('leaves carts whose trader takes the house standing, and drives them once every rider was refused', () => {
    const trader: Ent = {
      id: 1,
      components: { Settler: { jobType: TRADER_JOB }, Owner: { player: HUMAN_PLAYER } },
    };
    const foreign = { ...house(SMITHY), components: { ...house(SMITHY).components, Owner: { player: 9 } } };
    const carts = [vehicle(CART, VEHICLE_HANDCART, [{ entity: 1 }]), vehicle(SECOND_CART, VEHICLE_HANDCART)];
    const world = [trader, foreign, ...carts];
    const onHouse = { building: BUILDING };
    expect(hintOf(world, [CART, SECOND_CART], onHouse)).toMatchObject(action('addToRoute'));
    expect(hintOf(world, [CART, SECOND_CART], onHouse, { tradeHouseAttach: () => false })).toMatchObject(
      action('drive'),
    );
  });

  it('offers a school only to those who may learn there', () => {
    expect(hintOf([settler(1, JOB_IDLE), house(SCHOOL)], [1], ON_BUILDING)).toMatchObject(action('learn'));
    const woman = settler(1, JOB_IDLE, { Female: { female: true } });
    expect(hintOf([woman, house(SCHOOL)], [1], ON_BUILDING)).toEqual({
      tone: 'refusal',
      refusal: 'cannotWorkHere',
    });
  });

  it('names an order that goes ahead over a refusal beside it', () => {
    const staff = [
      settler(STAFF, SMITH_JOB, { JobAssignment: { workplace: BUILDING } }),
      settler(STAFF + 1, CARRIER_JOB, { JobAssignment: { workplace: BUILDING } }),
    ];
    const world = [
      settler(1, JOB_IDLE),
      settler(2, JOB_IDLE),
      ...staff,
      house(SMITHY),
      vehicle(CART, VEHICLE_HANDCART),
    ];
    expect(hintOf(world, [1, 2, CART], ON_BUILDING)).toMatchObject(action('drive'));
  });
});
