import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AttackOrder,
  addPerson,
  Building,
  ChatCooldown,
  Engagement,
  Fleeing,
  FOG_MODE,
  type FogMode,
  type FogSettings,
  fogMode,
  fogModeOf,
  fogSettings,
  Health,
  Owner,
  PlayerContacts,
  Position,
  RoadSite,
  SettlerProgress,
  Stance,
  UnderConstruction,
  Upgrading,
} from '../../src/components/index.js';
import { fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, fogViewOfMask, Simulation } from '../../src/index.js';
import { FLEE_CHECK_STRIDE_TICKS } from '../../src/systems/conflict/flee.js';
import { SIGHT_RADIUS_NODES } from '../../src/systems/conflict/targeting.js';
import { SCOUT_EXPERIENCE_TYPE } from '../../src/systems/progression/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import { looseProjectile } from '../../src/systems/settlers/atomics/effects/combat/index.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import {
  BUILDING_VISION_NODES,
  CART_VISION_NODES,
  CHILD_VISION_NODES,
  CIVILIAN_VISION_NODES,
  exploreAround,
  FOG_STATE,
  FogState,
  HEADQUARTERS_VISION_NODES,
  HERO_VISION_NODES,
  HUNTER_VISION_NODES,
  SCOUT_VISION_NODES,
  SHIP_VISION_NODES,
  SIEGE_VISION_NODES,
  SOLDIER_VISION_NODES,
  stampVision,
  VISION_CADENCE_TICKS,
  visionRadiusForJob,
} from '../../src/systems/vision/index.js';
import { allyVision } from '../fixtures/allies.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The fog layer (systems/vision.ts): per-player masks over the cell grid, the modes' update rules
 * (OFF revealed; the map setting: CLASSIC black start / RECON known terrain; fog of war: sticky sight
 * without it, a downgrade with it), the OFF default + reset, and the combat/flee fog gates. The radii
 * are owner-tuned (see `vision/system.ts`), so these tests pin their classification, not their values.
 */

const VIKING = 1;
const WOODCUTTER = 1; // fixture job 1 - carries test_axe (band [1,2]); id 1 is a baby to the age classes
const CIVILIST = 6; // fixture job 6 `civilist` - a civilian eye
const CHILD_MALE = 4; // the age-class job a boy holds
const SOLDIER_JOB = 31; // fixture job 31 `soldier_unarmed`
const HERO_JOB = 45; // fixture job 45 `hero_saber_hatschi`
const HUNTER_JOB = 15; // fixture job 15 `hunter`
const HEADQUARTERS = 1; // fixture building 1 `headquarters`
const SAWMILL = 2; // fixture building 2 `sawmill`, any other house
const HANDCART = 1;
const OXCART = 2;
const SHIP_SMALL = 3;
const CATAPULT = 5;
const SCOUT_JOB = 27; // fixture job 27 `scout` - the widest eye
const P0 = 0;
const P1 = 1;

function simOn(mode: FogMode, w = 24, h = 8): Simulation {
  const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(w, h) });
  sim.enqueueSetup({ kind: 'setFogMode', mode });
  return sim;
}

/** An owned settler standing on visual cell (x,y)'s anchor node, with an explicit stance. */
function unit(
  sim: Simulation,
  x: number,
  y: number,
  owner: number,
  opts: { jobType?: number | null; mode?: MilitaryMode } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: opts.jobType === undefined ? CIVILIST : opts.jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints: 2000, max: 2000 });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, { mode: opts.mode ?? MILITARY_MODE.IGNORE, anchorCell: null });
  return e;
}

/** Teleport a unit to cell (x,y) - the between-rebuild move the regression tests need. */
function teleport(sim: Simulation, e: Entity, x: number, y: number): void {
  const p = sim.world.mut(e, Position);
  p.x = fx.fromInt(x);
  p.y = fx.fromInt(y);
}

/** The raw mask state of visual cell (x,y) for a player (bypasses the known-terrain view mapping). */
function rawState(sim: Simulation, player: number, x: number, y: number): number {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('mapless sim');
  return fog.stateAt(player, x, y);
}

describe('vision radii - the per-job classification', () => {
  it('reads each trade its own radius, a child the shortest', () => {
    const content = testContent();
    expect(visionRadiusForJob(content, SCOUT_JOB)).toBe(SCOUT_VISION_NODES);
    expect(visionRadiusForJob(content, HERO_JOB)).toBe(HERO_VISION_NODES);
    expect(visionRadiusForJob(content, SOLDIER_JOB)).toBe(SOLDIER_VISION_NODES);
    expect(visionRadiusForJob(content, HUNTER_JOB)).toBe(HUNTER_VISION_NODES);
    expect(visionRadiusForJob(content, CIVILIST)).toBe(CIVILIAN_VISION_NODES);
    expect(visionRadiusForJob(content, null)).toBe(CIVILIAN_VISION_NODES); // jobless adult or beast
    expect(visionRadiusForJob(content, CHILD_MALE)).toBe(CHILD_VISION_NODES);
  });
});

