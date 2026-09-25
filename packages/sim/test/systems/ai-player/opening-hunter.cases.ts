import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  CurrentAtomic,
  JobAssignment,
  Settler,
  StayPoint,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { OPENING_HUNT_UNTIL_TICKS } from '../../../src/systems/ai-player/game-phase.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  BAKERY_TOP_TYPE,
  BUILDER,
  collectModule,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  HUNTER,
  huntingContent,
  placeHq,
  SCOUT,
  SEAT,
  spawnMen,
  VIKING,
} from './support.js';

/** The opening hunt: one headquarters-employed hunter while game grazes near the base, until the clock
 *  or the level-2 bakery ends it. */

const DEER = 14;
const MEAT = 8;
const MEAT_HARVEST = 34;
/** Node offsets from the headquarters: inside the base's hunting ground, and past its chase leash on a
 *  map wide enough to hold it. */
const NEAR_GAME_DX = 10;
const FAR_GAME_DX = 90;
const WIDE_MAP_NODES = 128;

/** {@link huntingContent} plus a huntable deer whose carcass yields meat. */
function gameContent(): ContentSet {
  const base = huntingContent();
  return parseContentSet({
    ...base,
    goods: [...base.goods, { typeId: MEAT, id: 'meat', weight: 1, atomics: { harvest: MEAT_HARVEST } }],
    tribes: [...base.tribes, { typeId: DEER, id: 'deer' }],
    animals: [...base.animals, { id: 'deer', tribeType: DEER, hitpointsAdult: 1000 }],
    huntPrey: [...base.huntPrey, { tribeType: DEER, yields: [{ goodType: MEAT, amount: 2 }] }],
  });
}

function spawnDeer(sim: Simulation, x: number, y: number): Entity {
  sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: DEER, x, y, count: 1 });
  sim.step();
  const deer = [...sim.world.query(StayPoint, Settler)].find((e) => sim.world.get(e, Settler).tribe === DEER);
  if (deer === undefined) throw new Error('expected a spawned deer');
  return deer;
}

/** A seat with an HQ, four men and a deer grazing beside it, its hunter already posted. */
function postedHunt(): { sim: Simulation; content: ContentSet; hunter: Entity; deer: Entity } {
  const content = gameContent();
  const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
  placeHq(sim);
  spawnMen(sim, 4);
  const deer = spawnDeer(sim, HQ_X + NEAR_GAME_DX, HQ_Y);
  const ctx = { ...ctxOf(sim), content };
  for (const c of collectModule.run(sim.world, ctx, SEAT)) if (c.kind === 'assignWorker') sim.enqueueSetup(c);
  sim.step();
  const hunter = [...sim.world.query(Settler, JobAssignment)].find(
    (e) => sim.world.get(e, Settler).jobType === HUNTER,
  );
  if (hunter === undefined) throw new Error('expected a posted hunter');
  return { sim, content, hunter, deer };
}

function retirements(sim: Simulation, content: ContentSet, hunter: Entity, tick = 0): unknown[] {
  const ctx = { ...ctxOf(sim, tick), content };
  return [...collectModule.run(sim.world, ctx, SEAT)].filter(
    (c) => c.kind === 'setJob' && c.entity === hunter,
  );
}

