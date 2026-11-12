import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Engagement,
  Fleeing,
  Health,
  Owner,
  Position,
  Projectile,
  SettlerProgress,
  Stance,
  seatPassenger,
  Vehicle,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  fx,
  halfCellMapFromCells,
  hexDistanceBetween,
  nodeOfPosition,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import { DECK_ARCHER_LIMIT, deckShipOf } from '../../../src/systems/conflict/deck-archers.js';
import { DECK_RANGE_PENALTY_POINTS, deckShotIntervalTicks } from '../../../src/systems/conflict/deck-fire.js';
import { FIGHT_EXPERIENCE_TYPE } from '../../../src/systems/progression/index.js';
import { MILITARY_MODE } from '../../../src/systems/readviews/index.js';
import { boardRider, createVehicle } from '../../../src/systems/vehicles/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

// Deck fire: bow soldiers aboard a warship shoot from its deck, the first ten by seat, at a bow's reach
// less the deck penalty, enemy ships first; a struck soldier answers at the ship.

const VIKING = 1;
const IDLE = 0;
const SOLDIER = 31;
const ARCHER = 40;
const CATAPULT_JOB = 54;
const P1 = 1;
const P2 = 2;
const GRASS = 0;
const WATER = 1;
const WARSHIP = 3;
const MERCHANT = 4;
const CATAPULT = 5;
const ATTACK_ATOMIC = 81;
const ATOMIC_EVENT_ATTACK = 25;
const SHORT_BOW_MAX_RANGE = 15;
const ATTACK_CLIP_TICKS = 4;
const DECK_REACH = SHORT_BOW_MAX_RANGE - DECK_RANGE_PENALTY_POINTS;
/** Long enough for every seated bowman's clip to come round several times. */
const SHOT_TICKS = 24;
const TOUGH = 1_000_000;
/** A bowman this practised never scatters ashore: the aim roll (0..99) never exceeds `hits + 10`. */
const VETERAN_BOW_HITS = 100;

/** Map cells: the strait spans columns 10..19, so the east shore's first node column is 40. */
const MAP_W = 30;
const MAP_H = 12;
const STRAIT_FROM = 10;
const STRAIT_TO = 20;
const SHIP_X = 30;
const ROW = 12;

function deckContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    buildings: [],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: SOLDIER, id: 'soldier_unarmed' },
      { typeId: ARCHER, id: 'soldier_bow_short' },
      { typeId: CATAPULT_JOB, id: 'vehicle_catapult' },
    ],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
    ],
    vehicles: [
      {
        typeId: WARSHIP,
        id: 'ship_small',
        jobId: 52,
        stockSlots: 50,
        passengerSlots: 19,
        logicSize: 2,
        passengerJobs: [SOLDIER, ARCHER, CATAPULT_JOB],
        hitpoints: 5000,
      },
      {
        typeId: MERCHANT,
        id: 'ship_big',
        jobId: 53,
        stockSlots: 200,
        passengerSlots: 9,
        logicSize: 2,
        passengerJobs: [SOLDIER, ARCHER],
        hitpoints: 5000,
      },
      {
        typeId: CATAPULT,
        id: 'catapult',
        jobId: CATAPULT_JOB,
        stockSlots: 0,
        logicSize: 1,
        passengerJobs: [SOLDIER],
        hitpoints: 3000,
      },
    ],
    weapons: [
      {
        typeId: 7,
        id: 'mace',
        tribeType: VIKING,
        jobType: SOLDIER,
        mainType: 3,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 40 },
      },
      {
        typeId: 16,
        id: 'short_bow',
        tribeType: VIKING,
        jobType: ARCHER,
        mainType: 6,
        munitionType: 1,
        speed: 8,
        minRange: 3,
        maxRange: SHORT_BOW_MAX_RANGE,
        damage: { '0': 500, '6': 40 },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        // One rung, so the tribe declares trades and a landed hit trains its bowmen.
        jobEnables: [{ jobType: SOLDIER, kind: 'job', targetId: ARCHER }],
        atomicBindings: [
          { jobType: SOLDIER, atomicId: ATTACK_ATOMIC, animation: 'viking_attack' },
          { jobType: ARCHER, atomicId: ATTACK_ATOMIC, animation: 'viking_attack' },
        ],
      },
    ],
    atomicAnimations: [
      {
        id: 'viking_attack',
        name: 'viking_attack',
        length: ATTACK_CLIP_TICKS,
        events: [{ at: 4, type: ATOMIC_EVENT_ATTACK }],
      },
    ],
  });
}

