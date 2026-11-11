import { cellAnchorNode, type Entity, hexDistanceBetween, playerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import { createSceneSim } from '../../../../src/scenes/runtime.js';
import { vehicleDockFleetScene } from '../../../../src/scenes/vehicles/vehicle-dock-fleet.js';
import {
  type BerthShip,
  type MooringRule,
  planBerths,
} from '../../../../src/view/unit-controls/orders/berths.js';

/** A straight shore along row `SHORE_ROW`: land above it, open water below. */
const SHORE_ROW = 10;
const SHIP_SIZE = 2;
const DOOR = 4;
/** The planner's free water between two footprint discs. */
const BERTH_GAP = 4;
const SHORE: MooringRule = {
  key: 'shore',
  moors: (_col, row) => row === SHORE_ROW,
  docks: (_col, row) => row > SHORE_ROW,
  landOf: () => 0,
};

function ship(vehicle: number, col: number, rule: MooringRule = SHORE): BerthShip {
  return { vehicle, at: { col, row: SHORE_ROW + 12 }, logicSize: SHIP_SIZE, doorDistance: DOOR, rule };
}

describe('planBerths', () => {
  it('snaps a lone ship to the shore point nearest the aim on screen, and to nothing past the snap reach', () => {
    const [berth] = planBerths([ship(1, 20)], { col: 20, row: SHORE_ROW + 2 }, 3);
    expect(berth).toMatchObject({ vehicle: 1, col: 20, row: SHORE_ROW });
    // The hull lies straight out from the point, at the door distance.
    expect(berth?.dock).toEqual({ col: 20, row: SHORE_ROW + DOOR });
    expect(planBerths([ship(1, 20)], { col: 20, row: SHORE_ROW + 4 }, 3)).toEqual([]);
  });

  it('spreads a fleet along the shore with the berth gap between hulls, nearest ships nearest', () => {
    const fleet = [ship(1, 5), ship(2, 20), ship(3, 35)];
    const berths = planBerths(fleet, { col: 20, row: SHORE_ROW }, 3);
    expect(berths).toHaveLength(fleet.length);
    for (const a of berths) {
      for (const b of berths) {
        if (a === b) continue;
        expect(hexDistanceBetween(a.dock.col, a.dock.row, b.dock.col, b.dock.row)).toBeGreaterThan(
          2 * SHIP_SIZE + BERTH_GAP,
        );
      }
    }
    const colOf = (vehicle: number) => berths.find((b) => b.vehicle === vehicle)?.col ?? Number.NaN;
    expect(colOf(2)).toBe(20);
    expect(colOf(1)).toBeLessThan(20);
    expect(colOf(3)).toBeGreaterThan(20);
  });

  it('leaves out a ship whose own rule moors nowhere near', () => {
    const nowhere: MooringRule = { key: 'none', moors: () => false, docks: () => false, landOf: () => 0 };
    const berths = planBerths([ship(1, 20), ship(2, 22, nowhere)], { col: 20, row: SHORE_ROW }, 3);
    expect(berths.map((b) => b.vehicle)).toEqual([1]);
  });
});

/** The fleet's crossing into the bay and the turn onto its dock node, with margin. */
const DOCK_TICKS = 600;

function sceneFleet(): { sim: ReturnType<typeof createSceneSim>; ships: BerthShip[] } {
  const sim = createSceneSim(vehicleDockFleetScene);
  sim.run(vehicleDockFleetScene.runTicks);
  const types = sim.content.vehicles;
  const ships: BerthShip[] = sim.vehiclesOf(HUMAN_PLAYER).flatMap((view) => {
    const probe = sim.mooringProbe(view.entity as Entity);
    const type = types.find((t) => t.typeId === view.vehicleType);
    const doorDistance = type?.passengerVector?.distance;
    if (probe === null || view.at === null || type === undefined || doorDistance === undefined) return [];
    const rule: MooringRule = {
      key: probe.key,
      moors: (col, row) => probe.canMoor(col, row),
      docks: (col, row) => probe.canDock(col, row),
      landOf: (col, row) => probe.landOf(col, row),
    };
    return [
      {
        vehicle: view.entity,
        at: { col: view.at.hx, row: view.at.hy },
        logicSize: type.logicSize,
        doorDistance,
        rule,
      },
    ];
  });
  return { sim, ships };
}

it('berths the scene fleet docked at the cape on the mainland, none on the islet across the strait', () => {
  const { ships } = sceneFleet();
  // The cape's tip, the shore nearest the islet.
  const aim = cellAnchorNode(19, 22);
  const berths = planBerths(ships, { col: aim.hx, row: aim.hy }, 3);
  expect(berths).toHaveLength(ships.length);
  const rule = ships[0]?.rule;
  expect(new Set(berths.map(({ col, row }) => rule?.landOf(col, row))).size).toBe(1);
  // The islet's cells, (22, 25) to (25, 29), as half-cell nodes.
  const islet = cellAnchorNode(22, 25);
  expect(berths.filter(({ col, row }) => col >= islet.hx && row >= islet.hy)).toEqual([]);
});

it('moors the scene fleet in the bay on its berths with no two hulls touching', () => {
  const { sim, ships } = sceneFleet();
  // The bay's inner corner, where the shore folds toward the ships.
  const aim = cellAnchorNode(11, 13);
  const berths = planBerths(ships, { col: aim.hx, row: aim.hy }, 3);
  expect(berths).toHaveLength(ships.length);
  for (const { vehicle, dock, col, row } of berths) {
    const ship = vehicle as Entity;
    const at = { x: dock.col, y: dock.row };
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, { kind: 'dockVehicle', vehicle: ship, x: col, y: row, dock: at }),
    );
  }
  // No ship of the fleet is turned away on the way to its berth.
  const refused: string[] = [];
  for (let tick = 0; tick < DOCK_TICKS; tick++) {
    sim.step();
    for (const ev of sim.events.current())
      if (ev.kind === 'vehicleMoveRefused') refused.push(`${ev.entity}:${ev.reason}`);
  }
  expect(refused).toEqual([]);
  const moored = sim.vehiclesOf(HUMAN_PLAYER);
  for (const { vehicle, dock } of berths) {
    const view = moored.find((v) => v.entity === vehicle);
    expect(view?.moored, `${vehicle} moored`).toBe(true);
    expect(view?.at, `${vehicle} on its dock node`).toEqual({ hx: dock.col, hy: dock.row });
  }
  for (const a of moored) {
    for (const b of moored) {
      if (a.entity >= b.entity || a.at === null || b.at === null) continue;
      expect(
        hexDistanceBetween(a.at.hx, a.at.hy, b.at.hx, b.at.hy),
        `${a.entity} and ${b.entity}`,
      ).toBeGreaterThan(2 * SHIP_SIZE);
    }
  }
});