describe('workforce module - the opening hunter', () => {
  it('posts one headquarters hunter, then hands him back once the level-2 bakery stands', () => {
    const content = gameContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
    placeHq(sim);
    spawnMen(sim, 4);
    spawnDeer(sim, HQ_X + NEAR_GAME_DX, HQ_Y);
    const ctx = { ...ctxOf(sim), content };
    const hq = entityOfBuilding(sim, HQ_TYPE);

    const posts = [...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'assignWorker');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ building: hq, jobPriority: [HUNTER] });
    for (const c of posts) sim.enqueueSetup(c);
    sim.step();

    // One post, not one per decision: the standing hunter is recognized and nobody else is drafted.
    const hunter = [...sim.world.query(Settler, JobAssignment)].find(
      (e) => sim.world.get(e, Settler).jobType === HUNTER,
    );
    if (hunter === undefined) throw new Error('expected a posted hunter');
    expect(sim.world.get(hunter, JobAssignment).workplace).toBe(hq);
    expect([...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'assignWorker')).toEqual([]);

    // The milestone lands: the hunt ends and the man rejoins the pool as a builder.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TOP_TYPE,
      x: 36,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctx, SEAT)].filter((c) => c.kind === 'setJob' && c.entity === hunter),
    ).toEqual([{ kind: 'setJob', entity: hunter, jobType: BUILDER }]);
  });

  it('hands the hunter back once the opening hunt clock runs out, game or no game', () => {
    const { sim, content, hunter } = postedHunt();
    expect(retirements(sim, content, hunter, OPENING_HUNT_UNTIL_TICKS - 1)).toEqual([]);
    expect(retirements(sim, content, hunter, OPENING_HUNT_UNTIL_TICKS)).toEqual([
      { kind: 'setJob', entity: hunter, jobType: BUILDER },
    ]);
  });

  it('hands an idle hunter back early once no game is left in reach, and does not rehire', () => {
    const { sim, content, hunter, deer } = postedHunt();
    sim.world.destroy(deer);
    expect(sim.world.has(hunter, CurrentAtomic)).toBe(false);
    expect(retirements(sim, content, hunter)).toEqual([{ kind: 'setJob', entity: hunter, jobType: BUILDER }]);
    sim.enqueueSetup({ kind: 'setJob', entity: hunter, jobType: BUILDER });
    sim.step();
    const again = [...collectModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)];
    expect(again.filter((c) => c.kind === 'assignWorker' && c.jobPriority?.includes(HUNTER))).toEqual([]);
  });

  it('keeps a hunter mid-action even with the game gone', () => {
    const { sim, content, hunter, deer } = postedHunt();
    sim.world.destroy(deer);
    addCurrentAtomic(sim.world, hunter, {
      atomicId: MEAT_HARVEST,
      duration: 1,
      effect: { kind: 'sleep' },
      targetEntity: null,
      targetTile: null,
    });
    expect(retirements(sim, content, hunter)).toEqual([]);
  });

  it('posts nobody while no game grazes on the base hunting ground', () => {
    const content = gameContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(WIDE_MAP_NODES, 32) });
    placeHq(sim);
    spawnMen(sim, 4);
    spawnDeer(sim, HQ_X + FAR_GAME_DX, HQ_Y);
    const commands = [...collectModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)];
    expect(commands.filter((c) => c.kind === 'assignWorker')).toEqual([]);
  });

  it('outranks the scout for the last spare man', () => {
    // The phase sits between the collectors and the scout hire, and neither the map's resources nor
    // the lattice matter to that order - with one man to hand, the hunt takes him and the scout post
    // waits for the next grown son.
    const content = gameContent();
    const sim = new Simulation({ seed: 1, content, map: grassNodeMap(64, 32) });
    placeHq(sim);
    spawnMen(sim, 1);
    spawnDeer(sim, HQ_X + NEAR_GAME_DX, HQ_Y);

    const commands = [...collectModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)];
    expect(commands.filter((c) => c.kind === 'assignWorker')).toHaveLength(1);
    expect(commands.filter((c) => c.kind === 'setJob' && c.jobType === SCOUT)).toEqual([]);
  });

  it('hires nobody when the headquarters offers no hunter seat', () => {
    // The base fixture's HQ carries transport and collector slots only - an assignment that could
    // never take must not be issued every decision.
    const sim = aiSim();
    placeHq(sim);
    spawnMen(sim, 4);
    sim.step();
    expect(
      [...collectModule.run(sim.world, ctxOf(sim), SEAT)].filter((c) => c.kind === 'assignWorker'),
    ).toEqual([]);
  });
});
