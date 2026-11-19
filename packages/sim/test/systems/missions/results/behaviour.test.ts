import { describe, expect, it } from 'vitest';
import {
  BonePile,
  Building,
  CurrentAtomic,
  Felling,
  Fleeing,
  Health,
  HOUSE_BEHAVIOUR,
  hasHouseBehaviour,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  MissionBehaviour,
  ownerOf,
  Person,
  PlayerOrder,
  Position,
  Resource,
  Settler,
  SettlerProgress,
  setMissionBehaviour,
  WALK_DIRECTION,
  WalkFacing,
} from '../../../../src/components/index.js';
import { aiCommand, playerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { hexDistance, nodeOfPosition, positionOfNode } from '../../../../src/nav/halfcell.js';
import {
  anchorOnlyFootprint,
  combatSystem,
  stampResourceFootprintData,
} from '../../../../src/systems/index.js';
import { grantWorkExperience } from '../../../../src/systems/progression/index.js';
import { resolveCombatHit } from '../../../../src/systems/settlers/atomics/effects/combat/hit/resolution.js';
import { ctxOf } from '../../../fixtures/context.js';
import { needsOf } from '../../../fixtures/settler.js';
import {
  CARPENTER,
  firingSim,
  HUT_LARGE,
  houseContent,
  LOAD_PASS,
  POINT,
  spawn,
  VIKING,
  WOODCUTTER,
} from '../support.js';

/**
 * The behaviour mask: the four results that write it, and the rules that read it. Every reading bit
 * gets one world with the bit and one without, because the flag is only meaningful as a difference.
 */

const OWNER = 2;
const GROUP = 61;
const FAR = { hx: POINT.hx + 16, hy: POINT.hy };
/** Long enough for a woodcutter standing on a tree to start chopping it. */
const WORK_TICKS = 40;

function humansOf(sim: Simulation, player: number): Entity[] {
  return [...sim.world.query(Person)].filter((e) => ownerOf(sim.world, e) === player);
}

function only(sim: Simulation, player: number): Entity {
  const [e, ...rest] = humansOf(sim, player);
  if (e === undefined || rest.length > 0) throw new Error('expected one human');
  return e;
}

function nodeOf(sim: Simulation, e: Entity): { hx: number; hy: number } {
  const at = sim.world.get(e, Position);
  return nodeOfPosition(at.x, at.y);
}

function nodesEqual(a: { hx: number; hy: number }, b: { hx: number; hy: number }): boolean {
  return a.hx === b.hx && a.hy === b.hy;
}

/** A standing tree on `at` that a woodcutter fells over several strokes. */
function fellableTreeAt(sim: Simulation, at: { hx: number; hy: number }): void {
  const WOOD = 1;
  const CHOP_ATOMIC = 24;
  const tree = sim.world.create();
  sim.world.add(tree, Position, positionOfNode(at.hx, at.hy));
  sim.world.add(tree, Resource, { goodType: WOOD, remaining: 1, harvestAtomic: CHOP_ATOMIC });
  stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());
  sim.world.add(tree, Felling, { chops: 0 });
}

/** A world with no script results, running long enough for the settler drives to have their say. */
function plainSim(): Simulation {
  return firingSim([{ opcode: 'None' }]);
}

