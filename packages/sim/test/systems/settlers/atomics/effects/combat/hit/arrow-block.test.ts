import { IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Engagement,
  Health,
  Owner,
  Position,
  Projectile,
  SettlerProgress,
  Stance,
  setDiplomacyStance,
  WALK_DIRECTION,
  WalkFacing,
} from '../../../../../../../src/components/index.js';
import type { Entity } from '../../../../../../../src/ecs/world.js';
import { type Fixed, fx, positionOfNode, Simulation } from '../../../../../../../src/index.js';
import { hexNeighboursOf } from '../../../../../../../src/nav/halfcell.js';
import { projectileSystem } from '../../../../../../../src/systems/conflict/projectile.js';
import { FIGHT_EXPERIENCE_TYPE } from '../../../../../../../src/systems/index.js';
import { MILITARY_MODE } from '../../../../../../../src/systems/readviews/index.js';
import { fixtureTick, nextTickCtxOf } from '../../../../../../fixtures/context.js';
import { addSettlerOfTribe } from '../../../../../../fixtures/settler.js';
import { grassCellMap } from '../../../../../../fixtures/terrain.js';

const SHIELD_TRIBE = 1;
const ARCHER_TRIBE = 2;
const IDLE = 0;
const SHIELD_BEARER = 34;
const PLAIN_SWORDSMAN = 35;
const SHIELD_SWORD = 7;
const PLAIN_SWORD = 8;
const SWORD_MAIN_TYPE = 3;
/** A certain block, so every possible block happens. */
const CERTAIN_PCT = 100;
/** The shield's ruled chance, which must let some arrows through. */
const QUARTER_PCT = 25;
/** Arrows of {@link ARROW_DAMAGE} the victim's {@link HITPOINTS} survive all of. */
const VOLLEY = 20;
const SHIELD_PLAYER = 0;
const ARCHER_PLAYER = 1;
const BLOCK_SOUND = 80;
const ARROW = 1;
const BOW_MAIN_TYPE = 6;
const ARROW_DAMAGE = 30;
const SHOT_TICKS = 12;
const HITPOINTS = 1000;

// The victim stands on an even-row node and faces east; its six neighbours in `hexNeighboursOf` order.
const VICTIM = { hx: 4, hy: 4 } as const;
const [EAST, WEST, NORTH_WEST, NORTH_EAST] = hexNeighboursOf(VICTIM.hx, VICTIM.hy);

function content(chancePct = CERTAIN_PCT) {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic-arrow-block-test' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: IDLE, id: 'idle' },
      { typeId: SHIELD_BEARER, id: 'soldier_sword_short' },
      { typeId: PLAIN_SWORDSMAN, id: 'soldier_sword_long' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [
      {
        typeId: SHIELD_SWORD,
        id: 'shield_sword',
        tribeType: SHIELD_TRIBE,
        jobType: SHIELD_BEARER,
        mainType: SWORD_MAIN_TYPE,
        damage: { '0': ARROW_DAMAGE },
        arrowBlock: { chancePct, soundType: BLOCK_SOUND },
      },
      {
        typeId: PLAIN_SWORD,
        id: 'plain_sword',
        tribeType: SHIELD_TRIBE,
        jobType: PLAIN_SWORDSMAN,
        mainType: SWORD_MAIN_TYPE,
        damage: { '0': ARROW_DAMAGE },
      },
    ],
  });
}

