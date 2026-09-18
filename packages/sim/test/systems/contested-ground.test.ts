import { describe, expect, it } from 'vitest';
import {
  Building,
  FOG_MODE,
  Garrison,
  Health,
  Position,
  Settler,
  setDiplomacyStance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import {
  CONTESTED_GROUND_RADIUS_NODES,
  contestedGroundFor,
} from '../../src/systems/conflict/contested-ground.js';
import { VISION_CADENCE_TICKS } from '../../src/systems/vision/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * Contested ground: the placement rule that refuses a site near a hostile army, and the `placeBuilding`
 * gate that reads it. A deliberate divergence from the original, which places freely under an enemy
 * army, so nothing here claims fidelity.
 */

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const ALLY = 4;
const CIVILIST = 6;
const SPEARMAN = 32;
const HQ_TYPE = 1;
const RADIUS = CONTESTED_GROUND_RADIUS_NODES;

/** Where the fighter stands in every case. */
const CAMP = { x: 20, y: 10 };

function fresh(): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(64, 32) });
}

function spawn(sim: Simulation, jobType: number, owner: number, at = CAMP): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  const spawned = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (spawned === undefined) throw new Error('setup: nothing spawned');
  return spawned;
}

function groundOf(sim: Simulation, player: number) {
  return contestedGroundFor(sim.world, sim.content, sim.fog, player);
}

function contestedFor(sim: Simulation, player: number, at: { x: number; y: number }): boolean {
  return groundOf(sim, player).contested(at.x, at.y);
}

/** The key over a box of `size` nodes a side with its corner at `at`. */
function keyAt(sim: Simulation, at: { x: number; y: number }, size = 8): string {
  return groundOf(sim, SEAT).keyWithin(at.x, at.x + size, at.y, at.y + size);
}

describe('contested ground - who contests it', () => {
  it('a hostile fighter contests the ground within the radius and nothing beyond it', () => {
    const sim = fresh();
    spawn(sim, SPEARMAN, FOE);

    expect(contestedFor(sim, SEAT, CAMP)).toBe(true);
    expect(contestedFor(sim, SEAT, { x: CAMP.x + RADIUS, y: CAMP.y })).toBe(true);
    expect(contestedFor(sim, SEAT, { x: CAMP.x + RADIUS + 1, y: CAMP.y })).toBe(false);
    expect(contestedFor(sim, SEAT, { x: CAMP.x + 5, y: CAMP.y + RADIUS - 5 })).toBe(true);
  });

  it('names the fighters whose radius reaches a box, so a memo over it knows when one moved', () => {
    const sim = fresh();
    expect(keyAt(sim, CAMP)).toBe('');
    const man = spawn(sim, SPEARMAN, FOE);
    const camped = keyAt(sim, CAMP);
    expect(camped).not.toBe('');
    expect(keyAt(sim, { x: CAMP.x + RADIUS, y: CAMP.y })).toBe(camped); // reaches the box's near edge
    expect(keyAt(sim, { x: CAMP.x + 4 * RADIUS, y: CAMP.y })).toBe(''); // a screen away: nothing to re-walk

    Object.assign(sim.world.mut(man, Position), positionOfNode(CAMP.x + 2, CAMP.y));
    expect(keyAt(sim, CAMP)).not.toBe(camped);
  });

  it('counts only the fighters the seat can see', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setFogMode', mode: FOG_MODE.RECON_FOG_OF_WAR });
    spawn(sim, SPEARMAN, FOE);
    // Nobody of the seat's is near, so the fighter stands in its fog: the ghost is no enemy detector.
    expect(contestedFor(sim, SEAT, CAMP)).toBe(false);

    // An eye of the seat's within civilian vision of him, once the masks next rebuild.
    spawn(sim, CIVILIST, SEAT, { x: CAMP.x + 8, y: CAMP.y });
    sim.run(VISION_CADENCE_TICKS);
    expect(contestedFor(sim, SEAT, CAMP)).toBe(true);
  });

  it("is contested by neither a civilian, the seat's own soldier, nor a friendly seat's", () => {
    const sim = fresh();
    spawn(sim, CIVILIST, FOE);
    spawn(sim, SPEARMAN, SEAT);
    setDiplomacyStance(sim.world, ALLY, SEAT, 'friend');
    spawn(sim, SPEARMAN, ALLY);

    expect(contestedFor(sim, SEAT, CAMP)).toBe(false);
  });

  it('a fighter holding his tower post is a fortification, not an army', () => {
    const sim = fresh();
    const post = sim.world.create();
    sim.world.add(post, Position, positionOfNode(CAMP.x, CAMP.y));
    const archer = spawn(sim, SPEARMAN, FOE, { x: CAMP.x + 4, y: CAMP.y });
    expect(contestedFor(sim, SEAT, CAMP)).toBe(true);

    const at = sim.world.get(post, Position);
    sim.world.add(archer, Garrison, { post, returnTo: { x: at.x, y: at.y } });
    Object.assign(sim.world.mut(archer, Position), { x: at.x, y: at.y });
    expect(contestedFor(sim, SEAT, CAMP)).toBe(false);
  });

  it('a dead fighter contests nothing', () => {
    const sim = fresh();
    const man = spawn(sim, SPEARMAN, FOE);
    sim.world.mut(man, Health).hitpoints = 0;
    expect(contestedFor(sim, SEAT, CAMP)).toBe(false);
  });
});

describe('placeBuilding - refusing a site under the enemy army', () => {
  const SITE = { x: CAMP.x + 6, y: CAMP.y };

  function place(sim: Simulation, owner: number | undefined, force = false): void {
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HQ_TYPE,
      x: SITE.x,
      y: SITE.y,
      tribe: VIKING,
      ...(owner === undefined ? {} : { owner }),
      ...(force ? { force: true } : {}),
    });
    sim.step();
  }

  function buildings(sim: Simulation): number {
    return [...sim.world.query(Building)].length;
  }

  it("drops the seat's placement while a hostile fighter stands over it, and lands it once he is gone", () => {
    const sim = fresh();
    const man = spawn(sim, SPEARMAN, FOE);
    place(sim, SEAT);
    expect(buildings(sim)).toBe(0);

    sim.world.destroy(man);
    place(sim, SEAT);
    expect(buildings(sim)).toBe(1);
  });

  it('lets an authored placement and an ownerless one through - neither is a seat building', () => {
    const sim = fresh();
    spawn(sim, SPEARMAN, FOE);
    place(sim, SEAT, true);
    place(sim, undefined);
    expect(buildings(sim)).toBe(2);
  });
});
