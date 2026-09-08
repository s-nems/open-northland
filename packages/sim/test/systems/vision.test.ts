import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  addPerson,
  Engagement,
  Fleeing,
  FOG_MODE,
  type FogMode,
  fogMode,
  Health,
  Owner,
  PlayerContacts,
  Position,
  Settler,
  Stance,
} from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, Simulation } from '../../src/index.js';
import { SIGHT_RADIUS_NODES } from '../../src/systems/conflict/targeting.js';
import { SCOUT_EXPERIENCE_TYPE } from '../../src/systems/progression/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import {
  BUILDING_VISION_NODES,
  CIVILIAN_VISION_NODES,
  FOG_STATE,
  HUNTER_VISION_NODES,
  SCOUT_VISION_NODES,
  SOLDIER_VISION_NODES,
  stampVision,
  VISION_CADENCE_TICKS,
  visionRadiusForJob,
} from '../../src/systems/vision/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The fog-of-war layer (systems/vision.ts): per-player masks over the cell grid, the three modes'
 * update rules (OFF revealed / REVEAL sticky / RECON known-terrain), the OFF default + reset, and
 * the combat/flee fog gates. Authored throughout, radii included (no readable fog source), so these
 * tests pin self-consistency, not original fidelity.
 */

const VIKING = 1;
const WOODCUTTER = 1; // fixture job 1 - carries test_axe (band [1,2]); a civilian eye
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
    jobType: opts.jobType === undefined ? WOODCUTTER : opts.jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
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

/** The raw mask state of visual cell (x,y) for a player (bypasses RECON's view mapping). */
function rawState(sim: Simulation, player: number, x: number, y: number): number {
  const fog = sim.fog;
  if (fog === undefined) throw new Error('mapless sim');
  return fog.stateAt(player, x, y);
}

describe('vision radii - the per-job classification', () => {
  it('orders the eyes: scout > soldier > building > hunter > civilian', () => {
    const content = testContent();
    expect(visionRadiusForJob(content, SCOUT_JOB)).toBe(SCOUT_VISION_NODES);
    expect(visionRadiusForJob(content, 31)).toBe(SOLDIER_VISION_NODES); // first soldier
    expect(visionRadiusForJob(content, 45)).toBe(SOLDIER_VISION_NODES); // a hero
    expect(visionRadiusForJob(content, 15)).toBe(HUNTER_VISION_NODES); // hunter
    expect(visionRadiusForJob(content, WOODCUTTER)).toBe(CIVILIAN_VISION_NODES);
    expect(visionRadiusForJob(content, null)).toBe(CIVILIAN_VISION_NODES); // jobless / child
    expect(SCOUT_VISION_NODES).toBeGreaterThan(SOLDIER_VISION_NODES);
    expect(SOLDIER_VISION_NODES).toBeGreaterThan(HUNTER_VISION_NODES);
    expect(HUNTER_VISION_NODES).toBeGreaterThan(CIVILIAN_VISION_NODES);
    expect(BUILDING_VISION_NODES).toBeGreaterThan(HUNTER_VISION_NODES);
  });
});