function settlerAt(sim: Simulation, at: { x: Fixed; y: Fixed }, tribe: number, jobType: number): Entity {
  const e = sim.world.create();
  addSettlerOfTribe(sim, e, {
    tribe,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Health, { hitpoints: HITPOINTS, max: HITPOINTS });
  sim.world.add(e, Position, { x: at.x, y: at.y });
  return e;
}

function setup(victimJob: number, chancePct = CERTAIN_PCT) {
  const sim = new Simulation({ seed: 1, content: content(chancePct), map: grassCellMap(6, 6) });
  const shooter = settlerAt(sim, positionOfNode(0, 0), ARCHER_TRIBE, IDLE);
  const victim = settlerAt(sim, positionOfNode(VICTIM.hx, VICTIM.hy), SHIELD_TRIBE, victimJob);
  sim.world.add(victim, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
  return { sim, shooter, victim };
}

/** Land one arrow (a stone when `siege`) loosed from `from` on `victim`, and the events it raised. */
function landShot(
  sim: Simulation,
  shooter: Entity,
  victim: Entity,
  from: { hx: number; hy: number } | undefined,
  siege = false,
) {
  if (from === undefined) throw new Error('missing neighbour');
  const origin = positionOfNode(from.hx, from.hy);
  const aim = positionOfNode(VICTIM.hx, VICTIM.hy);
  const shot = sim.world.create();
  sim.world.add(shot, Position, { x: aim.x, y: aim.y });
  sim.world.add(shot, Projectile, {
    source: shooter,
    target: victim,
    player: null,
    hitSelf: false,
    area: false,
    damage: { '0': ARROW_DAMAGE },
    hitSounds: {},
    weaponMainType: BOW_MAIN_TYPE,
    blowTicks: SHOT_TICKS,
    missSounds: {},
    munitionType: ARROW,
    originX: origin.x,
    originY: origin.y,
    aimX: aim.x,
    aimY: aim.y,
    cover: null,
    launchTick: fixtureTick(sim),
    landTick: fixtureTick(sim),
    impact: siege ? { smokeTicks: null } : null,
  });
  const before = sim.events.current().length;
  projectileSystem(sim.world, nextTickCtxOf(sim));
  return sim.events.current().slice(before);
}

const personalPoints = (sim: Simulation, e: Entity): number =>
  sim.world.get(e, SettlerProgress).experience.get(FIGHT_EXPERIENCE_TYPE.PERSONAL) ?? 0;

describe('a weapon with a block chance stops an arrow', () => {
  it('from the front and from either front or back side, sounding the block instead of a hit', () => {
    for (const from of [EAST, NORTH_EAST, NORTH_WEST]) {
      const { sim, shooter, victim } = setup(SHIELD_BEARER);
      const events = landShot(sim, shooter, victim, from);
      expect(sim.world.get(victim, Health).hitpoints).toBe(HITPOINTS);
      expect(events.map((e) => e.kind)).toEqual(['arrowBlocked']);
      expect(events[0]).toMatchObject({ shooter, target: victim, soundType: BLOCK_SOUND, at: VICTIM });
    }
  });

  it('never from behind', () => {
    const { sim, shooter, victim } = setup(SHIELD_BEARER);
    const rolls = sim.rng.getState();
    const events = landShot(sim, shooter, victim, WEST);
    expect(sim.rng.getState()).toBe(rolls);
    expect(events.map((e) => e.kind)).toEqual(['projectileHit']);
    expect(sim.world.get(victim, Health).hitpoints).toBeLessThan(HITPOINTS);
  });

  it('lets the rest through when its chance is below certain', () => {
    const { sim, shooter, victim } = setup(SHIELD_BEARER, QUARTER_PCT);
    const outcomes = Array.from({ length: VOLLEY }, () =>
      landShot(sim, shooter, victim, EAST).map((e) => e.kind),
    );
    const blocked = outcomes.filter((kinds) => kinds.includes('arrowBlocked')).length;
    const landed = outcomes.filter((kinds) => kinds.includes('projectileHit')).length;
    expect(blocked).toBeGreaterThan(0);
    expect(landed).toBeGreaterThan(0);
    expect(blocked + landed).toBe(VOLLEY);
  });

  it('still turns its bearer on the shooter', () => {
    const { sim, shooter, victim } = setup(SHIELD_BEARER);
    setDiplomacyStance(sim.world, SHIELD_PLAYER, ARCHER_PLAYER, 'enemy');
    setDiplomacyStance(sim.world, ARCHER_PLAYER, SHIELD_PLAYER, 'enemy');
    sim.world.add(victim, Owner, { player: SHIELD_PLAYER });
    sim.world.add(victim, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
    sim.world.add(shooter, Owner, { player: ARCHER_PLAYER });
    expect(landShot(sim, shooter, victim, EAST).map((e) => e.kind)).toEqual(['arrowBlocked']);
    expect(sim.world.tryGet(victim, Engagement)?.target).toBe(shooter);
  });

  it('trains its shooter nothing from a blocked arrow, where a landed one trains him', () => {
    const blocked = setup(SHIELD_BEARER);
    landShot(blocked.sim, blocked.shooter, blocked.victim, EAST);
    expect(personalPoints(blocked.sim, blocked.shooter)).toBe(0);
    const landed = setup(PLAIN_SWORDSMAN);
    landShot(landed.sim, landed.shooter, landed.victim, EAST);
    expect(personalPoints(landed.sim, landed.shooter)).toBeGreaterThan(0);
  });
});

describe('an arrow nothing can block', () => {
  it('lands a siege shot and a shot on a weapon without a chance, drawing no roll', () => {
    for (const [job, siege] of [
      [SHIELD_BEARER, true],
      [PLAIN_SWORDSMAN, false],
    ] as const) {
      const { sim, shooter, victim } = setup(job);
      const rolls = sim.rng.getState();
      const events = landShot(sim, shooter, victim, EAST, siege);
      expect(sim.rng.getState()).toBe(rolls);
      expect(events.some((e) => e.kind === 'projectileHit')).toBe(true);
      expect(sim.world.get(victim, Health).hitpoints).toBe(HITPOINTS - ARROW_DAMAGE);
    }
  });
});
