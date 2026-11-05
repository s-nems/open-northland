import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  diplomacyStance,
  Engagement,
  Health,
  PlayerOrder,
  Settler,
} from '../../../src/components/index.js';
import { TICKS_PER_MINUTE } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type SimEvent, Simulation } from '../../../src/index.js';
import { anchorNodeOf } from '../../../src/systems/ai-shared/node-geometry.js';
import { PEACE_KEEP_OUT_RADIUS_NODES } from '../../../src/systems/match/peace.js';
import { WEAPON_MAIN_TYPE } from '../../../src/systems/readviews/index.js';
import { resolveCombatHit } from '../../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { testContent } from '../../fixtures/content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { ctxOf, fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from '../conflict/engagement/support.js';

/** A seat outside the peace: a map's own scripted tribe. */
const P2 = 2;
/** Far enough into the match that a fight would have landed several blows. */
const PEACE_END = 40;

function skirmishSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
}

function stepTo(sim: Simulation, tick: number): void {
  while (sim.tick < tick) sim.step();
}

function unhurt(sim: Simulation, e: Entity): boolean {
  const pool = sim.world.get(e, Health);
  return pool.hitpoints === pool.max;
}

describe('lobby peace - harm between seats', () => {
  it('members neither engage nor wound each other while it holds, and fight from the tick it ends', () => {
    const sim = skirmishSim();
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const b = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: PEACE_END, players: [P0, P1] });

    stepTo(sim, PEACE_END - 1);
    expect(sim.atPeace(P0, P1)).toBe(true);
    expect(sim.world.has(a, Engagement) || sim.world.has(b, Engagement)).toBe(false);
    expect(unhurt(sim, a) && unhurt(sim, b)).toBe(true);

    sim.step();
    expect(sim.atPeace(P0, P1)).toBe(false);
    expect(sim.peaceHoldsUntilTick()).toBeNull();
    expect(sim.world.has(a, Engagement)).toBe(true);
  });

  it('a member still fights a seat outside the peace', () => {
    const sim = skirmishSim();
    const member = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const outsider = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P2 });
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: PEACE_END, players: [P0, P1] });

    sim.step();

    expect(sim.world.has(member, Engagement)).toBe(true);
    expect(sim.world.has(outsider, Engagement)).toBe(true);
  });

  it('refuses an attack order on a peace partner, leaving the walk the unit had', () => {
    const sim = skirmishSim();
    const a = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const partner = fighterAt(sim, 4, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: PEACE_END, players: [P0, P1] });
    sim.enqueueSetup({ kind: 'moveUnit', entity: a, x: 4, y: 1 });
    sim.step();
    expect(sim.world.has(a, PlayerOrder)).toBe(true);

    sim.enqueueSetup({ kind: 'attackUnit', entity: a, target: partner });
    sim.step();

    expect(sim.world.has(a, PlayerOrder)).toBe(true);
    expect(sim.world.has(a, Engagement)).toBe(false);
  });

  it('a blow or shot on a peace partner deals nothing and turns no stance', () => {
    const sim = skirmishSim();
    const shooter = fighterAt(sim, 0, 0, VIKING, WOODCUTTER, { owner: P0 });
    const partner = fighterAt(sim, 1, 0, VIKING, WOODCUTTER, { owner: P1 });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: P1, to: P0, state: 'friend' });
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: PEACE_END, players: [P0, P1] });
    sim.step();

    const wound = resolveCombatHit(sim.world, ctxOf(sim), shooter, partner, { damage: 50 }, [], 'projectile');

    expect(wound).toBeNull();
    expect(unhurt(sim, partner)).toBe(true);
    expect(diplomacyStance(sim.world, P1, P0)).toBe('friend');
  });
});

