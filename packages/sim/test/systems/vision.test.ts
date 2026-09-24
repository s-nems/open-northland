import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AttackOrder,
  addPerson,
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
  Settler,
  Signpost,
  Stance,
} from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, Simulation } from '../../src/index.js';
import { FLEE_CHECK_STRIDE_TICKS } from '../../src/systems/conflict/flee.js';
import { SIGHT_RADIUS_NODES } from '../../src/systems/conflict/targeting.js';
import { SCOUT_EXPERIENCE_TYPE } from '../../src/systems/progression/index.js';
import { MILITARY_MODE, type MilitaryMode } from '../../src/systems/readviews/index.js';
import {
  BUILDING_VISION_NODES,
  CIVILIAN_VISION_NODES,
  FOG_STATE,
  FogState,
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
 * The fog layer (systems/vision.ts): per-player masks over the cell grid, the modes' update rules
 * (OFF revealed; the map setting: CLASSIC black start / RECON known terrain; fog of war: sticky sight
 * without it, a downgrade with it), the OFF default + reset, and the combat/flee fog gates. Authored
 * throughout, radii included (no readable fog source), so these tests pin self-consistency, not
 * original fidelity.
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

/** The raw mask state of visual cell (x,y) for a player (bypasses the known-terrain view mapping). */
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
    const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR, 48, 8);
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

describe('stamp memo - an eye whose footprint did not change writes nothing', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Counts stamps: the stamp pass acquires the group mask once per eye it stamps. */
  function countStamps(): { readonly calls: readonly unknown[] } {
    return vi.spyOn(FogState.prototype, 'maskFor').mock;
  }

  /** Twelve signposts of one player in a row, one per two cells: eyes that never move by themselves. */
  function crowd(sim: Simulation): Entity[] {
    return Array.from({ length: 12 }, (_, i) => {
      const e = sim.world.create();
      sim.world.add(e, Position, { x: fx.fromInt(2 * i), y: fx.fromInt(2) });
      sim.world.add(e, Owner, { player: P0 });
      sim.world.add(e, Signpost, { links: [] });
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
    sim.world.mut(scout, Settler).experience.set(SCOUT_EXPERIENCE_TYPE, 100);
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

  it('fog of war: every eye restamps on every rebuild, since the downgrade lowered its ground', () => {
    const sim = simOn(FOG_MODE.CLASSIC_FOG_OF_WAR);
    const eyes = crowd(sim);
    const stamps = countStamps();
    sim.run(1 + 2 * VISION_CADENCE_TICKS);
    expect(stamps.calls.length).toBe(3 * eyes.length);
    expect(rawState(sim, P0, 2, 2)).toBe(FOG_STATE.VISIBLE);
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

describe('shared vision - players a setSharedVision command joined explore one mask', () => {
  const P2 = 2;
  /** P0 west, P1 east, 18 cells apart: neither civilian eye (6 cells) reaches the other's ground. */
  const WEST = { x: 2, y: 2 } as const;
  const EAST = { x: 20, y: 2 } as const;

  function sharedSim(mode: FogMode): Simulation {
    const sim = simOn(mode);
    sim.enqueueSetup({ kind: 'setSharedVision', players: [P0, P1] });
    unit(sim, WEST.x, WEST.y, P0);
    unit(sim, EAST.x, EAST.y, P1);
    return sim;
  }

  it('RECON + fog of war: what one eye sees now, every member sees, and ground it leaves stays known to all', () => {
    const sim = sharedSim(FOG_MODE.RECON_FOG_OF_WAR);
    sim.run(1);
    expect(rawState(sim, P0, EAST.x, EAST.y)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P2, WEST.x, WEST.y)).toBe(FOG_STATE.UNEXPLORED); // an outsider shares nothing
    const east = [...sim.world.query(Owner)].find((e) => sim.world.get(e, Owner).player === P1);
    if (east === undefined) throw new Error('east unit missing');
    teleport(sim, east, (WEST.x + EAST.x) / 2, EAST.y); // 9 cells from either start, beyond both eyes
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P0, EAST.x, EAST.y)).toBe(FOG_STATE.EXPLORED);
    expect(rawState(sim, P1, EAST.x, EAST.y)).toBe(FOG_STATE.EXPLORED);
    expect(sim.fog?.groupsWithMasks()).toEqual([P0]); // one mask, keyed by the lowest member
  });

  it('CLASSIC: ground either member explored stays visible to both', () => {
    const sim = sharedSim(FOG_MODE.CLASSIC);
    sim.run(1);
    const west = [...sim.world.query(Owner)].find((e) => sim.world.get(e, Owner).player === P0);
    if (west === undefined) throw new Error('west unit missing');
    teleport(sim, west, WEST.x + 8, WEST.y);
    sim.run(VISION_CADENCE_TICKS + 1);
    expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.VISIBLE);
    expect(rawState(sim, P0, EAST.x, EAST.y)).toBe(FOG_STATE.VISIBLE);
  });

  it('a contact one member makes is a contact of every member', () => {
    const sim = sharedSim(FOG_MODE.RECON_FOG_OF_WAR);
    unit(sim, EAST.x + 1, EAST.y, P2); // inside P1's eye alone
    sim.run(1);
    expect(sim.hasMetPlayer(P0, P2)).toBe(true);
    expect(sim.hasMetPlayer(P1, P2)).toBe(true);
    expect(sim.hasMetPlayer(P2, P0)).toBe(false); // P2 sees P1 alone
    expect(sim.hasMetPlayer(P2, P1)).toBe(true);
  });

  it('joining after exploration drops the masks, so exploration restarts under the new grouping', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    const e = unit(sim, WEST.x, WEST.y, P0);
    sim.run(1);
    teleport(sim, e, WEST.x + 8, WEST.y);
    sim.enqueueSetup({ kind: 'setSharedVision', players: [P0, P1] });
    sim.run(1);
    expect(rawState(sim, P1, WEST.x, WEST.y)).toBe(FOG_STATE.UNEXPLORED);
    expect(rawState(sim, P1, WEST.x + 8, WEST.y)).toBe(FOG_STATE.VISIBLE);
  });

  it('skips invalid slots and a lone player, and merges an overlapping later group', () => {
    const sim = simOn(FOG_MODE.CLASSIC);
    sim.enqueueSetup({ kind: 'setSharedVision', players: [P1, 99] });
    sim.enqueueSetup({ kind: 'setSharedVision', players: [P1, P2] });
    sim.enqueueSetup({ kind: 'setSharedVision', players: [P2, 5] });
    sim.run(1);
    const fog = sim.fog;
    if (fog === undefined) throw new Error('mapless sim');
    expect(fog.visionGroupOf(P0)).toBe(P0);
    expect(fog.visionGroupOf(5)).toBe(P1);
    expect(fog.visionGroupMembers(P1)).toEqual([P1, P2, 5]);
    expect(fog.sharedVisionGroups()).toEqual([[P1, P2, 5]]);
  });

  it('two same-seed runs with shared vision reach the same state hash, unlike an unshared one', () => {
    const run = (shared: boolean): string => {
      const sim = simOn(FOG_MODE.RECON_FOG_OF_WAR);
      if (shared) sim.enqueueSetup({ kind: 'setSharedVision', players: [P0, P1] });
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
      [FOG_MODE.CLASSIC, false],
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
    const sim = simOn(FOG_MODE.CLASSIC);
    const attacker = unit(sim, ATTACKER.x, ATTACKER.y, P0, { mode: MILITARY_MODE.ATTACK });
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