describe('vision radii - buildings and vehicles', () => {
  afterEach(() => vi.restoreAllMocks());

  /** A standing (or rising) owned building of `buildingType` on cell (x, 2). */
  function house(sim: Simulation, x: number, buildingType: number): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(2) });
    sim.world.add(e, Owner, { player: P0 });
    sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
    return e;
  }

  function vehicle(sim: Simulation, x: number, vehicleType: number): Entity {
    const e = createVehicle(sim.world, ctxOf(sim), { vehicleType, x: 2 * x, y: 4, tribe: VIKING, owner: P0 });
    if (e === null) throw new Error(`vehicle type ${vehicleType} not in the fixture`);
    return e;
  }

  /** Each eye's radius in the first rebuild, keyed by entity; an entity that is no eye is absent. */
  function radiiOfFirstRebuild(sim: Simulation): Map<Entity, number> {
    const stamps = vi.spyOn(FogState.prototype, 'stampEye');
    sim.run(1);
    return new Map(stamps.mock.calls.map(([eye, , , , radius]) => [eye, radius]));
  }

  it('a headquarters sees further than any other house, and a rising site sees nothing', () => {
    const sim = simOn(FOG_MODE.CLASSIC, 48, 8);
    const hq = house(sim, 4, HEADQUARTERS);
    const sawmill = house(sim, 14, SAWMILL);
    const site = house(sim, 24, SAWMILL);
    sim.world.add(site, UnderConstruction, { labor: fx.fromInt(0) });
    const upgrade = house(sim, 34, SAWMILL);
    sim.world.add(upgrade, UnderConstruction, { labor: fx.fromInt(0) });
    sim.world.add(upgrade, Upgrading, { savedStock: new Map(), seeded: new Map() });
    const radii = radiiOfFirstRebuild(sim);
    expect(radii.get(hq)).toBe(HEADQUARTERS_VISION_NODES);
    expect(radii.get(sawmill)).toBe(BUILDING_VISION_NODES);
    expect(radii.has(site)).toBe(false);
    expect(radii.get(upgrade)).toBe(BUILDING_VISION_NODES); // an upgrade keeps the standing house's sight
  });

  it('a ship sees furthest, a catapult less, a cart least', () => {
    const sim = simOn(FOG_MODE.CLASSIC, 48, 8);
    const ship = vehicle(sim, 4, SHIP_SMALL);
    const catapult = vehicle(sim, 14, CATAPULT);
    const handcart = vehicle(sim, 24, HANDCART);
    const oxcart = vehicle(sim, 34, OXCART);
    const radii = radiiOfFirstRebuild(sim);
    expect(radii.get(ship)).toBe(SHIP_VISION_NODES);
    expect(radii.get(catapult)).toBe(SIEGE_VISION_NODES);
    expect(radii.get(handcart)).toBe(CART_VISION_NODES);
    expect(radii.get(oxcart)).toBe(CART_VISION_NODES);
  });
});

describe('exploreAround - one look at a point, with no eye behind it', () => {
  const AT = { x: fx.fromInt(12), y: fx.fromInt(4) };

  it('without fog of war the ground stays in sight', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    sim.run(1);
    exploreAround(sim.fog, P0, AT, 2);
    expect(rawState(sim, P0, 12, 4)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, 13, 4)).toBe(FOG_STATE.VISIBLE); // one cell east is 68 px, the rim of 2 nodes
    expect(rawState(sim, P0, 14, 4)).toBe(FOG_STATE.UNEXPLORED);
    sim.run(2 * VISION_CADENCE_TICKS);
    expect(rawState(sim, P0, 12, 4)).toBe(FOG_STATE.VISIBLE);
  });

  it('under fog of war the ground shows until the next rebuild, then stays explored', () => {
    const sim = simOn(FOG_MODE.CLASSIC_FOG_OF_WAR);
    sim.run(1);
    const before = sim.fog?.generation;
    exploreAround(sim.fog, P0, AT, 1);
    expect(sim.fog?.generation).not.toBe(before);
    expect(rawState(sim, P0, 12, 4)).toBe(FOG_STATE.VISIBLE);
    sim.run(VISION_CADENCE_TICKS);
    expect(rawState(sim, P0, 12, 4)).toBe(FOG_STATE.EXPLORED);
  });

  it("a loosed arrow explores around its aim for the shooter's owner", () => {
    const sim = simOn(FOG_MODE.CLASSIC, 48, 8);
    sim.run(1);
    const archer = unit(sim, 2, 4, P0);
    const target = unit(sim, 30, 4, P1);
    looseProjectile(sim.world, ctxOf(sim), {
      source: archer,
      target,
      player: P0,
      weapon: {
        munitionType: 1,
        speed: 8,
        hitSelf: false,
        area: false,
        damage: { '0': 1 },
        hitSounds: {},
        missSounds: {},
      },
      weaponMainType: null,
      cover: null,
      aim: { x: fx.fromInt(30), y: fx.fromInt(4) },
    });
    expect(rawState(sim, P0, 30, 4)).toBe(FOG_STATE.VISIBLE); // the aim's own cell, beyond the archer's eye
    expect(rawState(sim, P0, 29, 4)).toBe(FOG_STATE.UNEXPLORED);
  });

  it('explores nothing with fog off or for no player', () => {
    const off = simOn(FOG_MODE.OFF);
    off.run(1);
    exploreAround(off.fog, P0, AT, 2);
    expect(off.fog?.tryMaskFor(P0)).toBeUndefined();
    const sim = simOn(FOG_MODE.CLASSIC);
    sim.run(1);
    exploreAround(sim.fog, null, AT, 2);
    exploreAround(sim.fog, 99, AT, 2);
    expect(sim.fog?.groupsWithMasks()).toEqual([]);
  });
});

