import { describe, expect, it } from 'vitest';
import {
  CurrentAtomic,
  ErectSignpostOrder,
  FOG_MODE,
  Owner,
  Position,
  Settler,
  SIGNPOST_NAV_RADIUS_NODES,
  SIGNPOST_SPACING_RADIUS_NODES,
  Signpost,
} from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { BUILD_GUIDE_ATOMIC_ID, canPlaceSignpost, signpostNetwork } from '../../src/systems/index.js';
import { FOG_STATE } from '../../src/systems/vision/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';
import { stampPost } from './support.js';

/**
 * The scout's signpost (the original's guidepost): erected by the one-shot build-guide hammer swing
 * (jobtypes.ini scout `allowatomic 43`), instant and free; blocks building placement on its cell but
 * never movement; keeps a minimum-spacing circle from same-player posts; watches its navigation circle
 * as a standing fog eye. Radii are named approximations (the original's values live only in the exe).
 */

const VIKING = 1;
const SCOUT = 27; // fixture job 27 — allowatomic 43 only, like the original scout
const WOODCUTTER = 1;
const P0 = 0;

function makeUnit(sim: Simulation, x: number, y: number, jobType: number, player = P0): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player });
  return e;
}

function signposts(sim: Simulation): Entity[] {
  return [...sim.world.query(Signpost)];
}

/** Step until a signpost exists (or the budget runs out) and return the tick count used. */
function stepUntilSignpost(sim: Simulation, budget: number): number {
  for (let t = 0; t < budget; t++) {
    sim.step();
    if (signposts(sim).length > 0) return t + 1;
  }
  return budget;
}

function freshSim(w = 32, h = 8): Simulation {
  return new Simulation({ seed: 3, content: testContent(), map: grassMap(w, h) });
}

