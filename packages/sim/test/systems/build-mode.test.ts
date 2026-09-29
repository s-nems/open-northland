import { describe, expect, it } from 'vitest';
import {
  BuildMode,
  Palisade,
  RoadSite,
  SiteAssignment,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { playerCommand, type Simulation, WALK_RANGE_NODES } from '../../src/index.js';
import { claimSite } from '../../src/systems/economy/site-claim.js';
import {
  BUILD_TICKS,
  builderAt,
  HUMAN,
  houseSiteAt,
  orderRoads,
  RIVAL,
  ROW,
  roadAt,
  roadSim,
  STORE_HX,
  siteAt,
  storeAt,
  VIKING,
  WALL,
} from './road-support.js';

const HOUSE_HX = 12;
const BUILDER_HX = 8;
const ROAD_HXS = [20, 26, 32] as const;
const RIVAL_HX = 38;
const OTHER_TRIBE = VIKING + 1;
const OTHER_TRIBE_HXS = [14, 15, 16, 17, 18] as const;
/** The run's first site, then the one it must pick next past the other tribe's line. */
const FIRST_OWN_HX = 11;
const OWN_HX = 22;
/** Budget for a run over three sites and the house after it. */
const RUN_TICKS = 4 * BUILD_TICKS;
/** A map wide enough for a road site past the builder's signpost walk range. */
const WIDE_MAP_WIDTH = 128;
/** How far past the walk range from the run's first site its second one lies, in half-cell nodes. */
const PAST_RANGE_NODES = 10;
/** A run's second site, with no signpost between it and the first. */
const BEYOND_RANGE_HX = FIRST_OWN_HX + WALK_RANGE_NODES + PAST_RANGE_NODES;

function siteOf(sim: Simulation, hx: number): Entity {
  const site = siteAt(sim, hx, ROW);
  if (site === undefined) throw new Error(`expected a road site at ${hx}`);
  return site;
}

function assign(sim: Simulation, builder: Entity, site: Entity): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'assignBuilder', entity: builder, site }));
  sim.step();
}

/** A store, a house site nearer than every road site, own road sites and a rival's, and one builder. */
function roadRunScene(): { sim: Simulation; builder: Entity; house: Entity } {
  const sim = roadSim();
  storeAt(sim, STORE_HX);
  const house = houseSiteAt(sim, HOUSE_HX);
  const builder = builderAt(sim, BUILDER_HX);
  orderRoads(
    sim,
    ROAD_HXS.map((hx) => ({ hx, hy: ROW })),
  );
  orderRoads(sim, [{ hx: RIVAL_HX, hy: ROW }], RIVAL);
  return { sim, builder, house };
}