describe('scout experience - the signpost craft widens the eye', () => {
  it('a mastered scout sees cells a fresh scout cannot (the visionRadiusOf wiring)', () => {
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR, 48, 8);
    const scout = unit(sim, 4, 4, P0, { jobType: SCOUT_JOB });
    for (let t = 0; t <= VISION_CADENCE_TICKS + 1; t++) sim.step();
    // 15 cells (30 nodes) east: beyond the base 26-node eye, inside mastery's +6.
    expect(rawState(sim, P0, 19, 4)).not.toBe(FOG_STATE.VISIBLE);

    sim.world.mut(scout, SettlerProgress).experience.set(SCOUT_EXPERIENCE_TYPE, 100); // mastery: the full cap
    for (let t = 0; t <= VISION_CADENCE_TICKS + 1; t++) sim.step();
    expect(rawState(sim, P0, 19, 4)).toBe(FOG_STATE.VISIBLE);
  });
});

describe('stampVision - the world-metric ellipse', () => {
  it('reaches radius·34 px: 4 cells sideways at radius 8, 7 rows down, and no further', () => {
    const w = 16;
    const h = 20;
    const mask = new Uint8Array(w * h);
    stampVision(mask, w, h, 6, 9, 8, null); // a fixed 8-node radius = 272 px (pins the ellipse metric)
    const at = (c: number, r: number): number => mask[r * w + c] ?? 0;
    expect(at(6, 9)).toBe(FOG_STATE.VISIBLE);
    expect(at(10, 9)).toBe(FOG_STATE.VISIBLE); // 4 cells east = 272 px - on the rim, inclusive
    expect(at(11, 9)).toBe(FOG_STATE.UNEXPLORED); // 5 cells = 340 px - out
    expect(at(6, 16)).toBe(FOG_STATE.VISIBLE); // 7 rows south = 266 px - in
    expect(at(6, 17)).toBe(FOG_STATE.UNEXPLORED); // 8 rows = 304 px - out
  });
});

describe('stamp memo - an eye whose footprint did not change writes nothing', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Counts stamps: the stamp pass acquires the group mask once per eye it stamps. */
  function countStamps(): { readonly calls: readonly unknown[] } {
    return vi.spyOn(FogState.prototype, 'maskFor').mock;
  }

  /** Twelve idle civilians of one player in a row, one per two cells, out of idle chat: eyes that stay
   *  put. */
  function crowd(sim: Simulation): Entity[] {
    return Array.from({ length: 12 }, (_, i) => {
      const e = unit(sim, 2 * i, 2, P0);
      sim.world.add(e, ChatCooldown, { until: Number.MAX_SAFE_INTEGER });
      return e;
    });
  }

  it('CLASSIC: still eyes stamp once, and a rebuild stamps only the eye that moved', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    const eyes = crowd(sim);
    const stamps = countStamps();
    sim.run(1);
    expect(stamps.calls.length).toBe(eyes.length);
    sim.run(3 * VISION_CADENCE_TICKS);
    expect(stamps.calls.length).toBe(eyes.length); // three more rebuilds over an unchanged world
    const mover = eyes[0];
    if (mover === undefined) throw new Error('crowd is empty');
    teleport(sim, mover, 2, 6);
    sim.run(VISION_CADENCE_TICKS);
    expect(stamps.calls.length).toBe(eyes.length + 1);
    expect(rawState(sim, P0, 2, 6)).toBe(FOG_STATE.VISIBLE);
  });

  it('CLASSIC: a still scout whose eye widens stamps its new reach', () => {
    const sim = simOn(FOG_MODE.CLASSIC, 48, 8);
    const scout = unit(sim, 4, 4, P0, { jobType: SCOUT_JOB });
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, 19, 4)).toBe(FOG_STATE.UNEXPLORED);
    sim.world.mut(scout, SettlerProgress).experience.set(SCOUT_EXPERIENCE_TYPE, 100);
    sim.run(VISION_CADENCE_TICKS);
    expect(rawState(sim, P0, 19, 4)).toBe(FOG_STATE.VISIBLE);
  });

  it('CLASSIC: a still eye re-explores masks a switch OFF dropped', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    unit(sim, 2, 2, P0);
    sim.run(1);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.OFF });
    sim.run(1);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
  });

  it('the cache verifier reports a memoized footprint a write lowered behind the memo', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    crowd(sim);
    sim.run(1 + VISION_CADENCE_TICKS);
    expect(sim.world.verifyCaches()).toEqual([]);
    const mask = sim.fog?.tryMaskFor(P0);
    if (mask === undefined) throw new Error('P0 has no mask');
    mask[2 * (sim.fog?.cellsWide ?? 0) + 4] = FOG_STATE.EXPLORED; // the bug the verifier exists to catch
    expect(sim.world.verifyCaches().some((v) => v.startsWith('fog: eye'))).toBe(true);
  });

  it('fog of war: every eye restamps on every rebuild, since the downgrade lowered its ground', () => {
    const sim = simOn(FOG_MODE.CLASSIC_FOG_OF_WAR);
    const eyes = crowd(sim);
    const stamps = countStamps();
    sim.run(1 + 2 * VISION_CADENCE_TICKS);
    expect(stamps.calls.length).toBe(3 * eyes.length);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
  });
});

