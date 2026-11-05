import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  GroundPlan,
  SeatRoom,
  type SeatRoomState,
} from '../../../../src/components/index.js';
import type { Simulation } from '../../../../src/index.js';
import {
  COMPUTER_DECISION_INTERVAL_TICKS,
  computerDecisionDue,
  decisionIndex,
  moduleBeatDue,
} from '../../../../src/systems/ai-shared/cadence.js';
import type { BuildOrderEntry } from '../../../../src/systems/computer-player/build-order/entries.js';
import { GROUND_PLAN_FROM_TICKS } from '../../../../src/systems/computer-player/build-order/ground-plan.js';
import {
  FIT_PER_HOME,
  nextRoomReviewTick,
  ROOM_HOMES_CAP,
  ROOM_REVIEW_EVERY_DECISIONS,
  roomHomesCap,
} from '../../../../src/systems/computer-player/build-order/room.js';
import { buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import {
  BARRACKS_AND_HOME_END,
  contextOf,
  decide,
  HQ,
  island,
  LONG_END,
} from '../../../fixtures/island-strip.js';
import { BARRACKS_TYPE, oneLine, SEAT, VIKING } from '../support.js';

/** A node in the middle of the long strip, where a barracks takes room off it. */
const STRIP_MIDDLE_X = 38;

const HELD = { kind: 'tick', tick: Number.MAX_SAFE_INTEGER } as const;
const HELD_HOME: BuildOrderEntry = { kind: 'place', building: 'home_level_00', count: 1, holdUntil: HELD };

function roomOf(sim: Simulation): SeatRoomState {
  const carrier = aiControlEntity(sim.world, SEAT);
  const room = carrier === null ? undefined : sim.world.tryGet(carrier, SeatRoom);
  if (room === undefined) throw new Error('expected the seat room');
  return { ...room };
}

/** The seat's room as a review left it: `freeZones` free zones beside `homes` homes. */
function setFreeZones(sim: Simulation, freeZones: number, homes = 0): void {
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: an AI seat');
  const room = { freeZones, homes, reviewTick: Number.MAX_SAFE_INTEGER };
  if (sim.world.has(carrier, SeatRoom)) Object.assign(sim.world.mut(carrier, SeatRoom), room);
  else sim.world.add(carrier, SeatRoom, room);
}

describe('seat room', () => {
  it('measures the home zones free on the land, more on more land, again only at its review', () => {
    const long = island(LONG_END, []);
    decide(long, [HELD_HOME]);
    const short = island(BARRACKS_AND_HOME_END, []);
    decide(short, [HELD_HOME]);
    expect(roomOf(short).freeZones).toBeGreaterThan(0);
    expect(roomOf(long).freeZones).toBeGreaterThan(roomOf(short).freeZones);

    const measured = roomOf(long);
    // A building on the strip takes room, seen at the next review and not before.
    long.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BARRACKS_TYPE,
      x: STRIP_MIDDLE_X,
      y: HQ.y,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
    long.step();
    decide(long, [HELD_HOME]);
    expect(roomOf(long)).toEqual(measured);
    expect(measured.reviewTick).toBe(nextRoomReviewTick(contextOf(long).tick, SEAT));
    buildOrderModule(oneLine([HELD_HOME])).run(
      long.world,
      { ...contextOf(long), tick: measured.reviewTick },
      SEAT,
    );
    expect(roomOf(long).freeZones).toBeLessThan(measured.freeZones);
  });

  it('measures a seat with no room only once its plots are drawn', () => {
    const sim = island(BARRACKS_AND_HOME_END);
    const at = (tick: number) =>
      buildOrderModule(oneLine([HELD_HOME])).run(sim.world, { ...contextOf(sim), tick }, SEAT);
    const carrier = aiControlEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('setup: an AI seat');
    at(1);
    expect(sim.world.has(carrier, SeatRoom)).toBe(false);
    at(GROUND_PLAN_FROM_TICKS);
    expect(sim.world.get(carrier, GroundPlan).drawn).toBe(true);
    expect(sim.world.has(carrier, SeatRoom)).toBe(false);
    // Measured on the decision after the draw, which the plots are already standing on.
    at(GROUND_PLAN_FROM_TICKS + 1);
    expect(sim.world.has(carrier, SeatRoom)).toBe(true);
  });

  it("staggers the seats' reviews: each on its own decision tick, in its own decision interval", () => {
    const SEATS = [0, 1, 2, 3, 4, 5];
    const ticks = SEATS.map((seat) => nextRoomReviewTick(0, seat));
    for (const [seat, tick] of ticks.entries()) {
      expect(computerDecisionDue(tick, seat)).toBe(true);
      expect(moduleBeatDue(tick, seat, ROOM_REVIEW_EVERY_DECISIONS)).toBe(true);
      expect(nextRoomReviewTick(tick, seat) - tick).toBe(
        ROOM_REVIEW_EVERY_DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS,
      );
    }
    expect(new Set(ticks.map((tick) => decisionIndex(tick))).size).toBe(SEATS.length);
  });

  it('lifts the homes past their cap to the room the review saw, two zones a home, up to the room cap', () => {
    const sim = island(LONG_END, []);
    const CAP = 4;
    setFreeZones(sim, 3 * FIT_PER_HOME, CAP - 1);
    expect(roomHomesCap(sim.world, SEAT, CAP)).toBe(CAP);
    // Four homes and six free zones: ten zones, five homes.
    setFreeZones(sim, 3 * FIT_PER_HOME, CAP);
    expect(roomHomesCap(sim.world, SEAT, CAP)).toBe(CAP + 1);
    // Eight free zones beside four homes: six homes.
    setFreeZones(sim, 4 * FIT_PER_HOME, CAP);
    expect(roomHomesCap(sim.world, SEAT, CAP)).toBe((CAP * 3) / 2);
    setFreeZones(sim, FIT_PER_HOME - 1, CAP);
    expect(roomHomesCap(sim.world, SEAT, CAP)).toBe(CAP);
    setFreeZones(sim, 4 * ROOM_HOMES_CAP, CAP);
    expect(roomHomesCap(sim.world, SEAT, CAP)).toBe(ROOM_HOMES_CAP);
  });
});