describe('scout experience - the signpost craft widens the eye', () => {
  it('a mastered scout sees cells a fresh scout cannot (the visionRadiusOf wiring)', () => {
    const sim = simOn(FOG_MODE.RECON, 48, 8);
    const scout = unit(sim, 4, 4, P0, { jobType: SCOUT_JOB });
    for (let t = 0; t <= VISION_CADENCE_TICKS + 1; t++) sim.step();
    // 15 cells (30 nodes) east: beyond the base 26-node eye, inside mastery's +6.
    expect(rawState(sim, P0, 19, 4)).not.toBe(FOG_STATE.VISIBLE);

    sim.world.mut(scout, Settler).experience.set(SCOUT_EXPERIENCE_TYPE, 100); // mastery: the full cap
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

describe('fog modes - update rules over the per-player mask', () => {
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

  it('REVEAL: explored ground stays fully visible after the eye moves away', () => {
    const sim = simOn(FOG_MODE.REVEAL);
    const e = unit(sim, 2, 2, P0);
    sim.run(1); // tick 1: mode applied + first rebuild
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.UNEXPLORED); // far east - never seen
    teleport(sim, e, 20, 2);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.VISIBLE); // new ground seen
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE); // old ground STAYS visible (sticky)
  });

  it('RECON: the raw mask stays tri-state but the view reads unexplored ground as explored', () => {
    const sim = simOn(FOG_MODE.RECON);
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

  it('masks are per PLAYER: one player exploring reveals nothing to the other', () => {
    const sim = simOn(FOG_MODE.REVEAL);
    unit(sim, 2, 2, P0);
    unit(sim, 20, 2, P1);
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P1, 2, 2)).toBe(FOG_STATE.UNEXPLORED);
    expect(rawState(sim, P1, 20, 2)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.UNEXPLORED);
  });

  it('switching OFF drops the masks; re-enabling starts exploration fresh', () => {
    const sim = simOn(FOG_MODE.REVEAL);
    const e = unit(sim, 2, 2, P0);
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
    teleport(sim, e, 20, 2);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.OFF });
    sim.run(1);
    expect(sim.fogView(P0)).toBeNull();
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.REVEAL });
    sim.run(1);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.UNEXPLORED); // history gone - only the new spot shows
    expect(rawState(sim, P0, 20, 2)).toBe(FOG_STATE.VISIBLE);
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
    const sim = simOn(FOG_MODE.RECON);
    unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
    unit(sim, CIV_AT.x, CIV_AT.y, P1);
    sim.run(1); // mode applied + first rebuild, contacts settle with the masks
    expect(sim.hasMetPlayer(P0, P1)).toBe(true);
    expect(sim.hasMetPlayer(P1, P0)).toBe(false);
    expect(sim.hasMetPlayer(P0, P0)).toBe(true); // a player always knows itself
  });

  it('a contact never expires: it survives the eye leaving and a fog reset', () => {
    const sim = simOn(FOG_MODE.RECON);
    const civ = unit(sim, CIV_AT.x, CIV_AT.y, P1);
    unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
    sim.run(1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(true);

    teleport(sim, civ, 23, 7); // out of the scout's eye
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(true);

    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.OFF });
    sim.run(1);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
    sim.run(1);
    expect(sim.hasMetPlayer(P0, P1)).toBe(true); // masks reset, knowledge kept
  });

  it('skips an invalid owner slot instead of recording a contact for it', () => {
    const sim = simOn(FOG_MODE.RECON);
    unit(sim, SCOUT_AT.x, SCOUT_AT.y, P0, { jobType: SCOUT_JOB });
    unit(sim, SCOUT_AT.x + 1, SCOUT_AT.y, 99); // in plain sight, but not a valid player
    sim.run(1);
    expect(sim.world.lowestEntityWith(PlayerContacts)).toBeNull();
  });

  it('is deterministic: two same-seed runs with fog and contacts reach the same state hash', () => {
    const run = (): string => {
      const sim = simOn(FOG_MODE.RECON);
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
  // 476 px east, OUTSIDE the civilian 408 px (12-node) vision ellipse. Without fog the drive fires;
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
      [FOG_MODE.REVEAL, false],
      [FOG_MODE.OFF, true],
    ] as const) {
      const sim = simOn(mode);
      const attacker = unit(sim, ATTACKER.x, ATTACKER.y, P0, { mode: MILITARY_MODE.ATTACK });
      unit(sim, ENEMY.x, ENEMY.y, P1);
      sim.run(1);
      expect(sim.world.has(attacker, Engagement)).toBe(engages);
    }
  });

  it('an explicit attack order still chases a fog-hidden target (orders are ungated)', () => {
    const sim = simOn(FOG_MODE.REVEAL);
    const attacker = unit(sim, ATTACKER.x, ATTACKER.y, P0, { mode: MILITARY_MODE.ATTACK });
    const enemy = unit(sim, ENEMY.x, ENEMY.y, P1);
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target: enemy });
    sim.run(1);
    expect(sim.world.has(attacker, AttackOrder)).toBe(true);
    expect(sim.world.has(attacker, Engagement)).toBe(true);
  });

  it('FLEE reacts only to a SEEN threat - and flees it with fog off', () => {
    for (const [mode, flees] of [
      [FOG_MODE.REVEAL, false],
      [FOG_MODE.OFF, true],
    ] as const) {
      const sim = simOn(mode);
      const civ = unit(sim, ATTACKER.x, ATTACKER.y, P0, { mode: MILITARY_MODE.FLEE });
      unit(sim, ENEMY.x, ENEMY.y, P1, { mode: MILITARY_MODE.IGNORE });
      sim.run(1);
      expect(sim.world.has(civ, Fleeing)).toBe(flees);
    }
  });
});
