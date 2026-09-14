import { describe, expect, it } from 'vitest';
import {
  addPerson,
  CurrentAtomic,
  ErectSignpostOrder,
  FOG_MODE,
  Owner,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  SIGNPOST_SPACING_NODES,
  Signpost,
} from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import {
  BUILD_GUIDE_ATOMIC_ID,
  canPlaceSignpost,
  SCOUT_EXPERIENCE_TYPE,
  signpostNetwork,
} from '../../src/systems/index.js';
import { FOG_STATE } from '../../src/systems/vision/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap, waterColumnMap } from '../fixtures/terrain.js';
import { stampPost } from './support.js';

/**
 * The scout's signpost (the original's guidepost): erected by the one-shot build-guide hammer swing
 * (jobtypes.ini scout `allowatomic 43`), instant and free; blocks building placement on its cell but
 * never movement; keeps the original's minimum spacing from same-player posts and links to those the
 * ground joins it to inside the link range; watches an authored fog circle as a standing eye.
 */

const VIKING = 1;
const SCOUT = 27; // fixture job 27 - allowatomic 43 only, like the original scout
const WOODCUTTER = 1;
const P0 = 0;

function makeUnit(sim: Simulation, x: number, y: number, jobType: number, player = P0): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
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

describe('placeSignpost - the scout erects a guidepost', () => {
  it('a scout standing at the goal swings the build-guide hammer once and the signpost appears', () => {
    const sim = freshSim();
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 }); // the scout's own node
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
    expect(sim.world.get(post, Signpost).links).toEqual([]); // the first post of a network
    expect(sim.world.has(scout, ErectSignpostOrder)).toBe(false); // the order retired with the swing
    // The erected post trained the scout's signpost craft (1 XP per standing post).
    expect(sim.world.get(scout, Settler).experience.get(SCOUT_EXPERIENCE_TYPE)).toBe(1);
  });

  it('a scout walks to a distant goal first, then erects there', () => {
    const sim = freshSim();
    const scout = makeUnit(sim, 2, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 16, y: 4 }); // 4 tiles east of the scout
    stepUntilSignpost(sim, 400);
    const posts = signposts(sim);
    expect(posts.length).toBe(1);
    const p = sim.world.get(posts[0] as Entity, Position);
    expect(fx.toInt(p.x)).toBe(8); // node (16,4) = tile (8,2)
  });

  it('a signpost walk whose route fails drops the errand without reporting the scout lost', () => {
    const sim = freshSim();
    const scout = makeUnit(sim, 2, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 16, y: 4 });
    sim.step();
    expect(sim.world.has(scout, ErectSignpostOrder)).toBe(true);
    const goal = sim.world.get(scout, ErectSignpostOrder).goal;
    sim.world.add(scout, PathRequest, { start: goal, goal, failed: true });
    sim.step();
    expect(sim.world.has(scout, PlayerOrder)).toBe(false);
    expect(sim.world.has(scout, ErectSignpostOrder)).toBe(false);
    expect(sim.events.current()).not.toContainEqual({ kind: 'settlerGoalUnreachable', entity: scout });
  });

  it('a non-scout issuer is skipped', () => {
    const sim = freshSim();
    const woodcutter = makeUnit(sim, 4, 2, WOODCUTTER);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: woodcutter, x: 8, y: 4 });
    for (let t = 0; t < 40; t++) sim.step();
    expect(signposts(sim).length).toBe(0);
  });

  it('rejects a second same-player post inside the spacing, accepts one at it and links the pair', () => {
    const sim = freshSim(96, 8);
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    stepUntilSignpost(sim, 60);
    expect(signposts(sim).length).toBe(1);

    // Inside the spacing (a few nodes away) - the command is skipped outright.
    const near = makeUnit(sim, 6, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: near, x: 12, y: 4 });
    for (let t = 0; t < 60; t++) sim.step();
    expect(signposts(sim).length).toBe(1);

    // Exactly the spacing away - a second post rises, inside the link range of the first.
    const far = makeUnit(sim, 4 + SIGNPOST_SPACING_NODES / 2, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: far, x: 8 + SIGNPOST_SPACING_NODES, y: 4 });
    for (let t = 0; t < 400 && signposts(sim).length < 2; t++) sim.step();
    const [first, second] = signposts(sim);
    if (first === undefined || second === undefined) throw new Error('two posts stand');
    expect(sim.world.get(first, Signpost).links).toEqual([second]);
    expect(sim.world.get(second, Signpost).links).toEqual([first]);
  });

  it('canPlaceSignpost rejects the spacing only for the SAME player', () => {
    const sim = freshSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
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
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    stepUntilSignpost(sim, 60);
    const probe = sim.signpostProbe(P0);
    if (probe === null) throw new Error('mapped sim has a probe');
    // A band around the standing post: inside the spacing, on its cell, and beyond - the probe must
    // answer exactly what the command gate would.
    for (let y = 0; y < 8; y += 2) {
      for (let x = 0; x < 48; x += 2) {
        const expected = canPlaceSignpost(sim.world, ctxOf(sim), terrain, terrain.nodeAt(x, y), P0);
        expect(probe.canPlace(x, y), `node (${x},${y})`).toBe(expected);
      }
    }
    expect(probe.canPlace(-1, 0)).toBe(false); // off-map never places
  });

  it("demolishSignpost tears a post down, freeing its spacing and its neighbours' links; a non-signpost target is skipped", () => {
    const sim = freshSim(64, 8);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const scout = makeUnit(sim, 4, 2, SCOUT);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 8, y: 4 });
    stepUntilSignpost(sim, 60);
    const post = signposts(sim)[0];
    if (post === undefined) throw new Error('post erected');
    const neighbour = stampPost(sim, 14, 2);
    expect(sim.world.get(neighbour, Signpost).links).toEqual([post]);
    const nearby = terrain.nodeAt(10, 4);
    expect(canPlaceSignpost(sim.world, ctxOf(sim), terrain, nearby, P0)).toBe(false);

    // Aiming at the scout is a skip, never a destroy - the kind gate.
    sim.enqueueSetup({ kind: 'demolishSignpost', signpost: scout });
    sim.step();
    expect(sim.world.has(scout, Settler)).toBe(true);
    expect(signposts(sim).length).toBe(2);

    sim.enqueueSetup({ kind: 'demolishSignpost', signpost: post });
    sim.step();
    expect(signposts(sim)).toEqual([neighbour]);
    expect(sim.world.get(neighbour, Signpost).links).toEqual([]);
    // The spacing fell with the post - the spot is placeable again.
    expect(canPlaceSignpost(sim.world, ctxOf(sim), terrain, nearby, P0)).toBe(true);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const erect = (): { hash: string; erected: boolean } => {
      const sim = freshSim();
      const scout = makeUnit(sim, 2, 2, SCOUT);
      sim.enqueueSetup({ kind: 'placeSignpost', entity: scout, x: 16, y: 4 });
      stepUntilSignpost(sim, 400);
      return { hash: sim.hashState(), erected: signposts(sim).length === 1 };
    };
    const a = erect();
    const b = erect();
    expect(a.erected).toBe(true); // the walk and the swing really ran (not a vacuous hash)
    expect(a.hash).toBe(b.hash);
  });
});