describe('the results that write the mask', () => {
  it('ORs a mask onto every human with the id and clears it again', () => {
    const sim = firingSim([
      { opcode: 'SetHumanBehaviourFlag', humanId: GROUP, amount: MISSION_BEHAVIOUR.PASSIVE, flag: true },
    ]);
    spawn(sim, { player: OWNER, missionId: GROUP });
    spawn(sim, { player: OWNER });
    sim.run(LOAD_PASS);
    const flagged = humansOf(sim, OWNER).filter((e) => sim.world.has(e, MissionBehaviour));
    expect(flagged).toHaveLength(1);

    const target = flagged[0];
    if (target === undefined) throw new Error('no flagged human');
    setMissionBehaviour(sim.world, target, MISSION_BEHAVIOUR.PASSIVE, false);
    // An emptied mask drops the component, so a world that got a bit and lost it looks untouched.
    expect(sim.world.has(target, MissionBehaviour)).toBe(false);
  });

  it('keeps the bits a line does not name', () => {
    const sim = firingSim([
      { opcode: 'SetHumanBehaviourFlag', humanId: GROUP, amount: MISSION_BEHAVIOUR.PASSIVE, flag: false },
    ]);
    spawn(sim, {
      player: OWNER,
      missionId: GROUP,
      behaviourFlags: MISSION_BEHAVIOUR.PASSIVE | MISSION_BEHAVIOUR.DOES_NOT_WORK,
    });
    sim.run(LOAD_PASS);
    const e = only(sim, OWNER);
    expect(hasMissionBehaviour(sim.world, e, MISSION_BEHAVIOUR.PASSIVE)).toBe(false);
    expect(hasMissionBehaviour(sim.world, e, MISSION_BEHAVIOUR.DOES_NOT_WORK)).toBe(true);
  });

  it('writes the player’s humans and nobody else’s', () => {
    const sim = firingSim([
      {
        opcode: 'SetPlayerBehaviourFlag',
        player: OWNER,
        amount: MISSION_BEHAVIOUR.INVULNERABLE,
        flag: true,
      },
    ]);
    spawn(sim, { player: OWNER });
    spawn(sim, { player: OWNER + 1 });
    sim.run(LOAD_PASS);
    expect(hasMissionBehaviour(sim.world, only(sim, OWNER), MISSION_BEHAVIOUR.INVULNERABLE)).toBe(true);
    expect(hasMissionBehaviour(sim.world, only(sim, OWNER + 1), MISSION_BEHAVIOUR.INVULNERABLE)).toBe(false);
  });

  it('sets the import marker on its own bit', () => {
    const sim = firingSim([{ opcode: 'SetImportHumanFlag', humanId: GROUP, flag: true }]);
    spawn(sim, { player: OWNER, missionId: GROUP });
    sim.run(LOAD_PASS);
    expect(hasMissionBehaviour(sim.world, only(sim, OWNER), MISSION_BEHAVIOUR.IMPORTED)).toBe(true);
  });

  it('sets one house bit by index', () => {
    const sim = firingSim(
      [{ opcode: 'SetHouseBehaviourFlag', objectId: GROUP, index: 0, flag: true }],
      houseContent(),
    );
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT_LARGE,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: OWNER,
      missionId: GROUP,
    });
    sim.run(LOAD_PASS);
    const [house] = [...sim.world.query(Building)];
    if (house === undefined) throw new Error('no house');
    expect(hasHouseBehaviour(sim.world, house, HOUSE_BEHAVIOUR.INDESTRUCTIBLE)).toBe(true);
  });
});