describe('a road run', () => {
  it('builds every own road site before a nearer house, then returns to the house', () => {
    const { sim, builder, house } = roadRunScene();
    const [first] = ROAD_HXS;
    assign(sim, builder, siteOf(sim, first));
    expect(sim.world.get(builder, BuildMode).kind).toBe('roads');
    const ownRoadsLeft = (): boolean => ROAD_HXS.some((hx) => siteAt(sim, hx, ROW) !== undefined);

    for (let tick = 0; tick < RUN_TICKS && sim.world.has(house, UnderConstruction); tick++) {
      sim.step();
      if (ownRoadsLeft()) {
        expect(sim.world.tryGet(builder, SiteAssignment)?.site, `tick ${tick}`).not.toBe(house);
      }
    }
    for (const hx of ROAD_HXS) expect(roadAt(sim, hx, ROW), `road at ${hx}`).toBe(true);
    expect(sim.world.has(house, UnderConstruction)).toBe(false);
    expect(sim.world.has(builder, BuildMode)).toBe(false);
    expect(siteAt(sim, RIVAL_HX, ROW)).toBeDefined();
  });

  it("keeps to its own tribe's road sites beside its seat's sites of another tribe", () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX);
    const builder = builderAt(sim, BUILDER_HX);
    // The same seat's pending line of another tribe, within the pick radius of the run's next site.
    for (const hx of OTHER_TRIBE_HXS) {
      sim.enqueueSetup({
        kind: 'placeRoadSite',
        x: hx,
        y: ROW,
        tribe: OTHER_TRIBE,
        owner: HUMAN,
        force: true,
      });
    }
    orderRoads(sim, [
      { hx: FIRST_OWN_HX, hy: ROW },
      { hx: OWN_HX, hy: ROW },
    ]);
    assign(sim, builder, siteOf(sim, FIRST_OWN_HX));
    const others = OTHER_TRIBE_HXS.map((hx) => siteOf(sim, hx));

    for (let tick = 0; tick < RUN_TICKS && siteAt(sim, OWN_HX, ROW) !== undefined; tick++) {
      sim.step();
      const site = sim.world.tryGet(builder, SiteAssignment)?.site;
      expect(site !== undefined && others.includes(site), `tick ${tick}`).toBe(false);
    }
    expect(roadAt(sim, FIRST_OWN_HX, ROW)).toBe(true);
    expect(roadAt(sim, OWN_HX, ROW)).toBe(true);
    for (const site of others) expect(sim.world.get(site, RoadSite).reservation).toBeNull();
  });

  it('goes on past the signpost walk range, as a pin does', () => {
    const sim = roadSim(1, WIDE_MAP_WIDTH);
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    storeAt(sim, STORE_HX);
    const builder = builderAt(sim, BUILDER_HX);
    orderRoads(sim, [
      { hx: FIRST_OWN_HX, hy: ROW },
      { hx: BEYOND_RANGE_HX, hy: ROW },
    ]);
    assign(sim, builder, siteOf(sim, FIRST_OWN_HX));

    for (let tick = 0; tick < RUN_TICKS && siteAt(sim, BEYOND_RANGE_HX, ROW) !== undefined; tick++) {
      sim.step();
      expect(sim.world.has(builder, BuildMode), `tick ${tick}`).toBe(true);
    }
    expect(roadAt(sim, FIRST_OWN_HX, ROW)).toBe(true);
    expect(roadAt(sim, BEYOND_RANGE_HX, ROW)).toBe(true);
  });

  it('passes over a site another builder holds', () => {
    const { sim, builder } = roadRunScene();
    const [first, second] = ROAD_HXS;
    const held = siteOf(sim, first);
    const holder = builderAt(sim, 40);
    sim.world.add(holder, SiteAssignment, { site: held, pinned: false });
    claimSite(sim.world, held, holder);
    assign(sim, builder, held);
    expect(sim.world.get(builder, SiteAssignment).site).toBe(siteOf(sim, second));
  });

  it('ends on a move, an unassign or another assignment', () => {
    for (const order of ['move', 'unassign', 'assign'] as const) {
      const { sim, builder, house } = roadRunScene();
      assign(sim, builder, siteOf(sim, ROAD_HXS[0]));
      sim.run(2);
      expect(sim.world.has(builder, BuildMode), order).toBe(true);
      if (order === 'move') {
        sim.enqueue(playerCommand(HUMAN, { kind: 'moveUnit', entity: builder, x: 2, y: 2 }));
        sim.step();
      } else if (order === 'unassign') {
        sim.enqueue(playerCommand(HUMAN, { kind: 'unassignBuilder', entity: builder }));
        sim.step();
      } else {
        assign(sim, builder, house);
        expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: house, pinned: true });
      }
      expect(sim.world.has(builder, BuildMode), order).toBe(false);
      expect(sim.world.tryGet(builder, SiteAssignment)?.pinned === true, order).toBe(order === 'assign');
    }
  });

  it('is not started by a building site', () => {
    const { sim, builder, house } = roadRunScene();
    assign(sim, builder, house);
    expect(sim.world.has(builder, BuildMode)).toBe(false);
    expect(sim.world.get(builder, SiteAssignment)).toEqual({ site: house, pinned: true });
  });
});

describe('a wall run', () => {
  it('raises every own wall segment before a nearer house, then ends', () => {
    const sim = roadSim();
    storeAt(sim, STORE_HX);
    const house = houseSiteAt(sim, HOUSE_HX);
    const builder = builderAt(sim, BUILDER_HX);
    for (const hx of [20, 30]) {
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x: hx,
        y: ROW,
        tribe: VIKING,
        owner: HUMAN,
        underConstruction: true,
      });
    }
    sim.step();
    const walls = [...sim.world.query(Palisade)];
    const [first] = walls;
    if (first === undefined) throw new Error('expected wall segments');
    assign(sim, builder, first);
    expect(sim.world.get(builder, BuildMode).kind).toBe('walls');

    const wallsLeft = (): boolean => walls.some((w) => sim.world.has(w, UnderConstruction));
    for (let tick = 0; tick < RUN_TICKS && sim.world.has(house, UnderConstruction); tick++) {
      sim.step();
      if (wallsLeft()) {
        expect(sim.world.tryGet(builder, SiteAssignment)?.site, `tick ${tick}`).not.toBe(house);
      }
    }
    expect(wallsLeft()).toBe(false);
    expect(sim.world.has(house, UnderConstruction)).toBe(false);
    expect(sim.world.has(builder, BuildMode)).toBe(false);
  });
});
