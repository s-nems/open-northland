import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  DeliveryFlag,
  Health,
  HUNTER_WORK_FLAG_RADIUS,
  JobAssignment,
  KilledBy,
  Owner,
  Position,
  Resource,
  ResourceFootprint,
  Stance,
  Stockpile,
  WorkFlag,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, nodeOfPosition, positionOfNode, Simulation } from '../../src/index.js';
import { HUNT_CARCASS_SLACK_NODES } from '../../src/systems/conflict/hunting/index.js';
import { setJob } from '../../src/systems/orders/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { noteUnreachableGoal } from '../../src/systems/settlers/unreachable-goals.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * WHOSE KILL IS WHOSE (user rules): a hunter harvests the game IT shot, and it looks for that work only
 * inside its own hunting ground. Two hunters therefore never trail one body, and none walks the map for
 * a kill made on the far side of it. The claim is not a lock on the world: it lapses with its killer, so
 * a body is never left standing that nobody may pluck.
 *
 * Fixture facts: meat is good 21 with harvest atomic 33, granted to the hunter job 15; the fixture's
 * meat-stocking workplace (building 24) stocks meat and employs hunters.
 */
describe('hunter - one hunter per kill, inside its own ground', () => {
  const HUNTER = 15;
  const VIKING = 1;
  const MEAT = 21;
  const HARVEST_CADAVER = 33;
  const MEAT_WORKPLACE = 24;
  const WOODCUTTER = 1;
  const P0 = 0;
  const P1 = 1;

  function hunterAtNode(sim: Simulation, hx: number, hy: number): Entity {
    const at = positionOfNode(hx, hy);
    const e = settlerAt(sim, { jobType: HUNTER, tribe: VIKING, position: { x: at.x, y: at.y } });
    sim.world.add(e, Health, { hitpoints: 1000, max: 1000 });
    sim.world.add(e, Owner, { player: P0 });
    return e;
  }

  function bindFlagAtNode(sim: Simulation, hunter: Entity, hx: number, hy: number, radius: number): void {
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(hx, hy));
    sim.world.add(flag, DeliveryFlag, {});
    sim.world.add(hunter, WorkFlag, { flag, radius });
  }

  /** A carcass node of `killer`'s making - what {@link spawnCarcasses} leaves where prey fell. */
  function carcassAtNode(sim: Simulation, hx: number, hy: number, killer: Entity | null): Entity {
    const e = sim.world.create();
    sim.world.add(e, Position, positionOfNode(hx, hy));
    sim.world.add(e, Resource, { goodType: MEAT, remaining: 4, harvestAtomic: HARVEST_CADAVER });
    if (killer !== null) sim.world.add(e, KilledBy, { by: killer });
    return e;
  }

  function meatLeft(sim: Simulation, carcass: Entity): number {
    return sim.world.isAlive(carcass) ? sim.world.get(carcass, Resource).remaining : 0;
  }

  /** The workplace's node, and how far from it a workplace hunter's work may lie. */
  const HUT_NODE = { hx: 10, hy: 2 };
  const GROUND_REACH = HUNTER_WORK_FLAG_RADIUS + HUNT_CARCASS_SLACK_NODES;
  /** A body comfortably outside that ground - the "other side of the map" case. */
  const BEYOND_GROUND = HUT_NODE.hx + GROUND_REACH + 18;

  /** How far (Manhattan nodes) `settler` stands from a node. */
  function nodesFrom(sim: Simulation, settler: Entity, hx: number, hy: number): number {
    const p = sim.world.get(settler, Position);
    const at = nodeOfPosition(p.x, p.y);
    return Math.abs(at.hx - hx) + Math.abs(at.hy - hy);
  }

  function nodesFromHut(sim: Simulation, settler: Entity): number {
    return nodesFrom(sim, settler, HUT_NODE.hx, HUT_NODE.hy);
  }

  /** A hunter employed at the meat workplace - flagless, so its ground is the radius around the hut. */
  function workplaceHunter(sim: Simulation): Entity {
    const hut = sim.world.create();
    sim.world.add(hut, Position, positionOfNode(HUT_NODE.hx, HUT_NODE.hy));
    sim.world.add(hut, Building, {
      buildingType: MEAT_WORKPLACE,
      tribe: VIKING,
      built: fx.fromInt(1),
      level: 0,
    });
    sim.world.add(hut, Stockpile, { amounts: new Map<number, number>() });
    const hunter = hunterAtNode(sim, HUT_NODE.hx + 2, HUT_NODE.hy);
    sim.world.add(hunter, JobAssignment, { workplace: hut });
    return hunter;
  }

  /** Every resource node `settler` ran a harvest atomic on over `ticks` - who worked what, rather than
   *  what merely drained (a body two hunters may both reach drains either way). */
  function nodesWorkedBy(sim: Simulation, settler: Entity, ticks: number): Entity[] {
    const worked = new Set<Entity>();
    for (let i = 0; i < ticks; i++) {
      sim.step();
      const atomic = sim.world.tryGet(settler, CurrentAtomic);
      if (atomic?.effect.kind === 'harvest') worked.add(atomic.effect.resource);
    }
    return [...worked];
  }

  it("leaves a colleague's kill alone and works its own, though both lie in its ground", () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassNodeMap(40, 8) });
    const hunter = hunterAtNode(sim, 20, 2);
    const colleague = hunterAtNode(sim, 21, 2);
    bindFlagAtNode(sim, hunter, 20, 2, 16);
    bindFlagAtNode(sim, colleague, 21, 2, 16); // overlapping grounds - both bodies lie in both
    const theirs = carcassAtNode(sim, 18, 2, colleague);
    const mine = carcassAtNode(sim, 24, 2, hunter);

    const worked = nodesWorkedBy(sim, hunter, 400);

    expect(worked).not.toContain(theirs); // the NEARER body - and not this hunter's to pluck
    expect(worked).toContain(mine);
  });

  /** Two hunters with overlapping grounds and one body, killed by `colleague`. The claim decides
   *  whether `hunter` may take it, so each lapse case only differs in what it does to the killer. */
  function twoHuntersOneBody(): {
    sim: Simulation;
    hunter: Entity;
    colleague: Entity;
    body: Entity;
  } {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassNodeMap(40, 8) });
    const hunter = hunterAtNode(sim, 20, 2);
    const colleague = hunterAtNode(sim, 21, 2);
    bindFlagAtNode(sim, hunter, 20, 2, 16);
    bindFlagAtNode(sim, colleague, 21, 2, 16);
    return { sim, hunter, colleague, body: carcassAtNode(sim, 18, 2, colleague) };
  }

  it('takes over a kill whose killer has fallen - a claim never strands a body', () => {
    const { sim, colleague, body } = twoHuntersOneBody();

    sim.world.destroy(colleague);
    sim.run(400);

    expect(meatLeft(sim, body)).toBeLessThan(4);
  });

  it('takes over a kill whose killer has left the trade', () => {
    const { sim, colleague, body } = twoHuntersOneBody();

    setJob(sim.world, ctxOf(sim), { kind: 'setJob', entity: colleague, jobType: WOODCUTTER });
    sim.run(400);

    expect(meatLeft(sim, body)).toBeLessThan(4);
  });

  it("takes over a kill the killer's own routes just failed to reach", () => {
    const { sim, hunter, colleague, body } = twoHuntersOneBody();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('test map missing');

    // The killer's gate already writes this body off as work it cannot bank; without the same test on
    // the claim, nobody may take it and it cycles on the killer's memo forever.
    noteUnreachableGoal(sim.world, ctxOf(sim), colleague, terrain.nodeAt(18, 2));
    const worked = nodesWorkedBy(sim, hunter, 400);

    expect(worked).toContain(body);
  });

  it('takes over a kill whose killer was posted off hunting duty (DEFEND)', () => {
    const { sim, colleague, body } = twoHuntersOneBody();

    // A posted hunter holds its anchor and never reaches the economy drives, so it will never come
    // back for this body - the claim has to let go or the meat is lost to one stance command.
    sim.world.add(colleague, Stance, { mode: MILITARY_MODE.DEFEND, anchorCell: null });
    sim.run(400);

    expect(meatLeft(sim, body)).toBeLessThan(4);
  });

  it("a RIVAL player's kill is no claim - contested game stays contested", () => {
    const { sim, hunter, colleague, body } = twoHuntersOneBody();

    sim.world.add(colleague, Owner, { player: P1 });
    const worked = nodesWorkedBy(sim, hunter, 400);

    expect(worked).toContain(body);
  });

  it('still reaches a body at the band edge whose WORK CELL resolves outward', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassNodeMap(200, 8) });
    const hunter = workplaceHunter(sim);
    // Anchor exactly at the gate's reach, work cell one visual cell (2 nodes) further out. The gate
    // measures the anchor and calls this standing work; a harvest scan bounded at the same radius
    // would measure the work cell, reject it, and wedge the hunter off hunting for good.
    const body = carcassAtNode(sim, HUT_NODE.hx + GROUND_REACH, 2, hunter);
    sim.world.add(body, ResourceFootprint, { walk: [], build: [], work: [{ dx: 1, dy: 0 }] });

    sim.run(1200);

    expect(meatLeft(sim, body)).toBeLessThan(4);
  });

  it('a FLAG-bound hunter stays in its ground however rich the ground beyond it is', () => {
    const RADIUS = 16; // a literal, so the leash this pins survives any retune of the shipped radius
    const FLAG = { hx: 20, hy: 2 };
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassNodeMap(200, 8) });
    const hunter = hunterAtNode(sim, FLAG.hx, FLAG.hy);
    bindFlagAtNode(sim, hunter, FLAG.hx, FLAG.hy, RADIUS);
    // Its own kill, well past the ground - the only work on the map, so the ground bound is the one
    // thing between this hunter and a walk across it (user report 2026-08-03).
    const beyond = carcassAtNode(sim, FLAG.hx + RADIUS + 40, 2, hunter);

    let strayed = 0;
    for (let i = 0; i < 800; i++) {
      sim.step();
      strayed = Math.max(strayed, nodesFrom(sim, hunter, FLAG.hx, FLAG.hy));
    }

    expect(meatLeft(sim, beyond)).toBe(4);
    expect(strayed).toBeLessThanOrEqual(RADIUS + HUNT_CARCASS_SLACK_NODES);
  });

  it('a workplace hunter ignores a kill outside its ground, and works the one inside it', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassNodeMap(200, 8) });
    const hunter = workplaceHunter(sim);
    // Its own kill, past the ground's radius plus the kill slack - and the only work on the map, so
    // nothing but the ground bound keeps the hunter from walking out to it.
    const acrossTheMap = carcassAtNode(sim, BEYOND_GROUND, 2, hunter);

    sim.run(1500); // long enough to walk there and pluck the body dry, were it this hunter's work
    expect(meatLeft(sim, acrossTheMap)).toBe(4);
    expect(nodesFromHut(sim, hunter)).toBeLessThanOrEqual(GROUND_REACH); // it never set off at all

    // The same body inside the ground proves the hunter was willing and able all along. Derived from
    // the radius, not written out: a body pinned at a literal node drifts outside on the next retune.
    const inGround = carcassAtNode(sim, HUT_NODE.hx + HUNTER_WORK_FLAG_RADIUS / 2, 2, hunter);

    sim.run(600);
    expect(meatLeft(sim, inGround)).toBeLessThan(4);
  });
});