describe('placeSignpost — the scout erects a guidepost', () => {
  it('a scout standing at the goal swings the build-guide hammer once and the signpost appears', () => {
    const sim = freshSim();
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueue({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 }); // the scout's own node
    let sawSwing = false;
    for (let t = 0; t < 60 && signposts(sim).length === 0; t++) {
      sim.step();
      if (sim.world.tryGet(scout, CurrentAtomic)?.atomicId === BUILD_GUIDE_ATOMIC_ID) sawSwing = true;
    }
    expect(sawSwing).toBe(true); // the erect goes through the hammer atomic, not an instant conjure
    const posts = signposts(sim);
    expect(posts.length).toBe(1);
    const post = posts[0] as Entity;
    expect(sim.world.get(post, Owner).player).toBe(P0);
    expect(sim.world.get(post, Signpost).navRadius).toBe(SIGNPOST_NAV_RADIUS_NODES);
    expect(sim.world.has(scout, ErectSignpostOrder)).toBe(false); // the order retired with the swing
  });

  it('a scout walks to a distant goal first, then erects there', () => {
    const sim = freshSim();
    const scout = makeUnit(sim, 2, 2, SCOUT);
    sim.enqueue({ kind: 'placeSignpost', entity: scout, x: 16, y: 4 }); // 4 tiles east of the scout
    stepUntilSignpost(sim, 400);
    const posts = signposts(sim);
    expect(posts.length).toBe(1);
    const p = sim.world.get(posts[0] as Entity, Position);
    expect(fx.toInt(p.x)).toBe(8); // node (16,4) = tile (8,2)
  });

  it('a non-scout issuer is skipped', () => {
    const sim = freshSim();
    const woodcutter = makeUnit(sim, 4, 2, WOODCUTTER);
    sim.enqueue({ kind: 'placeSignpost', entity: woodcutter, x: 8, y: 4 });
    for (let t = 0; t < 40; t++) sim.step();
    expect(signposts(sim).length).toBe(0);
  });

  it('rejects a second same-player post inside the spacing circle, accepts one beyond it', () => {
    const sim = freshSim(96, 8);
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueue({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    stepUntilSignpost(sim, 60);
    expect(signposts(sim).length).toBe(1);

    // Inside the spacing radius (a few nodes away) — the command is skipped outright.
    const near = makeUnit(sim, 6, 2, SCOUT);
    sim.enqueue({ kind: 'placeSignpost', entity: near, x: 12, y: 4 });
    for (let t = 0; t < 60; t++) sim.step();
    expect(signposts(sim).length).toBe(1);

    // Beyond the spacing radius — a second post rises.
    const far = makeUnit(sim, 4 + SIGNPOST_SPACING_RADIUS_NODES, 2, SCOUT);
    sim.enqueue({ kind: 'placeSignpost', entity: far, x: 8 + 2 * SIGNPOST_SPACING_RADIUS_NODES, y: 4 });
    for (let t = 0; t < 400 && signposts(sim).length < 2; t++) sim.step();
    expect(signposts(sim).length).toBe(2);
  });

  it('canPlaceSignpost rejects the spacing circle only for the SAME player', () => {
    const sim = freshSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueue({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    stepUntilSignpost(sim, 60);
    const nearby = terrain.nodeAt(12, 4);
    expect(canPlaceSignpost(sim.world, ctxOf(sim), terrain, nearby, P0)).toBe(false);
    expect(canPlaceSignpost(sim.world, ctxOf(sim), terrain, nearby, 1)).toBe(true); // a rival may crowd it
  });

  it('signpostProbe agrees with canPlaceSignpost node by node (the overlay seam)', () => {
    const sim = freshSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueue({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    stepUntilSignpost(sim, 60);
    const probe = sim.signpostProbe(P0);
    if (probe === null) throw new Error('mapped sim has a probe');
    // A band around the standing post: inside the spacing circle, on its cell, and beyond — the probe
    // must answer exactly what the command gate would.
    for (let y = 0; y < 8; y += 2) {
      for (let x = 0; x < 48; x += 2) {
        const expected = canPlaceSignpost(sim.world, ctxOf(sim), terrain, terrain.nodeAt(x, y), P0);
        expect(probe.canPlace(x, y), `node (${x},${y})`).toBe(expected);
      }
    }
    expect(probe.canPlace(-1, 0)).toBe(false); // off-map never places
  });

  it('demolishSignpost tears a post down (freeing its spacing circle); a non-signpost target is skipped', () => {
    const sim = freshSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueue({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    stepUntilSignpost(sim, 60);
    const post = signposts(sim)[0];
    if (post === undefined) throw new Error('post erected');
    const nearby = terrain.nodeAt(10, 4);
    expect(canPlaceSignpost(sim.world, ctxOf(sim), terrain, nearby, P0)).toBe(false);

    // Aiming at the scout is a skip, never a destroy — the kind gate.
    sim.enqueue({ kind: 'demolishSignpost', signpost: scout });
    sim.step();
    expect(sim.world.has(scout, Settler)).toBe(true);
    expect(signposts(sim).length).toBe(1);

    sim.enqueue({ kind: 'demolishSignpost', signpost: post });
    sim.step();
    expect(signposts(sim).length).toBe(0);
    // The spacing circle fell with the post — the spot is placeable again.
    expect(canPlaceSignpost(sim.world, ctxOf(sim), terrain, nearby, P0)).toBe(true);
  });
});

describe('signpostNetwork — connected groups', () => {
  /** Stamp a signpost directly (the fixture idiom) at tile (x,y) with the given nav radius. */
  it('overlapping circles join one group; a distant post forms its own', () => {
    const sim = freshSim(96, 8);
    // Tiles are 2 nodes wide: posts at tiles 2 and 10 are 16 nodes apart — overlapping at radius 10.
    const a = stampPost(sim, 2, 2, 10);
    const b = stampPost(sim, 10, 2, 10);
    const far = stampPost(sim, 40, 2, 10); // 60+ nodes away — disconnected
    const posts = signpostNetwork(sim.world).get(P0) ?? [];
    const groupOf = new Map(posts.map((s) => [s.entity, s.group]));
    expect(groupOf.get(a)).toBe(groupOf.get(b));
    expect(groupOf.get(far)).not.toBe(groupOf.get(a));
  });

  it('players never share a network', () => {
    const sim = freshSim();
    stampPost(sim, 2, 2, 10, 0);
    stampPost(sim, 3, 2, 10, 1);
    expect(signpostNetwork(sim.world).get(0)?.length).toBe(1);
    expect(signpostNetwork(sim.world).get(1)?.length).toBe(1);
  });
});

describe('signpost fog vision — the permanent recon reveal', () => {
  it('a standing signpost keeps its circle VISIBLE in RECON with no unit nearby', () => {
    const sim = freshSim(64, 16);
    sim.enqueue({ kind: 'setFogMode', mode: FOG_MODE.RECON });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(8), y: fx.fromInt(8) });
    sim.world.add(e, Owner, { player: P0 });
    sim.world.add(e, Signpost, {
      navRadius: SIGNPOST_NAV_RADIUS_NODES,
      spacingRadius: SIGNPOST_SPACING_RADIUS_NODES,
    });
    for (let t = 0; t < 12; t++) sim.step(); // past a couple of vision cadences
    const view = sim.fogView(P0);
    expect(view?.stateAt(8, 8)).toBe(FOG_STATE.VISIBLE); // the post's own cell
    expect(view?.stateAt(60, 8)).toBe(FOG_STATE.EXPLORED); // far ground stays recon-grey
  });
});
