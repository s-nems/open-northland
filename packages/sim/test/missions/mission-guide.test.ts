import { describe, expect, it } from 'vitest';
import {
  Owner,
  Position,
  SIGNPOST_NAV_RADIUS_NODES,
  SIGNPOST_SPACING_RADIUS_NODES,
  Signpost,
} from '../../src/components/index.js';
import type { Simulation } from '../../src/index.js';
import { type HalfCellNode, positionOfNode } from '../../src/nav/halfcell.js';
import { guideNearPoint } from '../../src/systems/missions/goals/proximity.js';
import { FIRST_PASS, goalSim, holds, POINT, roundTrip, spawn, stamped } from './support.js';

const PLAYER = 0;
const OTHER_PLAYER = 1;
const SCOUT = 27;
const SCOUT_ID = 7;
const GOAL = { opcode: 'DetectGuide', player: PLAYER, point: POINT, range: 0 } as const;

function post(sim: Simulation, point: HalfCellNode, player = PLAYER) {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(point.hx, point.hy));
  sim.world.add(e, Owner, { player });
  sim.world.add(e, Signpost, {
    navRadius: SIGNPOST_NAV_RADIUS_NODES,
    spacingRadius: SIGNPOST_SPACING_RADIUS_NODES,
  });
  return e;
}

describe('DetectGuide', () => {
  it.each([
    { point: POINT, range: 0, expected: true },
    { point: { hx: POINT.hx + 1, hy: POINT.hy }, range: 0, expected: false },
    { point: { hx: POINT.hx + 2, hy: POINT.hy + 4 }, range: 4, expected: true },
    { point: { hx: POINT.hx + 3, hy: POINT.hy + 4 }, range: 4, expected: false },
    { point: POINT, range: -1, expected: false },
  ])('checks inclusive map-point distance: $point, range $range', ({ point, range, expected }) => {
    const sim = goalSim({ ...GOAL, range });
    post(sim, point);
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(expected);
  });

  it('ignores another player and entities without a standing signpost', () => {
    const sim = goalSim(GOAL);
    post(sim, POINT, OTHER_PLAYER);
    const decoration = sim.world.create();
    sim.world.add(decoration, Position, positionOfNode(POINT.hx, POINT.hy));
    sim.world.add(decoration, Owner, { player: PLAYER });
    spawn(sim, { player: PLAYER, job: SCOUT });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
  });

  it('reads current ownership and demolition rather than latching a detection', () => {
    const sim = goalSim(GOAL);
    const e = post(sim, POINT, OTHER_PLAYER);
    expect(guideNearPoint(sim.world, GOAL)).toBe(false);
    sim.world.mut(e, Owner).player = PLAYER;
    expect(guideNearPoint(sim.world, GOAL)).toBe(true);
    sim.enqueueSetup({ kind: 'demolishSignpost', signpost: e });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
  });

  it('satisfies a pending mission after a scout erects the post, including after restore', () => {
    const sim = goalSim(GOAL);
    spawn(sim, { player: PLAYER, job: SCOUT, missionId: SCOUT_ID });
    sim.run(FIRST_PASS);
    expect(holds(sim)).toBe(false);
    sim.enqueueSetup({ kind: 'placeSignpost', entity: stamped(sim, SCOUT_ID), x: POINT.hx, y: POINT.hy });
    sim.step();
    expect(guideNearPoint(sim.world, GOAL)).toBe(false);
    const restored = roundTrip(sim);
    sim.run(FIRST_PASS * 4);
    restored.run(FIRST_PASS * 4);
    expect(holds(sim)).toBe(true);
    expect(restored.hashState()).toBe(sim.hashState());
    expect(guideNearPoint(roundTrip(sim).world, GOAL)).toBe(true);
  });
});
