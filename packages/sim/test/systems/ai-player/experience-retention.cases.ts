import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Carrying,
  JobAssignment,
  removeCurrentAtomic,
  SettlerProgress,
} from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { ownedSettlers } from '../../../src/systems/ai-player/seat-roster.js';
import type { WantedGood } from '../../../src/systems/ai-player/workforce/collectors/index.js';
import { classifyWorkforce, SpareForce } from '../../../src/systems/ai-player/workforce/pool.js';
import { reserveBuilders } from '../../../src/systems/ai-player/workforce/staffing.js';
import { aiContent } from '../../fixtures/ai-content.js';
import {
  aiSim,
  BUILDER,
  CIVILIST,
  COLLECTOR,
  collectModule,
  completeSites,
  ctxOf,
  entityOfBuilding,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  spawnMen,
  VIKING,
  WOOD,
  WOOD_HARVEST,
} from './support.js';

/** The mason trade on its real job id, and a two-seat mason hut on a free fixture building id. */
const MASON = 12;
const MASON_HUT_TYPE = 18;
const MASON_HUT_SPOT = { x: 40, y: 16 };
/** The real content's track ids: builder general, collector wood, mason general. */
const BUILDER_XP_TRACK = 1;
const WOOD_XP_TRACK = 3;
const MASON_XP_TRACK = 25;
/** The base data's track factors: 100 per repeat for most trades, 5 for the builder. */
const XP_FACTOR = 100;
const BUILDER_XP_FACTOR = 5;
/** Repeats that mark a man who has plainly worked the trade. */
const VETERAN_REPEATS = 10;
const VETERAN_XP = VETERAN_REPEATS * XP_FACTOR;

/** The AI fixture plus a mason hut with two mason seats and the three tracks the cases rank by. */
function experienceContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    jobs: [...base.jobs, { typeId: MASON, id: 'mason' }],
    buildings: [
      ...base.buildings,
      {
        typeId: MASON_HUT_TYPE,
        id: 'work_mason_hut_00',
        kind: 'workplace' as const,
        workers: [{ jobType: MASON, count: 2 }],
        construction: [{ goodType: WOOD, amount: 2 }],
      },
    ],
    jobExperience: [
      ...base.jobExperience,
      {
        typeId: BUILDER_XP_TRACK,
        id: 'builder_general',
        jobType: BUILDER,
        goodTypes: [],
        experienceFactor: BUILDER_XP_FACTOR,
      },
      {
        typeId: WOOD_XP_TRACK,
        id: 'collector_wood',
        jobType: COLLECTOR,
        goodTypes: [WOOD],
        experienceFactor: XP_FACTOR,
      },
      {
        typeId: MASON_XP_TRACK,
        id: 'mason_general',
        jobType: MASON,
        goodTypes: [],
        experienceFactor: XP_FACTOR,
      },
    ],
  });
}

interface Seat {
  readonly sim: Simulation;
  readonly content: ContentSet;
  /** The seat's men in ascending id order. */
  readonly men: readonly Entity[];
  decide(): Command[];
  apply(commands: readonly Command[]): void;
}

/** A seat with its HQ, `men` men of `job` and, when `withHut`, a built mason hut. */
function seatWith(men: number, withHut: boolean, job = BUILDER): Seat {
  const content = experienceContent();
  const sim = aiSim(1, content);
  placeHq(sim);
  if (withHut) {
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: MASON_HUT_TYPE,
      ...MASON_HUT_SPOT,
      tribe: VIKING,
      owner: SEAT,
    });
  }
  spawnMen(sim, men, job);
  sim.step();
  completeSites(sim);
  return {
    sim,
    content,
    men: [...ownedSettlers(sim.world, SEAT)],
    decide: () => [...collectModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)],
    apply(commands) {
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
    },
  };
}

function grant(seat: Seat, e: Entity, track: number, xp: number): void {
  seat.sim.world.mut(e, SettlerProgress).experience.set(track, xp);
}

function manAt(seat: Seat, index: number): Entity {
  const e = seat.men[index];
  if (e === undefined) throw new Error(`setup: man ${index} missing`);
  return e;
}

/** Keeping the same men on their trades: experience speeds their work, so the allocator hires the veteran,
 *  keeps him when it cuts a crew, and builds its reserve from the men with the least to lose. */