describe('fog generation - bumps only when a mask byte or the mode changed', () => {
  function generation(sim: Simulation): number {
    const fog = sim.fog;
    if (fog === undefined) throw new Error('mapless sim');
    return fog.generation;
  }

  it('CLASSIC: rebuilds over still eyes or explored ground keep it; new ground bumps it', () => {
    const sim = simOn(FOG_MODE.CLASSIC, 48, 8);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    const first = generation(sim);
    sim.run(3 * VISION_CADENCE_TICKS);
    expect(generation(sim)).toBe(first);
    teleport(sim, e, 40, 2);
    sim.run(VISION_CADENCE_TICKS);
    expect(generation(sim)).toBe(first + 1);
    teleport(sim, e, 2, 2); // back onto the ground its first stamp explored
    sim.run(VISION_CADENCE_TICKS);
    expect(generation(sim)).toBe(first + 1);
  });

  it('fog of war: the downgrade alone bumps it once the last eye is gone', () => {
    const sim = simOn(FOG_MODE.CLASSIC_FOG_OF_WAR);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    const seen = generation(sim);
    sim.world.destroy(e);
    sim.run(VISION_CADENCE_TICKS);
    expect(generation(sim)).toBe(seen + 1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.EXPLORED);
  });

  it('switching OFF bumps it', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    unit(sim, 2, 2, P0);
    sim.run(1);
    const classic = generation(sim);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.OFF });
    sim.run(1);
    expect(generation(sim)).toBeGreaterThan(classic);
  });

  it('a mode switch bumps it even when no byte moves', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    unit(sim, 2, 2, P0);
    sim.run(1);
    const classic = generation(sim);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
    sim.run(1);
    expect(generation(sim)).toBe(classic + 1);
  });
});

