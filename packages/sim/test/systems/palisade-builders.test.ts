import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CurrentAtomic,
  Damaged,
  Health,
  MoveGoal,
  Owner,
  Palisade,
  Position,
  SiteAssignment,
  Stockpile,
  setStockAmount,
  UnderConstruction,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  adminCommand,
  fx,
  ONE,
  positionOfNode,
  type ScriptLandscapeType,
  Simulation,
} from '../../src/index.js';
import { advanceConstructionLabor, constructionSystem } from '../../src/systems/economy/construction.js';
import { WALL_REPAIR_CREW_LIMIT } from '../../src/systems/economy/repair.js';
import {
  claimPalisade,
  palisadeReservedBy,
  releasePalisadeReservation,
} from '../../src/systems/palisades/reservation.js';
import { resolveCombatHit } from '../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { REPAIR_CALM_TICKS } from '../../src/systems/settlers/drives/economy/repair.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const VIKING = 1;
const HUMAN = 0;
const STONE = 1;
const WOOD = 2;
const IDLE = 0;
const BUILDER = 7;
const BUILD_HOUSE_ATOMIC = 39;
const BUILD_WALL_ATOMIC = 42;
const STORE = 1;
const HOUSE = 2;
const GRASS = 0;
const ROW = 6;

const WALL: ScriptLandscapeType = {
  typeId: 691,
  walk: [{ dx: 0, dy: 0 }],
  build: [],
  groups: [],
  wall: {
    maxHitpoints: 100,
    repairPerStrike: 3,
    construction: [{ goodType: WOOD, amount: 1 }],
  },
};

function builderContent() {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: STONE, id: 'stone' },
      { typeId: WOOD, id: 'wood' },
    ],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      { typeId: BUILDER, id: 'builder', allowedAtomics: [BUILD_HOUSE_ATOMIC, BUILD_WALL_ATOMIC] },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: STORE,
        id: 'headquarters',
        kind: 'storage',
        stock: [
          { goodType: STONE, capacity: 10 },
          { goodType: WOOD, capacity: 10 },
        ],
      },
      {
        typeId: HOUSE,
        id: 'home_small',
        kind: 'home',
        homeSize: 1,
        construction: [{ goodType: STONE, amount: 1 }],
      },
    ],
  });
}

function buildingAt(sim: Simulation, buildingType: number, hx: number, site: boolean): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: site ? fx.fromInt(0) : ONE, level: 0 });
  sim.world.add(e, Stockpile, {
    amounts: new Map(
      site
        ? []
        : [
            [STONE, 5],
            [WOOD, 5],
          ],
    ),
  });
  if (site) sim.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function builderAt(sim: Simulation, hx: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, ROW));
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: BUILDER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

