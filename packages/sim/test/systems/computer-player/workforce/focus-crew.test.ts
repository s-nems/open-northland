import { describe, expect, it } from 'vitest';
import { Settler } from '../../../../src/components/index.js';
import { ownedSettlers } from '../../../../src/systems/ai-shared/seat-roster.js';
import { focusCrewOrders } from '../../../../src/systems/computer-player/workforce/focus-crew.js';
import {
  aiSim,
  BUILDER,
  CIVILIST,
  ctxOf,
  entityOfBuilding,
  HOME_TYPE,
  HQ_X,
  HQ_Y,
  MILL_TYPE,
  placeHq,
  SEAT,
  spawnMen,
  VIKING,
  WOOD,
} from '../support.js';

/** The fixture mill's bill: two wood, so a crew of two. */
const MILL_BILL_UNITS = 2;

/** A store holding the whole bill, and one holding none of it. */
const stocked = (): number => MILL_BILL_UNITS;
const empty = (): number => 0;

function millSeat() {
  const sim = aiSim();
  placeHq(sim);
  // The spawn row runs from the map's left edge, so the mill on the left stands nearest the first men.
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: MILL_TYPE,
    x: 4,
    y: HQ_Y + 8,
    tribe: VIKING,
    owner: SEAT,
    underConstruction: true,
  });
  spawnMen(sim, 4, BUILDER);
  spawnMen(sim, 1);
  sim.step();
  const men = ownedSettlers(sim.world, SEAT);
  return { sim, men, mill: entityOfBuilding(sim, MILL_TYPE) };
}

describe('focusCrewOrders', () => {
  it('pins the builders nearest the focus site, one per unit of its bill, and no other trade', () => {
    const { sim, men, mill } = millSeat();
    const orders = focusCrewOrders(sim.world, ctxOf(sim), SEAT, mill, men, BUILDER, stocked);
    expect(orders).toHaveLength(MILL_BILL_UNITS);
    const pinned = orders.map((c) => (c.kind === 'assignBuilder' ? c.entity : null));
    const builders = men.filter((e) => sim.world.get(e, Settler).jobType === BUILDER);
    expect(pinned).toEqual(builders.slice(0, MILL_BILL_UNITS));
    for (const c of orders) expect(c).toMatchObject({ kind: 'assignBuilder', site: mill });
    const civilian = men.find((e) => sim.world.get(e, Settler).jobType === CIVILIST);
    expect(pinned).not.toContain(civilian);
  });

  it('sends nobody more once the crew is pinned', () => {
    const { sim, men, mill } = millSeat();
    for (const c of focusCrewOrders(sim.world, ctxOf(sim), SEAT, mill, men, BUILDER, stocked))
      sim.enqueueSetup(c);
    sim.step();
    expect(focusCrewOrders(sim.world, ctxOf(sim), SEAT, mill, men, BUILDER, stocked)).toEqual([]);
  });

  it('takes every builder the bill can use, even from another site with its bill delivered', () => {
    const { sim, men, mill } = millSeat();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ_X + 10,
      y: HQ_Y + 8,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    const home = entityOfBuilding(sim, HOME_TYPE);
    sim.enqueueSetup({ kind: 'debugFillStockpile', target: home, goodType: WOOD });
    sim.step();
    const lone = men.filter((e) => sim.world.get(e, Settler).jobType === BUILDER).slice(0, 1);
    expect(focusCrewOrders(sim.world, ctxOf(sim), SEAT, mill, lone, BUILDER, stocked)).toHaveLength(1);
  });

  it('lifts the pins while the site lacks a good the store does not hold', () => {
    const { sim, men, mill } = millSeat();
    const pins = focusCrewOrders(sim.world, ctxOf(sim), SEAT, mill, men, BUILDER, stocked);
    for (const c of pins) sim.enqueueSetup(c);
    sim.step();
    expect(focusCrewOrders(sim.world, ctxOf(sim), SEAT, mill, men, BUILDER, empty)).toEqual(
      pins.map((c) => ({ kind: 'unassignBuilder', entity: c.kind === 'assignBuilder' ? c.entity : null })),
    );
  });
});