describe('fog modes - update rules over the per-player mask', () => {
  it('is the product of the two settings, OFF apart: every pair composes a mode that reads back', () => {
    expect(fogSettings(FOG_MODE.OFF)).toBeNull();
    const pairs: FogSettings[] = [
      { terrainKnown: false, fogOfWar: false },
      { terrainKnown: false, fogOfWar: true },
      { terrainKnown: true, fogOfWar: false },
      { terrainKnown: true, fogOfWar: true },
    ];
    const modes = pairs.map((pair) => fogModeOf(pair));
    expect(new Set(modes).size).toBe(pairs.length);
    for (const [i, pair] of pairs.entries()) expect(fogSettings(modes[i] ?? FOG_MODE.OFF)).toEqual(pair);
    expect(fogModeOf({ terrainKnown: false, fogOfWar: false })).toBe(FOG_MODE.CLASSIC); // the original
  });

  it('is OFF by default: no view, no masks, zero exploration', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(8, 4) });
    unit(sim, 2, 2, P0);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(fogMode(sim.world)).toBe(FOG_MODE.OFF);
    expect(sim.fogView(P0)).toBeNull();
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.UNEXPLORED);
  });

  it('skips an invalid mode (recoverable bad input, still logged)', () => {
    // Cast past FogMode on purpose: the point is what the command does with an id the union forbids,
    // which is exactly what a replayed/hand-built command stream can carry.
    const sim = simOn(9 as FogMode);
    sim.run(1);
    expect(fogMode(sim.world)).toBe(FOG_MODE.OFF);
    expect(sim.commands.log).toHaveLength(1); // logged for faithful replay
  });

  it('CLASSIC: explored ground stays fully visible after the eye moves away', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    const e = unit(sim, 2, 2, P0);
    sim.run(1); // tick 1: mode applied + first rebuild
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.UNEXPLORED); // far east - never seen
    teleport(sim, e, 20, 2);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.VISIBLE); // new ground seen
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE); // old ground STAYS visible (sticky)
  });

  it('CLASSIC + fog of war: the map starts black and ground the eye leaves falls back to explored', () => {
    const sim = simOn(FOG_MODE.CLASSIC_FOG_OF_WAR);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
    expect(sim.fogView(P0)?.stateAt(20, 2)).toBe(FOG_STATE.UNEXPLORED); // never seen: black
    teleport(sim, e, 20, 2);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.EXPLORED); // seen once, no current eye
    expect(sim.fogView(P0)?.stateAt(2, 2)).toBe(FOG_STATE.EXPLORED);
  });

  it('RECON + fog of war: the raw mask records what an eye saw but the view reads unexplored ground as explored', () => {
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.UNEXPLORED); // raw: never seen
    const view = sim.fogView(P0);
    expect(view).not.toBeNull();
    expect(view?.stateAt(20, 2)).toBe(FOG_STATE.EXPLORED); // view: terrain known from the start
    expect(view?.stateAt(2, 2)).toBe(FOG_STATE.VISIBLE);
    teleport(sim, e, 20, 2);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.EXPLORED); // known terrain, no current eye
  });

  it('RECON without fog of war: terrain known from the start, and ground once seen stays visible', () => {
    const sim = simOn(FOG_MODE.RECON);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    expect(sim.fogView(P0)?.stateAt(20, 2)).toBe(FOG_STATE.EXPLORED); // never seen, still known
    teleport(sim, e, 20, 2);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE); // sticky, as under CLASSIC
  });

  it('switching fog of war on lowers what no eye covers on the next rebuild; off leaves it', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    teleport(sim, e, 20, 2);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC_FOG_OF_WAR });
    sim.run(1); // a mode change rebuilds the same tick
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.EXPLORED);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.VISIBLE);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.EXPLORED); // history is kept, not re-raised
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('RECON + fog of war: a script reveal over ground an eye watched outlasts the eye and every downgrade', () => {
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
    const e = unit(sim, 2, 2, P0);
    sim.run(1); // the eye's stamp lands first: VISIBLE bytes the reveal then raises
    sim.fog?.revealArea(P0, { hx: 4, hy: 4 }, 2);
    teleport(sim, e, 20, 2);
    sim.run(2 * VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE); // revealed: the downgrade left it
    expect(rawState(sim, P0, 4, 2)).toBe(FOG_STATE.EXPLORED); // watched once, outside the reveal
    expect(sim.fogView(P0)?.stateAt(2, 2)).toBe(FOG_STATE.VISIBLE);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('masks are per PLAYER: one player exploring reveals nothing to the other', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    unit(sim, 2, 2, P0);
    unit(sim, 20, 2, P1);
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P1, 2, 2)).toBe(FOG_STATE.UNEXPLORED);
    expect(rawState(sim, P1, 20, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.UNEXPLORED);
  });

  it('switching OFF drops the masks; re-enabling starts exploration fresh', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
    teleport(sim, e, 20, 2);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.OFF });
    sim.run(1);
    expect(sim.fogView(P0)).toBeNull();
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.CLASSIC });
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.UNEXPLORED); // history gone - only the new spot shows
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.VISIBLE);
  });
});