describe('palisade builders', () => {
  it('raise a wall only once no house is left to build, even when the wall is nearer', () => {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 1,
      content: builderContent(),
      map: { ...map, landscapes: { types: [WALL], placements: [] } },
    });
    buildingAt(sim, STORE, 4, false);
    const house = buildingAt(sim, HOUSE, 40, true);
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 12,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
      underConstruction: true,
    });
    const builder = builderAt(sim, 8);
    sim.step();
    const [wall] = [...sim.world.query(Palisade)];
    if (wall === undefined) throw new Error('expected a wall site');

    let houseDoneAt: number | null = null;
    for (let tick = 0; tick < 4000 && sim.world.has(wall, UnderConstruction); tick++) {
      sim.step();
      if (sim.world.has(house, UnderConstruction)) {
        expect(sim.world.tryGet(builder, SiteAssignment)?.site, `tick ${tick}`).not.toBe(wall);
      } else {
        houseDoneAt ??= tick;
      }
    }
    expect(houseDoneAt).not.toBeNull();
    expect(sim.world.has(wall, UnderConstruction)).toBe(false);
  });

  it('mend a damaged wall with the hammer once it is quiet and no house is left to build', () => {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 2,
      content: builderContent(),
      map: { ...map, landscapes: { types: [WALL], placements: [] } },
    });
    buildingAt(sim, STORE, 4, false);
    const house = buildingAt(sim, HOUSE, 40, true);
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 12,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
    });
    const builder = builderAt(sim, 8);
    sim.step();
    const [wall] = [...sim.world.query(Palisade)];
    if (wall === undefined) throw new Error('expected a standing wall');
    resolveCombatHit(sim.world, ctxOf(sim), sim.world.create(), wall, { damage: 30 }, [], 'melee');
    const hitTick = sim.tick;

    let houseDoneAt: number | null = null;
    let repairTicks = 0;
    while (sim.world.has(wall, Damaged) && sim.tick < hitTick + 6000) {
      sim.step();
      const atWall = sim.world.tryGet(builder, SiteAssignment)?.site === wall;
      if (!sim.world.has(house, UnderConstruction)) houseDoneAt ??= sim.tick;
      if (atWall) {
        expect(sim.tick - hitTick, 'a crew waits out the calm period').toBeGreaterThanOrEqual(
          REPAIR_CALM_TICKS,
        );
        expect(houseDoneAt, 'walls wait for the houses').not.toBeNull();
        const swing = sim.world.tryGet(builder, CurrentAtomic);
        if (swing?.effect.kind === 'repair') {
          expect(swing.atomicId).toBe(BUILD_WALL_ATOMIC);
          repairTicks++;
        }
      }
    }
    expect(repairTicks).toBeGreaterThan(0);
    expect(sim.world.get(wall, Health).hitpoints).toBe(WALL.wall?.maxHitpoints);
    expect(sim.world.has(wall, UnderConstruction)).toBe(false);
  });

  it('mend a damaged wall before raising a new segment, even when the segment is nearer', () => {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 3,
      content: builderContent(),
      map: { ...map, landscapes: { types: [WALL], placements: [] } },
    });
    buildingAt(sim, STORE, 4, false);
    const place = (x: number, extra: object): void =>
      sim.enqueueSetup({
        kind: 'placePalisade',
        gfxIndex: WALL.typeId,
        x,
        y: ROW,
        tribe: VIKING,
        owner: HUMAN,
        ...extra,
      });
    place(12, { underConstruction: true });
    place(24, { valency: 70 });
    builderAt(sim, 8);
    sim.step();
    const [segment, damaged] = [...sim.world.query(Palisade)].sort((a, b) => a - b);
    if (segment === undefined || damaged === undefined) throw new Error('expected a site and a wall');

    for (let tick = 0; tick < 4000 && sim.world.has(segment, UnderConstruction); tick++) {
      sim.step();
      if (!sim.world.has(segment, UnderConstruction)) {
        expect(sim.world.has(damaged, Damaged), 'the damaged wall was mended first').toBe(false);
      }
    }
    expect(sim.world.has(segment, UnderConstruction)).toBe(false);
    expect(sim.world.get(damaged, Health).hitpoints).toBe(WALL.wall?.maxHitpoints);
  });

  it('send a damaged wall one mender at a time', () => {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 4,
      content: builderContent(),
      map: { ...map, landscapes: { types: [WALL], placements: [] } },
    });
    buildingAt(sim, STORE, 4, false);
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: 24,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
      valency: 10,
    });
    const builders = [16, 18, 20, 28, 30, 32, 34].map((hx) => builderAt(sim, hx));
    sim.step();
    const [wall] = [...sim.world.query(Palisade)];
    if (wall === undefined) throw new Error('expected a standing wall');

    let largest = 0;
    for (let tick = 0; tick < 600 && sim.world.has(wall, Damaged); tick++) {
      sim.step();
      const crew = builders.filter((b) => sim.world.tryGet(b, SiteAssignment)?.site === wall).length;
      largest = Math.max(largest, crew);
    }
    expect(largest).toBe(WALL_REPAIR_CREW_LIMIT);
  });
});