function strait(): TerrainMap {
  const typeIds = Array.from({ length: MAP_W * MAP_H }, (_, i) =>
    i % MAP_W >= STRAIT_FROM && i % MAP_W < STRAIT_TO ? WATER : GRASS,
  );
  return halfCellMapFromCells({ width: MAP_W, height: MAP_H, typeIds });
}

function sim(): Simulation {
  return new Simulation({ seed: 1, content: deckContent(), map: strait() });
}

function personAt(s: Simulation, hx: number, hy: number, owner: number, jobType: number): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(hx, hy));
  addPerson(s.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  s.world.add(e, Health, { hitpoints: TOUGH, max: TOUGH });
  s.world.add(e, Owner, { player: owner });
  s.world.add(e, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
  return e;
}

/** A ship of `type` on node (hx, ROW) with `crew` bowmen seated and aboard, in seat order. */
function shipWith(
  s: Simulation,
  type: number,
  hx: number,
  owner: number,
  crew: number,
): { ship: Entity; bowmen: Entity[] } {
  const ship = createVehicle(s.world, ctxOf(s), { vehicleType: type, x: hx, y: ROW, tribe: VIKING, owner });
  if (ship === null) throw new Error('ship type missing');
  s.world.mut(ship, Health).hitpoints = TOUGH;
  const bowmen: Entity[] = [];
  for (let i = 0; i < crew; i++) {
    const archer = personAt(s, 2, 2, owner, ARCHER);
    expect(seatPassenger(s.world, ship, archer)).toBe(true);
    boardRider(s.world, archer, ship);
    bowmen.push(archer);
  }
  return { ship, bowmen };
}

/** The east-shore node `points` map points from the ship. */
function shoreAt(points: number): { hx: number; hy: number } {
  const at = { hx: SHIP_X + points, hy: ROW };
  expect(hexDistanceBetween(SHIP_X, ROW, at.hx, at.hy)).toBe(points);
  return at;
}

function launches(s: Simulation, ticks: number): { shooter: Entity; target: Entity | undefined }[] {
  const out: { shooter: Entity; target: Entity | undefined }[] = [];
  for (let i = 0; i < ticks; i++) {
    s.step();
    for (const ev of s.events.current())
      if (ev.kind === 'projectileLaunched') out.push({ shooter: ev.shooter, target: ev.target });
  }
  return out;
}

describe('deck fire', () => {
  it('looses a deck bowman’s arrows from the ship at an enemy within the bow’s reach less the deck penalty', () => {
    const s = sim();
    const { ship, bowmen } = shipWith(s, WARSHIP, SHIP_X, P1, 1);
    const shore = shoreAt(DECK_REACH);
    const enemy = personAt(s, shore.hx, shore.hy, P2, SOLDIER);
    const origins: { x: number; y: number }[] = [];
    let shots = 0;
    for (let i = 0; i < SHOT_TICKS; i++) {
      s.step();
      for (const ev of s.events.current()) {
        if (ev.kind !== 'projectileLaunched') continue;
        shots++;
        expect(ev.shooter).toBe(bowmen[0]);
        expect(ev.target).toBe(enemy);
        const flight = s.world.get(ev.projectile, Projectile);
        origins.push({ x: flight.originX, y: flight.originY });
      }
    }
    expect(shots).toBeGreaterThan(0);
    const at = s.world.get(ship, Position);
    expect(origins.every((o) => o.x === at.x && o.y === at.y)).toBe(true);
  });

  it('shoots slower from the deck than his attack clip ashore', () => {
    const s = sim();
    shipWith(s, WARSHIP, SHIP_X, P1, 1);
    const shore = shoreAt(DECK_REACH);
    personAt(s, shore.hx, shore.hy, P2, SOLDIER);
    const shotTicks: number[] = [];
    for (let i = 0; i < SHOT_TICKS; i++) {
      s.step();
      if (s.events.current().some((ev) => ev.kind === 'projectileLaunched')) shotTicks.push(i);
    }

    const interval = deckShotIntervalTicks(ATTACK_CLIP_TICKS);
    expect(interval).toBeGreaterThan(ATTACK_CLIP_TICKS);
    expect(shotTicks.length).toBeGreaterThan(1);
    expect(shotTicks.slice(1).map((t, i) => t - (shotTicks[i] as number))).toEqual(
      Array.from({ length: shotTicks.length - 1 }, () => interval),
    );
  });

  it('holds fire on an enemy one map point past the deck reach', () => {
    const s = sim();
    shipWith(s, WARSHIP, SHIP_X, P1, 1);
    const shore = shoreAt(DECK_REACH + 1);
    personAt(s, shore.hx, shore.hy, P2, SOLDIER);
    expect(launches(s, SHOT_TICKS)).toEqual([]);
  });

  it('never shoots from a merchant ship', () => {
    const s = sim();
    shipWith(s, MERCHANT, SHIP_X, P1, 1);
    const shore = shoreAt(DECK_REACH);
    personAt(s, shore.hx, shore.hy, P2, SOLDIER);
    expect(launches(s, SHOT_TICKS)).toEqual([]);
  });

  it('lets only the first ten bowmen by seat shoot', () => {
    const s = sim();
    const { ship } = shipWith(s, WARSHIP, SHIP_X, P1, DECK_ARCHER_LIMIT + 2);
    const shore = shoreAt(DECK_REACH);
    personAt(s, shore.hx, shore.hy, P2, SOLDIER);
    // The commander's slot is the last, so seat order is the passenger list's, not the boarding order.
    const bySeat = s.world
      .get(ship, Vehicle)
      .passengers.flatMap((seat) => (seat === null ? [] : [seat.entity]));
    const shooters = new Set(launches(s, SHOT_TICKS).map((ev) => ev.shooter));
    expect(shooters).toEqual(new Set(bySeat.slice(0, DECK_ARCHER_LIMIT)));
  });

  it('shoots an enemy ship ahead of a nearer soldier', () => {
    const s = sim();
    shipWith(s, WARSHIP, SHIP_X, P1, 1);
    const { ship: enemyShip } = shipWith(s, WARSHIP, SHIP_X - DECK_REACH + 2, P2, 0);
    const shore = shoreAt(DECK_REACH - 4);
    personAt(s, shore.hx, shore.hy, P2, SOLDIER);
    const shots = launches(s, SHOT_TICKS);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((ev) => ev.target === enemyShip)).toBe(true);
  });

  it('turns a struck soldier on the ship', () => {
    const s = sim();
    const { ship } = shipWith(s, WARSHIP, SHIP_X, P1, 1);
    const shore = shoreAt(DECK_REACH);
    const enemy = personAt(s, shore.hx, shore.hy, P2, SOLDIER);
    let struck = false;
    for (let i = 0; i < SHOT_TICKS * 10 && !struck; i++) {
      s.step();
      struck = s.events.current().some((ev) => ev.kind === 'projectileHit' && ev.target === enemy);
    }
    expect(struck).toBe(true);
    expect(s.world.tryGet(enemy, Engagement)?.target).toBe(ship);
  });

  it('sends a struck civilian running from the ship', () => {
    const s = sim();
    shipWith(s, WARSHIP, SHIP_X, P1, 1);
    const shore = shoreAt(DECK_REACH);
    const civilian = personAt(s, shore.hx, shore.hy, P2, IDLE);
    s.world.mut(civilian, Stance).mode = MILITARY_MODE.FLEE;
    let struck = false;
    for (let i = 0; i < SHOT_TICKS * 10 && !struck; i++) {
      s.step();
      struck = s.events.current().some((ev) => ev.kind === 'projectileHit' && ev.target === civilian);
    }
    expect(struck).toBe(true);
    expect(s.world.has(civilian, Fleeing)).toBe(true);
  });

  it('scatters a veteran’s deck shots at a lone man where the same veteran ashore shoots true', () => {
    const offTarget = (deck: boolean): { shots: number; off: number } => {
      const s = sim();
      const shore = shoreAt(DECK_REACH);
      const enemy = personAt(s, shore.hx, shore.hy, P2, SOLDIER);
      s.world.mut(enemy, Stance).mode = MILITARY_MODE.IGNORE;
      const archer = deck
        ? (shipWith(s, WARSHIP, SHIP_X, P1, 1).bowmen[0] as Entity)
        : personAt(s, shore.hx + DECK_REACH, ROW, P1, ARCHER);
      s.world.mut(archer, Stance).mode = MILITARY_MODE.IGNORE;
      s.world.mut(archer, SettlerProgress).experience.set(FIGHT_EXPERIENCE_TYPE.BOW, VETERAN_BOW_HITS);
      let shots = 0;
      let off = 0;
      for (let i = 0; i < SHOT_TICKS * 4; i++) {
        s.step();
        for (const ev of s.events.current()) {
          if (ev.kind !== 'projectileLaunched') continue;
          shots++;
          const flight = s.world.get(ev.projectile, Projectile);
          const at = s.world.get(enemy, Position);
          if (nodeOfPosition(flight.aimX, flight.aimY).hx !== nodeOfPosition(at.x, at.y).hx) off++;
          else if (nodeOfPosition(flight.aimX, flight.aimY).hy !== nodeOfPosition(at.x, at.y).hy) off++;
        }
      }
      return { shots, off };
    };
    const ashore = offTarget(false);
    expect(ashore.shots).toBeGreaterThan(0);
    expect(ashore.off).toBe(0);
    expect(offTarget(true).off).toBeGreaterThan(0);
  });

  it('trains a deck bowman’s bow on a hit', () => {
    const s = sim();
    const { bowmen } = shipWith(s, WARSHIP, SHIP_X, P1, 1);
    const archer = bowmen[0] as Entity;
    const shore = shoreAt(DECK_REACH);
    const enemy = personAt(s, shore.hx, shore.hy, P2, SOLDIER);
    const before = s.world.get(archer, SettlerProgress).experience.get(FIGHT_EXPERIENCE_TYPE.BOW) ?? 0;
    let struck = false;
    for (let i = 0; i < SHOT_TICKS * 10 && !struck; i++) {
      s.step();
      struck = s.events.current().some((ev) => ev.kind === 'projectileHit' && ev.target === enemy);
    }
    expect(struck).toBe(true);
    expect(
      s.world.get(archer, SettlerProgress).experience.get(FIGHT_EXPERIENCE_TYPE.BOW) ?? 0,
    ).toBeGreaterThan(before);
  });

  it('answers for a rider aboard a warship, never for a siege engine’s commander', () => {
    const s = sim();
    const { ship, bowmen } = shipWith(s, WARSHIP, SHIP_X, P1, 1);
    const catapult = createVehicle(s.world, ctxOf(s), {
      vehicleType: CATAPULT,
      x: 4,
      y: ROW,
      tribe: VIKING,
      owner: P1,
    });
    if (catapult === null) throw new Error('catapult type missing');
    const commander = personAt(s, 2, 2, P1, SOLDIER);
    expect(seatPassenger(s.world, catapult, commander)).toBe(true);
    boardRider(s.world, commander, catapult);

    expect(deckShipOf(s.world, ctxOf(s), bowmen[0] as Entity)).toBe(ship);
    expect(deckShipOf(s.world, ctxOf(s), commander)).toBeNull();
  });
});