describe('allied vision - mutual friends explore one mask while the rule is on', () => {
  const P2 = 2;
  const P4 = 4;
  const P5 = 5;
  const P6 = 6;
  /** P0 west, P1 east, 18 cells apart: neither civilian eye (6 cells) reaches the other's ground. */
  const WEST = { x: 2, y: 2 } as const;
  const EAST = { x: 20, y: 2 } as const;

  function alliedSim(mode: FogMode): Simulation {
    const sim = simOn(mode);
    allyVision(sim, P0, P1);
    unit(sim, WEST.x, WEST.y, P0);
    unit(sim, EAST.x, EAST.y, P1);
    return sim;
  }

  function unitOf(sim: Simulation, player: number): Entity {
    const found = [...sim.world.query(Owner)].find((e) => sim.world.get(e, Owner).player === player);
    if (found === undefined) throw new Error(`no unit of player ${player}`);
    return found;
  }

  function setStance(sim: Simulation, a: number, b: number, state: 'friend' | 'neutral' | 'enemy'): void {
    sim.enqueueSetup({ kind: 'setDiplomacy', from: a, to: b, state });
  }

  it('RECON + fog of war: what one eye sees now, every member sees, and ground it leaves stays known to all', () => {
    const sim = alliedSim(FOG_MODE.RECON_FOG_OF_WAR);
    sim.run(1);
    expect(rawState(sim, P0, EAST.x, EAST.y)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P2, WEST.x, WEST.y)).toBe(FOG_STATE.UNEXPLORED); // an outsider shares nothing
    teleport(sim, unitOf(sim, P1), (WEST.x + EAST.x) / 2, EAST.y); // 9 cells from either start, beyond both eyes
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, EAST.x, EAST.y)).toBe(FOG_STATE.EXPLORED);
    expect(rawState(sim, P1, EAST.x, EAST.y)).toBe(FOG_STATE.EXPLORED);
    expect(sim.fog?.groupsWithMasks()).toEqual([P0]); // one mask, keyed by the lowest member
  });

  it('CLASSIC: ground either member explored stays visible to both', () => {
    const sim = alliedSim(FOG_MODE.CLASSIC);
    sim.run(1);
    teleport(sim, unitOf(sim, P0), WEST.x + 8, WEST.y);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, EAST.x, EAST.y)).toBe(FOG_STATE.VISIBLE);
  });

  it('a contact one member makes is a contact of every member', () => {
    const sim = alliedSim(FOG_MODE.RECON_FOG_OF_WAR);
    unit(sim, EAST.x + 1, EAST.y, P2); // inside P1's eye alone
    sim.run(1);
    expect(sim.hasMetPlayer(P0, P2)).toBe(true);
    expect(sim.hasMetPlayer(P1, P2)).toBe(true);
    expect(sim.hasMetPlayer(P2, P0)).toBe(false); // P2 sees P1 alone
    expect(sim.hasMetPlayer(P2, P1)).toBe(true);
  });

  it('allying mid-game merges the masks: each keeps what either explored before', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    sim.enqueueSetup({ kind: 'setAlliedVision', enabled: true });
    unit(sim, WEST.x, WEST.y, P0);
    unit(sim, EAST.x, EAST.y, P1);
    sim.run(1);
    expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.UNEXPLORED);
    setStance(sim, P0, P1, 'friend');
    setStance(sim, P1, P0, 'friend');
    sim.run(VISION_CADENCE_TICKS);
    expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, EAST.x, EAST.y)).toBe(FOG_STATE.VISIBLE);
  });

  it.each(['neutral', 'enemy'] as const)(
    "turning %s splits the mask: the leaver keeps the memory but loses the former ally's live sight",
    (state) => {
      const sim = alliedSim(FOG_MODE.RECON_FOG_OF_WAR);
      sim.run(1);
      expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.VISIBLE);
      setStance(sim, P1, P0, state);
      sim.run(VISION_CADENCE_TICKS);
      expect(sim.fog?.visionGroupOf(P1)).toBe(P1);
      expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.EXPLORED);
      expect(rawState(sim, P0, WEST.x, WEST.y)).toBe(FOG_STATE.VISIBLE);
      expect(rawState(sim, P0, EAST.x, EAST.y)).toBe(FOG_STATE.EXPLORED);
      const middle = (WEST.x + EAST.x) / 2; // beyond both start eyes
      teleport(sim, unitOf(sim, P0), middle, WEST.y);
      sim.run(VISION_CADENCE_TICKS);
      expect(rawState(sim, P0, middle, WEST.y)).toBe(FOG_STATE.VISIBLE);
      expect(rawState(sim, P1, middle, WEST.y)).toBe(FOG_STATE.UNEXPLORED);
    },
  );

  it('CLASSIC: ground explored together stays fully visible to a member who turns hostile', () => {
    const sim = alliedSim(FOG_MODE.CLASSIC);
    sim.run(1);
    setStance(sim, P1, P0, 'enemy');
    sim.run(VISION_CADENCE_TICKS);
    expect(sim.fog?.visionGroupOf(P1)).toBe(P1);
    expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.VISIBLE);
    const middle = (WEST.x + EAST.x) / 2; // beyond both start eyes
    teleport(sim, unitOf(sim, P0), middle, WEST.y);
    sim.run(VISION_CADENCE_TICKS);
    expect(rawState(sim, P1, middle, WEST.y)).toBe(FOG_STATE.UNEXPLORED);
  });

  it('shares nothing while the rule is off or the friendship runs one way', () => {
    const offSim = simOn(FOG_MODE.CLASSIC);
    setStance(offSim, P0, P1, 'friend');
    setStance(offSim, P1, P0, 'friend');
    unit(offSim, WEST.x, WEST.y, P0);
    offSim.run(1);
    expect(rawState(offSim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.UNEXPLORED);

    const oneWay = simOn(FOG_MODE.CLASSIC);
    oneWay.enqueueSetup({ kind: 'setAlliedVision', enabled: true });
    setStance(oneWay, P0, P1, 'friend');
    unit(oneWay, WEST.x, WEST.y, P0);
    oneWay.run(1);
    expect(rawState(oneWay, P1, WEST.x, WEST.y)).toBe(FOG_STATE.UNEXPLORED);
  });

  it('switching the rule off splits every group at the next rebuild', () => {
    const sim = alliedSim(FOG_MODE.CLASSIC);
    sim.run(1);
    sim.enqueueSetup({ kind: 'setAlliedVision', enabled: false });
    sim.run(VISION_CADENCE_TICKS);
    expect(sim.fog?.sharedVisionGroups()).toEqual([]);
    expect(sim.fog?.groupsWithMasks()).toEqual([P0, P1]);
  });

  it('never joins a player to a group holding a player it is not allied with', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    allyVision(sim, P0, P1);
    allyVision(sim, P1, P2); // P0 and P2 stay enemies, the unset default
    allyVision(sim, P4, P5);
    allyVision(sim, P5, P6);
    allyVision(sim, P4, P6);
    sim.run(1);
    expect(sim.fog?.sharedVisionGroups()).toEqual([
      [P0, P1],
      [P4, P5, P6],
    ]);
    expect(sim.fog?.visionGroupOf(P2)).toBe(P2);
  });

  it('two same-seed allied runs reach the same state hash, unlike an unallied one', () => {
    const run = (allied: boolean): string => {
      const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
      if (allied) allyVision(sim, P0, P1);
      unit(sim, WEST.x, WEST.y, P0);
      unit(sim, EAST.x, EAST.y, P1);
      sim.run(VISION_CADENCE_TICKS * 2);
      return sim.hashState();
    };
    expect(run(true)).toBe(run(true));
    expect(run(true)).not.toBe(run(false));
  });
});