describe('wall claims', () => {
  function claimSim(): Simulation {
    const map = grassNodeMap(48, 12);
    const sim = new Simulation({
      seed: 5,
      content: builderContent(),
      map: { ...map, landscapes: { types: [WALL], placements: [] } },
    });
    buildingAt(sim, STORE, 4, false);
    return sim;
  }

  function wallSite(sim: Simulation, hx: number, extra: object = { underConstruction: true }): Entity {
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL.typeId,
      x: hx,
      y: ROW,
      tribe: VIKING,
      owner: HUMAN,
      ...extra,
    });
    sim.step();
    const centre = positionOfNode(hx, ROW);
    const wall = [...sim.world.query(Palisade, Position)].find(
      (e) => sim.world.get(e, Position).x === centre.x && sim.world.get(e, Position).y === centre.y,
    );
    if (wall === undefined) throw new Error(`expected a wall at ${hx}`);
    return wall;
  }

  /** A claim holder that stays put: an assignment and a claim, no trade to walk off with. */
  function stillClaimant(sim: Simulation, site: Entity): Entity {
    const holder = sim.world.create();
    sim.world.add(holder, SiteAssignment, { site, pinned: false });
    expect(claimPalisade(sim.world, site, holder)).toBe(true);
    return holder;
  }

  it('keep a pin to a segment another builder claimed, which waits for the claim', () => {
    const sim = claimSim();
    const site = wallSite(sim, 24);
    const holder = stillClaimant(sim, site);
    const pinned = builderAt(sim, 20);
    sim.enqueueSetup({ kind: 'assignBuilder', entity: pinned, site });
    sim.run(30);
    expect(sim.world.get(pinned, SiteAssignment)).toEqual({ site, pinned: true });
    expect(palisadeReservedBy(sim.world, site)).toBe(holder);
    expect(sim.world.get(site, UnderConstruction).labor).toBe(0);
  });

  it('refuse a pin to a damaged wall whose one-mender crew is full, a pinned mender included', () => {
    const sim = claimSim();
    const wall = wallSite(sim, 24, { valency: 50 });
    const first = builderAt(sim, 20);
    const second = builderAt(sim, 28);
    sim.enqueueSetup({ kind: 'assignBuilder', entity: first, site: wall });
    sim.step();
    expect(sim.world.get(first, SiteAssignment)).toEqual({ site: wall, pinned: true });
    sim.enqueueSetup({ kind: 'assignBuilder', entity: second, site: wall });
    sim.step();
    expect(WALL_REPAIR_CREW_LIMIT).toBe(1);
    expect(sim.world.tryGet(second, SiteAssignment)?.site).not.toBe(wall);
  });

  it('drop the flag when the claim holder is pinned elsewhere or dies', () => {
    const sim = claimSim();
    const first = wallSite(sim, 24);
    const second = wallSite(sim, 30);
    const builder = builderAt(sim, 20);
    sim.world.add(builder, SiteAssignment, { site: first, pinned: false });
    expect(claimPalisade(sim.world, first, builder)).toBe(true);
    sim.enqueueSetup({ kind: 'assignBuilder', entity: builder, site: second });
    sim.step();
    expect(sim.world.get(first, Palisade).reservation).toBeNull();

    // A lapse no release saw, such as a job change: the construction pass clears the raw claim.
    const other = sim.world.create();
    sim.world.add(other, SiteAssignment, { site: first, pinned: false });
    expect(claimPalisade(sim.world, first, other)).toBe(true);
    sim.world.remove(other, SiteAssignment);
    sim.step();
    expect(sim.world.get(first, Palisade).reservation).toBeNull();

    sim.world.add(builder, SiteAssignment, { site: first, pinned: false });
    expect(claimPalisade(sim.world, first, builder)).toBe(true);
    sim.world.add(builder, Health, { hitpoints: 1, max: 1 });
    sim.enqueue(adminCommand({ kind: 'debugKill', target: builder }));
    sim.step();
    expect(sim.world.isAlive(builder)).toBe(false);
    expect(sim.world.get(first, Palisade).reservation).toBeNull();
  });

  it('keep the flag of a struck segment its builder left while a traveller holds it up', () => {
    const sim = claimSim();
    const site = wallSite(sim, 24);
    const holder = stillClaimant(sim, site);
    setStockAmount(sim.world, site, WOOD, 1);
    expect(advanceConstructionLabor(sim.world, ctxOf(sim), site, holder)).toBe(true);
    const walker = builderAt(sim, 24);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    sim.world.add(walker, MoveGoal, { cell: terrain.nodeAt(40, ROW) });

    // The builder leaves the struck segment as the planner does.
    releasePalisadeReservation(sim.world, holder);
    sim.world.remove(holder, SiteAssignment);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(site, UnderConstruction)).toBe(true);
    expect(sim.world.get(site, Palisade).reservation).toEqual({ builder: holder });

    sim.world.remove(walker, MoveGoal);
    constructionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(site, UnderConstruction)).toBe(false);
    expect(sim.world.get(site, Palisade).reservation).toBeNull();
  });
});