describe('the bits the sim reads', () => {
  it('freezes a flagged human’s needs and leaves its neighbour’s alone', () => {
    const sim = plainSim();
    spawn(sim, { player: OWNER, behaviourFlags: MISSION_BEHAVIOUR.NEEDS_FROZEN });
    spawn(sim, { player: OWNER + 1 });
    sim.run(2);
    const frozen = only(sim, OWNER);
    const ordinary = only(sim, OWNER + 1);
    // Every settler opens on a seeded deficit, so the tell is the change, not the value.
    const frozenAt = needsOf(sim, frozen).hunger;
    const ordinaryAt = needsOf(sim, ordinary).hunger;
    sim.run(200);
    expect(needsOf(sim, frozen).hunger).toBe(frozenAt);
    expect(needsOf(sim, ordinary).hunger).toBeGreaterThan(ordinaryAt);
    // Frozen needs leave the hitpoints alone: a wounded one still heals.
    sim.world.mut(frozen, Health).hitpoints = 1;
    sim.run(200);
    expect(sim.world.get(frozen, Health).hitpoints).toBeGreaterThan(1);
  });

  it('keeps a human barred from work off the tree it stands on', () => {
    const chops = (flags: number | undefined): boolean => {
      const sim = plainSim();
      fellableTreeAt(sim, POINT);
      spawn(sim, { player: OWNER, ...(flags === undefined ? {} : { behaviourFlags: flags }) });
      for (let i = 0; i < WORK_TICKS; i++) {
        sim.step();
        const [e] = humansOf(sim, OWNER);
        if (e !== undefined && sim.world.tryGet(e, CurrentAtomic)?.effect.kind === 'harvest') return true;
      }
      return false;
    };
    expect(chops(undefined)).toBe(true);
    expect(chops(MISSION_BEHAVIOUR.DOES_NOT_WORK)).toBe(false);
  });

  it('pins a human barred from work where it was left', () => {
    // Both belong to one player: two seats' civilians flee each other, and flight is not an idle rung.
    const sim = plainSim();
    spawn(sim, { player: OWNER, behaviourFlags: MISSION_BEHAVIOUR.DOES_NOT_WORK });
    spawn(sim, { player: OWNER });
    sim.step();
    const [pinned, drifter] = humansOf(sim, OWNER);
    if (pinned === undefined || drifter === undefined) throw new Error('expected two humans');
    const pinnedAt = nodeOf(sim, pinned);
    const drifterAt = nodeOf(sim, drifter);
    // Sampled every tick from the spawn tick on: an idle drifter walks off (and may stand still or pass
    // back over its start later), the pinned one never leaves.
    let drifted = !nodesEqual(drifterAt, { hx: POINT.hx, hy: POINT.hy });
    for (let i = 0; i < 200; i++) {
      sim.step();
      expect(nodeOf(sim, pinned)).toEqual(pinnedAt);
      if (!drifted && !nodesEqual(nodeOf(sim, drifter), drifterAt)) drifted = true;
    }
    expect(drifted).toBe(true);
  });

  // The flight half of the passive bit. Its retaliation half needs an armed pair, which the fixture
  // content has no weapon bindings for.
  it('keeps a passive human standing while its neighbour runs', () => {
    const sim = plainSim();
    spawn(sim, { player: OWNER, behaviourFlags: MISSION_BEHAVIOUR.PASSIVE });
    spawn(sim, { player: OWNER + 1 });
    sim.run(LOAD_PASS);
    const passive = only(sim, OWNER);
    const neighbour = only(sim, OWNER + 1);
    // Each strikes the other once, and the combat pass answers both blows.
    resolveCombatHit(sim.world, ctxOf(sim), neighbour, passive, { damage: 1 }, [], 'melee');
    resolveCombatHit(sim.world, ctxOf(sim), passive, neighbour, { damage: 1 }, [], 'melee');
    combatSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(passive, Fleeing)).toBe(false);
    expect(sim.world.has(neighbour, Fleeing)).toBe(true);
  });

  it('spares an invulnerable human the blow that lands on it', () => {
    const sim = plainSim();
    spawn(sim, { player: OWNER, behaviourFlags: MISSION_BEHAVIOUR.INVULNERABLE });
    spawn(sim, { player: OWNER + 1 });
    sim.run(2);
    const shielded = only(sim, OWNER);
    const attacker = only(sim, OWNER + 1);
    const before = sim.world.get(shielded, Health).hitpoints;
    resolveCombatHit(sim.world, ctxOf(sim), attacker, shielded, { damage: 25 }, [], 'melee');
    expect(sim.world.get(shielded, Health).hitpoints).toBe(before);

    const exposed = sim.world.get(attacker, Health).hitpoints;
    // The two share a node, which reads as a blow from the east: facing east, it lands head-on at x1.
    sim.world.mut(attacker, WalkFacing).direction = WALK_DIRECTION.E;
    resolveCombatHit(sim.world, ctxOf(sim), shielded, attacker, { damage: 25 }, [], 'melee');
    expect(sim.world.get(attacker, Health).hitpoints).toBe(exposed - 25);
  });

  it('refuses the seat’s order to an uncontrollable human', () => {
    const sim = plainSim();
    spawn(sim, { player: OWNER, behaviourFlags: MISSION_BEHAVIOUR.NOT_CONTROLLABLE });
    spawn(sim, { player: OWNER + 1 });
    sim.run(2);
    const deaf = only(sim, OWNER);
    const obedient = only(sim, OWNER + 1);
    sim.enqueue(playerCommand(OWNER, { kind: 'moveUnit', entity: deaf, x: FAR.hx, y: FAR.hy }));
    sim.enqueue(playerCommand(OWNER + 1, { kind: 'moveUnit', entity: obedient, x: FAR.hx, y: FAR.hy }));
    sim.step();
    expect(sim.world.has(deaf, PlayerOrder)).toBe(false);
    expect(sim.world.has(obedient, PlayerOrder)).toBe(true);
  });

  it('still lets the seat’s own AI command that human', () => {
    const sim = plainSim();
    spawn(sim, { player: OWNER, behaviourFlags: MISSION_BEHAVIOUR.NOT_CONTROLLABLE });
    sim.run(2);
    const deaf = only(sim, OWNER);
    sim.enqueue(aiCommand(OWNER, { kind: 'moveUnit', entity: deaf, x: FAR.hx, y: FAR.hy }));
    sim.step();
    expect(sim.world.has(deaf, PlayerOrder)).toBe(true);
  });

  it('keeps a job-locked human in the trade it was given', () => {
    const sim = plainSim();
    spawn(sim, { player: OWNER, behaviourFlags: MISSION_BEHAVIOUR.JOB_LOCKED });
    spawn(sim, { player: OWNER + 1 });
    sim.run(2);
    const locked = only(sim, OWNER);
    const free = only(sim, OWNER + 1);
    sim.enqueue(playerCommand(OWNER, { kind: 'moveUnit', entity: locked, x: FAR.hx, y: FAR.hy }));
    sim.step();
    sim.enqueue(playerCommand(OWNER, { kind: 'setJob', entity: locked, jobType: CARPENTER }));
    sim.enqueue(playerCommand(OWNER + 1, { kind: 'setJob', entity: free, jobType: CARPENTER }));
    sim.step();
    expect(sim.world.get(locked, Settler).jobType).toBe(WOODCUTTER);
    expect(sim.world.get(free, Settler).jobType).toBe(CARPENTER);
    // The refused order cancelled nothing: the walk it would have superseded goes on.
    expect(sim.world.has(locked, PlayerOrder)).toBe(true);
  });

  it('bars a flagged human from earning experience for its work', () => {
    // The fixture's woodcutter earns on good 1; both settlers take the same grant.
    const WOOD = 1;
    const sim = plainSim();
    spawn(sim, { player: OWNER, behaviourFlags: MISSION_BEHAVIOUR.NO_JOB_EXPERIENCE });
    spawn(sim, { player: OWNER + 1 });
    sim.run(2);
    const barred = only(sim, OWNER);
    const learner = only(sim, OWNER + 1);
    grantWorkExperience(sim.world, ctxOf(sim), barred, WOOD, 1);
    grantWorkExperience(sim.world, ctxOf(sim), learner, WOOD, 1);
    expect(sim.world.get(barred, SettlerProgress).experience.size).toBe(0);
    expect(sim.world.get(learner, SettlerProgress).experience.size).toBe(2);
  });

  it('leaves no bones where a ghost falls', () => {
    const bones = (flags: number | undefined): number => {
      const sim = plainSim();
      spawn(sim, { player: OWNER, ...(flags === undefined ? {} : { behaviourFlags: flags }) });
      sim.run(2);
      sim.world.mut(only(sim, OWNER), Health).hitpoints = 0;
      sim.step();
      return sim.world.count(BonePile);
    };
    expect(bones(undefined)).toBe(1);
    expect(bones(MISSION_BEHAVIOUR.GHOST)).toBe(0);
  });

  it('paces a slow human behind and a fast one ahead of an ordinary walker', () => {
    const walked = (flags: number | undefined): number => {
      const sim = plainSim();
      spawn(sim, { player: OWNER, ...(flags === undefined ? {} : { behaviourFlags: flags }) });
      sim.run(2);
      const e = only(sim, OWNER);
      const from = nodeOf(sim, e);
      sim.enqueueSetup({ kind: 'moveUnit', entity: e, x: FAR.hx, y: FAR.hy });
      sim.run(60);
      return hexDistance(from, nodeOf(sim, e));
    };
    const ordinary = walked(undefined);
    expect(walked(MISSION_BEHAVIOUR.WALKS_SLOWLY)).toBeLessThan(ordinary);
    expect(walked(MISSION_BEHAVIOUR.WALKS_FAST)).toBeGreaterThan(ordinary);
  });
});