describe('workforce module - experience retention', () => {
  it('posts the veteran mason over a green man ahead of him in the pool', () => {
    // Four builders: the scout takes the first spare in pool order, then the hut's one minimum post.
    const seat = seatWith(4, true);
    const veteran = manAt(seat, 3);
    grant(seat, veteran, MASON_XP_TRACK, VETERAN_XP);
    const hut = entityOfBuilding(seat.sim, MASON_HUT_TYPE);
    const hires = seat.decide().filter((c) => c.kind === 'assignWorker' && c.building === hut);
    expect(hires).toEqual([{ kind: 'assignWorker', entity: veteran, building: hut, jobPriority: [MASON] }]);
  });

  it('builds the reserve from the man with the least experience outside the building trade', () => {
    // Civilists, so none is an existing builder the reserve keeps first.
    const seat = seatWith(3, false, CIVILIST);
    const mason = manAt(seat, 0);
    const oldBuilder = manAt(seat, 1);
    const green = manAt(seat, 2);
    grant(seat, mason, MASON_XP_TRACK, VETERAN_XP);
    // Builder experience is no trade the site would waste, so he ties with the green man and leads him
    // in pool order.
    grant(seat, oldBuilder, BUILDER_XP_TRACK, VETERAN_XP);
    const ctx = { ...ctxOf(seat.sim), content: seat.content };
    const civilistPool = (): SpareForce => new SpareForce([mason, oldBuilder, green]);
    expect(reserveBuilders(seat.sim.world, civilistPool(), BUILDER, 1, ctx)).toEqual([
      { kind: 'setJob', entity: oldBuilder, jobType: BUILDER },
    ]);
    expect(reserveBuilders(seat.sim.world, civilistPool(), BUILDER, 2, ctx)).toEqual([
      { kind: 'setJob', entity: oldBuilder, jobType: BUILDER },
      { kind: 'setJob', entity: green, jobType: BUILDER },
    ]);
  });

  it('claims the green builders first and leaves a released veteran free for his post', () => {
    const seat = seatWith(3, false);
    const mason = manAt(seat, 0);
    grant(seat, mason, MASON_XP_TRACK, VETERAN_XP);
    const ctx = { ...ctxOf(seat.sim), content: seat.content };
    const force = new SpareForce(seat.men);
    // Every man is a builder already, so the reserve claims without a command; the veteran mason, first
    // in pool order, is the one it leaves.
    expect(reserveBuilders(seat.sim.world, force, BUILDER, 2, ctx)).toEqual([]);
    expect(force.remaining()).toEqual([mason]);
  });

  it('hands back the green mason and keeps the veteran when the hut cuts its crew', () => {
    const seat = seatWith(4, true);
    const hut = entityOfBuilding(seat.sim, MASON_HUT_TYPE);
    const green = manAt(seat, 2);
    const veteran = manAt(seat, 3);
    seat.apply(
      [green, veteran].map((entity) => ({
        kind: 'assignWorker' as const,
        entity,
        building: hut,
        jobPriority: [MASON],
      })),
    );
    grant(seat, veteran, MASON_XP_TRACK, VETERAN_XP);
    for (const e of [green, veteran]) {
      expect(seat.sim.world.get(e, JobAssignment).workplace).toBe(hut);
      removeCurrentAtomic(seat.sim.world, e);
      if (seat.sim.world.has(e, Carrying)) seat.sim.world.remove(e, Carrying);
    }
    // The hut's plan keeps one mason: the veteran, though the green man has the lower id.
    const released = seat
      .decide()
      .filter((c) => c.kind === 'setJob' && (c.entity === green || c.entity === veteran));
    expect(released).toEqual([{ kind: 'setJob', entity: green, jobType: BUILDER }]);
  });

  it('caps a good at its target keeping the most experienced gatherers, veterans first', () => {
    const seat = seatWith(3, false);
    placeResources(seat.sim, [RESOURCE_SPOTS.wood]);
    seat.sim.step();
    const flagSpot = { x: RESOURCE_SPOTS.wood.x - 2, y: RESOURCE_SPOTS.wood.y };
    seat.apply(
      seat.men.flatMap((entity) => [
        { kind: 'setJob' as const, entity, jobType: COLLECTOR },
        { kind: 'setWorkFlag' as const, entity, ...flagSpot },
        { kind: 'setGatherGood' as const, entity, goodType: WOOD },
      ]),
    );
    const [first, second, veteran] = [manAt(seat, 0), manAt(seat, 1), manAt(seat, 2)];
    grant(seat, second, WOOD_XP_TRACK, XP_FACTOR);
    grant(seat, veteran, WOOD_XP_TRACK, VETERAN_XP);
    const ctx = { ...ctxOf(seat.sim), content: seat.content };
    const wood = seat.content.goods.find((g) => g.typeId === WOOD);
    if (wood === undefined) throw new Error('setup: wood missing');
    const wantedWood = (target: number): WantedGood[] => [
      { good: wood, harvestAtomic: WOOD_HARVEST, job: COLLECTOR, target, min: 1 },
    ];

    const one = classifyWorkforce(seat.sim.world, ctx, SEAT, wantedWood(1));
    expect(one.collectorsByGood.get(WOOD)).toEqual([veteran]);
    // The rest fall back to the pool in the canonical settler walk.
    expect(one.pool).toEqual([first, second]);
    const all = classifyWorkforce(seat.sim.world, ctx, SEAT, wantedWood(3));
    expect(all.collectorsByGood.get(WOOD)).toEqual([veteran, second, first]);
    expect(all.pool).toEqual([]);
  });

  it('posts the veteran gatherer on a fresh wood post over a green man ahead of him', () => {
    const seat = seatWith(2, false);
    placeResources(seat.sim, [RESOURCE_SPOTS.wood]);
    seat.sim.step();
    const veteran = manAt(seat, 1);
    grant(seat, veteran, WOOD_XP_TRACK, VETERAN_XP);
    const posts = seat.decide().filter((c) => c.kind === 'setGatherGood');
    expect(posts).toEqual([{ kind: 'setGatherGood', entity: veteran, goodType: WOOD }]);
  });
});