describe('signpostNetwork - connected groups', () => {
  it('posts inside the link range join one group; a post past it forms its own', () => {
    const sim = freshSim(96, 8);
    // Tiles are 2 nodes wide: posts at tiles 2 and 20 are 36 nodes apart - inside the 40-node range.
    const a = stampPost(sim, 2, 2);
    const b = stampPost(sim, 20, 2);
    const far = stampPost(sim, 40, 2); // 40 nodes past b - the range is exclusive
    expect(sim.world.get(a, Signpost).links).toEqual([b]);
    expect(sim.world.get(b, Signpost).links).toEqual([a]);
    expect(sim.world.get(far, Signpost).links).toEqual([]);
    const posts = signpostNetwork(sim.world).get(P0) ?? [];
    const groupOf = new Map(posts.map((s) => [s.entity, s.group]));
    expect(groupOf.get(a)).toBe(groupOf.get(b));
    expect(groupOf.get(far)).not.toBe(groupOf.get(a));
  });

  it('a post links only to posts walkable ground joins it to inside the range', () => {
    // A water column at tile 10 splits the strip; the strip is 8 tiles tall, so no way round exists.
    const sim = new Simulation({
      seed: 3,
      content: testContent(),
      map: waterColumnMap(32, 8, 10),
    });
    const west = stampPost(sim, 6, 2);
    const east = stampPost(sim, 14, 2); // 16 nodes away, well inside the range
    expect(sim.world.get(west, Signpost).links).toEqual([]);
    expect(sim.world.get(east, Signpost).links).toEqual([]);
  });

  it('a chained group is one group whatever the pair distances, with links kept in id order', () => {
    const sim = freshSim(128, 8);
    const a = stampPost(sim, 2, 2);
    const b = stampPost(sim, 20, 2);
    const c = stampPost(sim, 38, 2); // links b, not a (72 nodes)
    expect(sim.world.get(b, Signpost).links).toEqual([a, c]);
    expect(sim.world.get(c, Signpost).links).toEqual([b]);
    const posts = signpostNetwork(sim.world).get(P0) ?? [];
    expect(new Set(posts.map((s) => s.group)).size).toBe(1);
  });

  it('players never share a network', () => {
    const sim = freshSim();
    const own = stampPost(sim, 2, 2, 0);
    const rival = stampPost(sim, 3, 2, 1);
    expect(sim.world.get(own, Signpost).links).toEqual([]);
    expect(sim.world.get(rival, Signpost).links).toEqual([]);
    expect(signpostNetwork(sim.world).get(0)?.length).toBe(1);
    expect(signpostNetwork(sim.world).get(1)?.length).toBe(1);
  });

  it('follows a post handed to another player without an erect or tear-down', () => {
    const sim = freshSim();
    const post = stampPost(sim, 2, 2, 0);
    expect(signpostNetwork(sim.world).get(0)?.length).toBe(1);
    sim.world.add(post, Owner, { player: 1 });
    expect(signpostNetwork(sim.world).get(0)).toBeUndefined();
    expect(signpostNetwork(sim.world).get(1)?.length).toBe(1);
  });
});

describe('signpost fog vision - the permanent recon reveal', () => {
  it('a standing signpost keeps its circle VISIBLE in RECON with no unit nearby', () => {
    const sim = freshSim(64, 16);
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON });
    const e = sim.world.create();
    sim.world.add(e, Position, { x: fx.fromInt(8), y: fx.fromInt(8) });
    sim.world.add(e, Owner, { player: P0 });
    sim.world.add(e, Signpost, { links: [] });
    for (let t = 0; t < 12; t++) sim.step(); // past a couple of vision cadences
    const view = sim.fogView(P0);
    expect(view?.stateAt(8, 8)).toBe(FOG_STATE.VISIBLE); // the post's own cell
    expect(view?.stateAt(60, 8)).toBe(FOG_STATE.EXPLORED); // far ground stays recon-grey
  });
});