describe('first contact - the vision-driven discovery of other players', () => {
  // Geometry: a P0 scout at (2,2) and a P1 civilian 10 cells east at (12,2) - 680 px apart, inside the
  // scout's 884 px (26-node) eye but outside the civilian's 408 px (12-node) one, so only P0 sees P1.
  const SCOUT_AT = { x: 2, y: 2 } as const;
  const CIV_AT = { x: 12, y: 2 } as const;

  it('with fog off everyone reads discovered and no contact table is ever created', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), map: grassMap(24, 8) });
    unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0);
    unit(sim, CIV_AT.x, CIV_AT.y, P1);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(true);
    expect(sim.hasMetPlayer(P1, P0)).toBe(true);
    expect(sim.world.lowestEntityWith(PlayerContacts)).toBeNull(); // pre-contact hashes stay put
  });

  it('records a DIRECTED contact: the scout meets the civilian, not the other way round', () => {
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
    unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
    unit(sim, CIV_AT.x, CIV_AT.y, P1);
    sim.run(1); // mode applied + first rebuild, contacts settle with the masks
    expect(sim.hasMetPlayer(P0, P1)).toBe(true);
    expect(sim.hasMetPlayer(P1, P0)).toBe(false);
    expect(sim.hasMetPlayer(P0, P0)).toBe(true); // a player always knows itself
  });

  it('a contact never expires: it survives the eye leaving and a fog reset', () => {
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
    const civ = unit(sim, CIV_AT.x, CIV_AT.y, P1);
    unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
    sim.run(1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(true);

    teleport(sim, civ, 23, 7); // out of the scout's eye
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(true);

    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.OFF });
    sim.run(1);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON_FOG_OF_WAR });
    sim.run(1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(true); // masks reset, knowledge kept
  });

  it('meets a unit standing on ground explored earlier, out of sight now', () => {
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
    const scout = unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
    sim.run(1);
    teleport(sim, scout, 23, 7); // the start cells stay EXPLORED behind the scout
    sim.run(VISION_CADENCE_TICKS + 1);
    unit(sim, SCOUT_AT.x + 1, SCOUT_AT.y, P1);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(true);
  });

  it('meets no owner through a road site, even one in plain sight', () => {
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
    unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
    const site = cellAnchorNode(SCOUT_AT.x + 1, SCOUT_AT.y);
    sim.enqueueSetup({ kind: 'placeRoadSite', x: site.hx, y: site.hy, tribe: VIKING, owner: P1 });
    sim.run(VISION_CADENCE_TICKS + 1);
    expect([...sim.world.query(RoadSite)]).toHaveLength(1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(false);
  });

  it('skips an invalid owner slot instead of recording a contact for it', () => {
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
    unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
    unit(sim, SCOUT_AT.x + 1, SCOUT_AT.y, 99); // in plain sight, but not a valid player
    sim.run(1);
    expect(sim.world.lowestEntityWith(PlayerContacts)).toBeNull();
  });

  it('is deterministic: two same-seed runs with fog and contacts reach the same state hash', () => {
    const run = (): string => {
      const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
      unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
      unit(sim, CIV_AT.x, CIV_AT.y, P1);
      sim.run(VISION_CADENCE_TICKS * 3);
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('fog gates - combat auto-acquire and flee react only to SEEN enemies', () => {
  // Geometry shared by the gate tests: attacker at cell (2,2) (node (4,4)), enemy 7 cells east at
  // (9,2) (node (18,4)) - Manhattan node distance 14, INSIDE the 16-node combat sight radius but
  // 476 px east, OUTSIDE the attacker's eye: job 1 is an age class to the engine (5 nodes), and even a
  // civilian's 408 px (12-node) ellipse falls short. Without fog the drive fires;
  // under classic fog the enemy is unseen and it must not.
  const ATTACKER = { x: 2, y: 2 } as const;
  const ENEMY = { x: 9, y: 2 } as const;

  it('sanity: the enemy cell is within combat sight but outside the attacker vision', () => {
    const a = cellAnchorNode(ATTACKER.x, ATTACKER.y);
    const t = cellAnchorNode(ENEMY.x, ENEMY.y);
    const manhattan = Math.abs(a.hx - t.hx) + Math.abs(a.hy - t.hy);
    expect(manhattan).toBe(14);
    // Against the real constant, not a copy of its value: retuning sight must fail this precondition
    // rather than leave the sibling tests' geometry silently false.
    expect(manhattan).toBeLessThanOrEqual(SIGHT_RADIUS_NODES);
    expect((ENEMY.x - ATTACKER.x) * 68).toBeGreaterThan(CIVILIAN_VISION_NODES * 34);
  });

  it('ATTACK auto-acquire ignores an enemy in the fog - and engages it with fog off', () => {
    for (const [mode, engages] of [
      [FOG_MODE.CLASSIC, false],
      [FOG_MODE.OFF, true],
    ] as const) {
      const sim = simOn(mode);
      const attacker = unit(sim, ATTACKER.x, ATTACKER.y, P0, {
        jobType: WOODCUTTER,
        mode: MILITARY_MODE.ATTACK,
      });
      unit(sim, ENEMY.x, ENEMY.y, P1);
      sim.run(1);
      expect(sim.world.has(attacker, Engagement)).toBe(engages);
    }
  });

  it('an explicit attack order still chases a fog-hidden target (orders are ungated)', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    const attacker = unit(sim, ATTACKER.x, ATTACKER.y, P0, {
      jobType: WOODCUTTER,
      mode: MILITARY_MODE.ATTACK,
    });
    const enemy = unit(sim, ENEMY.x, ENEMY.y, P1);
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target: enemy });
    sim.run(1);
    expect(sim.world.has(attacker, AttackOrder)).toBe(true);
    expect(sim.world.has(attacker, Engagement)).toBe(true);
  });

  it('FLEE reacts only to a SEEN threat - and flees it with fog off', () => {
    for (const [mode, flees] of [
      [FOG_MODE.CLASSIC, false],
      [FOG_MODE.OFF, true],
    ] as const) {
      const sim = simOn(mode);
      const civ = unit(sim, ATTACKER.x, ATTACKER.y, P0, { mode: MILITARY_MODE.FLEE });
      unit(sim, ENEMY.x, ENEMY.y, P1, { mode: MILITARY_MODE.IGNORE });
      sim.run(FLEE_CHECK_STRIDE_TICKS); // a calm civilian looks once per stride
      expect(sim.world.has(civ, Fleeing)).toBe(flees);
    }
  });
});

describe('fog mask answer - the view a reader on another thread rebuilds', () => {
  const W = 24;
  const H = 8;
  /** Includes cells just outside the grid, which read UNEXPLORED raw. */
  const cellsAround = function* (): Generator<[number, number]> {
    for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) yield [x, y];
  };

  it('reads every cell as the live view does, the RECON mapping included, at the same generation', () => {
    for (const mode of [FOG_MODE.CLASSIC, FOG_MODE.RECON_FOG_OF_WAR]) {
      const sim = simOn(mode, W, H);
      unit(sim, 2, 2, P0);
      sim.run(1);
      const live = sim.fogView(P0);
      const answer = sim.fogMaskAnswer(P0);
      if (live === null || answer === null) throw new Error('fog is on, so both views exist');
      const view = fogViewOfMask(answer);
      expect([view.player, view.mode, view.generation]).toEqual([P0, mode, live.generation]);
      for (const [x, y] of cellsAround()) expect(view.stateAt(x, y)).toBe(live.stateAt(x, y));
      expect(view.stateAt(20, 2)).toBe(
        mode === FOG_MODE.RECON_FOG_OF_WAR ? FOG_STATE.EXPLORED : FOG_STATE.UNEXPLORED,
      );
    }
  });

  it('copies the mask, so a later rebuild leaves an answer as it was taken', () => {
    const sim = simOn(FOG_MODE.CLASSIC, W, H);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    const answer = sim.fogMaskAnswer(P0);
    teleport(sim, e, 20, 2);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(sim.fogView(P0)?.stateAt(20, 2)).toBe(FOG_STATE.VISIBLE);
    expect(answer === null ? null : fogViewOfMask(answer).stateAt(20, 2)).toBe(FOG_STATE.UNEXPLORED);
  });

  it('is null with fog off, as the live view', () => {
    const sim = simOn(FOG_MODE.OFF, W, H);
    sim.run(1);
    expect(sim.fogMaskAnswer(P0)).toBeNull();
  });
});