describe("lobby peace - orders and placements at a partner's door", () => {
  const SPEARMAN = 32;
  const CIVILIST = 6;
  const HQ_TYPE = 1;
  /** A point-footprint house, so a test site never collides with the towns. */
  const HOME_TYPE = 2;
  const CATAPULT = 5;
  const CART = 6;
  /** The catapult crew's class, which binds the siege weapon; a cart's class binds none. */
  const CATAPULT_JOB = 54;
  const CART_JOB = 55;
  /** Long past every setup step, short enough to step to its end. */
  const PEACE_UNTIL = 100;
  /** Far enough east that a point short of its zone still lies on the map. */
  const PARTNER_HQ = { x: PEACE_KEEP_OUT_RADIUS_NODES + 30, y: 16 };
  const MAP_WIDTH = PARTNER_HQ.x + 14;
  const MAP_HEIGHT = 32;
  const HOME = { x: 4, y: 16 };
  const OWN_HQ = { x: 20, y: 16 };
  /** The partner's building dropped beside {@link OWN_HQ}, nearer to it than its own town. */
  const PARTNER_OUTPOST = { x: 27, y: 16 };
  const DOOR = { x: PARTNER_HQ.x - PEACE_KEEP_OUT_RADIUS_NODES + 2, y: PARTNER_HQ.y };
  /** Inside the outpost's radius, yet nearer {@link OWN_HQ}. */
  const BESIDE_OWN_HQ = { x: OWN_HQ.x - 8, y: OWN_HQ.y };

  /** {@link aiContent} with an armed catapult and an unarmed cart. */
  function vehicleContent(): ContentSet {
    const base = aiContent();
    const vehicle = { stockSlots: 0, logicSize: 1, passengerJobs: [SPEARMAN], commanderJob: SPEARMAN };
    return parseContentSet({
      ...base,
      jobs: [...base.jobs, { typeId: CATAPULT_JOB, id: 'catapult' }, { typeId: CART_JOB, id: 'cart' }],
      vehicles: [
        { ...vehicle, typeId: CATAPULT, id: 'catapult', jobId: CATAPULT_JOB, hitpoints: 3000 },
        { ...vehicle, typeId: CART, id: 'cart', jobId: CART_JOB, hitpoints: 500 },
      ],
      weapons: [
        ...base.weapons,
        {
          typeId: 30,
          id: 'viking_catapult',
          tribeType: VIKING,
          jobType: CATAPULT_JOB,
          mainType: WEAPON_MAIN_TYPE.CATAPULT,
          minRange: 10,
          maxRange: 40,
        },
      ],
    });
  }

  function spawnAt(sim: Simulation, jobType: number, owner: number): Entity {
    const before = new Set(sim.world.query(Settler));
    sim.enqueueSetup({ kind: 'spawnSettler', jobType, x: HOME.x, y: HOME.y, tribe: VIKING, owner });
    sim.step();
    const spawned = [...sim.world.query(Settler)].find((e) => !before.has(e));
    if (spawned === undefined) throw new Error('setup: nothing spawned');
    return spawned;
  }

  function placeHq(sim: Simulation, at: { x: number; y: number }, owner: number): void {
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      ...at,
      tribe: VIKING,
      owner,
      force: true,
    });
  }

  /** A player's unforced house placement, past the technology gate the test content does not unlock. */
  function placeHome(sim: Simulation, at: { x: number; y: number }, owner: number): void {
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      ...at,
      tribe: VIKING,
      owner,
      underConstruction: true,
      ignoreTechnology: true,
    });
  }

  function homesAt(sim: Simulation, at: { x: number; y: number }): number {
    return [...sim.world.query(Building)].filter((e) => {
      const node = sim.world.get(e, Building).buildingType === HOME_TYPE ? anchorNodeOf(sim.world, e) : null;
      return node !== null && node.hx === at.x && node.hy === at.y;
    }).length;
  }

  function partnerSim(content = aiContent()): { sim: Simulation; soldier: Entity; civilian: Entity } {
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(MAP_WIDTH, MAP_HEIGHT) });
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: PEACE_UNTIL, players: [P0, P1] });
    placeHq(sim, PARTNER_HQ, P1);
    const soldier = spawnAt(sim, SPEARMAN, P0);
    const civilian = spawnAt(sim, CIVILIST, P0);
    expect([...sim.world.query(Building)]).toHaveLength(1);
    return { sim, soldier, civilian };
  }

  function refusals(sim: Simulation): Extract<SimEvent, { kind: 'peaceRefused' }>[] {
    return sim.events.current().flatMap((ev) => (ev.kind === 'peaceRefused' ? [ev] : []));
  }

  it("refuses a soldier and a civilian sent to a partner's door, with one note", () => {
    const { sim, soldier, civilian } = partnerSim();

    sim.enqueueSetup({
      kind: 'moveUnitGroup',
      members: [
        { entity: soldier, ...DOOR },
        { entity: civilian, ...DOOR },
      ],
    });
    sim.step();

    expect(sim.world.has(soldier, PlayerOrder) || sim.world.has(civilian, PlayerOrder)).toBe(false);
    expect(refusals(sim)).toEqual([{ kind: 'peaceRefused', player: P0, ...DOOR, what: 'walk' }]);
  });

  it('lets a unit walk short of the zone', () => {
    const { sim, civilian } = partnerSim();
    const short = { x: PARTNER_HQ.x - PEACE_KEEP_OUT_RADIUS_NODES - 4, y: PARTNER_HQ.y };

    sim.enqueueSetup({ kind: 'attackMoveUnit', entity: civilian, ...short });
    sim.step();

    expect(sim.world.has(civilian, PlayerOrder)).toBe(true);
  });

  /** A seat with its own town and a partner's building dropped right beside it. */
  function outpostSim(): { sim: Simulation; civilian: Entity } {
    const { sim, civilian } = partnerSim();
    placeHq(sim, OWN_HQ, P0);
    placeHq(sim, PARTNER_OUTPOST, P1);
    sim.step();
    return { sim, civilian };
  }

  it("lets a seat walk and build beside its own town by a partner's building, since own ground wins", () => {
    const { sim, civilian } = outpostSim();

    sim.enqueueSetup({ kind: 'moveUnit', entity: civilian, ...BESIDE_OWN_HQ });
    placeHome(sim, BESIDE_OWN_HQ, P0);
    sim.step();

    expect(sim.world.has(civilian, PlayerOrder)).toBe(true);
    expect(homesAt(sim, BESIDE_OWN_HQ)).toBe(1);
    expect(refusals(sim)).toEqual([]);
  });

  it("still refuses a unit sent deep into the partner's base", () => {
    const { sim, civilian } = outpostSim();

    sim.enqueueSetup({ kind: 'moveUnit', entity: civilian, x: PARTNER_HQ.x - 3, y: PARTNER_HQ.y });
    sim.step();

    expect(sim.world.has(civilian, PlayerOrder)).toBe(false);
  });

  it("refuses a catapult and a cart driven to a partner's door, with one note", () => {
    const content = vehicleContent();
    const { sim } = partnerSim(content);
    const vehicleAt = (vehicleType: number, y: number): Entity => {
      const e = createVehicle(sim.world, ctxOf(sim), { vehicleType, ...HOME, y, tribe: VIKING, owner: P0 });
      if (e === null) throw new Error('setup: the vehicle is not in the content');
      return e;
    };
    const catapult = vehicleAt(CATAPULT, HOME.y - 8);
    const cart = vehicleAt(CART, HOME.y + 8);

    sim.enqueueSetup({ kind: 'moveVehicle', vehicle: catapult, ...DOOR });
    sim.enqueueSetup({ kind: 'moveVehicle', vehicle: cart, ...DOOR });
    sim.step();

    // Neither has a commander, so an order that reached the drive would be refused there instead.
    expect(sim.events.current().some((ev) => ev.kind === 'vehicleMoveRefused')).toBe(false);
    expect(refusals(sim)).toEqual([{ kind: 'peaceRefused', player: P0, ...DOOR, what: 'walk' }]);
  });

  it("refuses a member's house and signpost at a partner's door, as the probes show, with a note", () => {
    const { sim } = partnerSim();
    // The bystander's man near the door, whose build reach covers it.
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: CIVILIST,
      x: DOOR.x,
      y: DOOR.y + 4,
      tribe: VIKING,
      owner: P2,
    });
    sim.step();

    expect(sim.placementProbe(HOME_TYPE, P0)?.canPlace(DOOR.x, DOOR.y)).toBe(false);
    expect(sim.placementProbe(HOME_TYPE, P2)?.canPlace(DOOR.x, DOOR.y)).toBe(true);
    expect(sim.signpostProbe(P0)?.canPlace(DOOR.x, DOOR.y)).toBe(false);
    expect(sim.signpostProbe(P2)?.canPlace(DOOR.x, DOOR.y)).toBe(true);
    placeHome(sim, DOOR, P0);
    sim.step();

    expect(homesAt(sim, DOOR)).toBe(0);
    expect(refusals(sim)).toEqual([{ kind: 'peaceRefused', player: P0, ...DOOR, what: 'build' }]);
  });

  it('lets a seat outside the peace build there', () => {
    const { sim } = partnerSim();

    placeHome(sim, DOOR, P2);
    sim.step();

    expect(homesAt(sim, DOOR)).toBe(1);
    expect(refusals(sim)).toEqual([]);
  });

  it('allows every walk and placement once the peace ended', () => {
    const { sim, civilian } = partnerSim();
    stepTo(sim, PEACE_UNTIL);

    sim.enqueueSetup({ kind: 'moveUnit', entity: civilian, ...DOOR });
    placeHome(sim, { x: DOOR.x, y: DOOR.y + 4 }, P0);
    sim.step();

    expect(sim.world.has(civilian, PlayerOrder)).toBe(true);
    expect(homesAt(sim, { x: DOOR.x, y: DOOR.y + 4 })).toBe(1);
  });
});

describe('lobby peace - its clock', () => {
  it('announces the end five and one minute ahead and ends at the deadline, once each', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    // Off the minute, so the notices cannot coincide with a whole-minute tick count from the start.
    const until = 5 * TICKS_PER_MINUTE + 7;
    sim.enqueueSetup({ kind: 'setPeaceTime', untilTick: until, players: [P0, P1] });
    const heard: string[] = [];
    while (sim.tick < until + TICKS_PER_MINUTE) {
      sim.step();
      for (const ev of sim.events.current()) {
        if (ev.kind === 'peaceEnding') heard.push(`${sim.tick}:ending:${ev.minutesLeft}`);
        if (ev.kind === 'peaceEnded') heard.push(`${sim.tick}:ended`);
      }
    }

    expect(heard).toEqual([
      `${until - 5 * TICKS_PER_MINUTE}:ending:5`,
      `${until - TICKS_PER_MINUTE}:ending:1`,
      `${until}:ended`,
    ]);
  });
});
