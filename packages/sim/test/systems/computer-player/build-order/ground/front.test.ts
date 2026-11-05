import { describe, expect, it } from 'vitest';
import { mapBriefOf } from '../../../../../src/components/index.js';
import { Simulation } from '../../../../../src/index.js';
import { anchorNodeOf } from '../../../../../src/systems/ai-shared/node-geometry.js';
import { ownedBuildings } from '../../../../../src/systems/ai-shared/seat-roster.js';
import { seatBaseOf } from '../../../../../src/systems/computer-player/base.js';
import {
  enemiesSurround,
  FRONT_LINE_DEPTH_NODES,
  LINE_MAX_SHARE_PCT,
  RIVAL_LINE_ADVANCE_NODES,
  seatFrontLine,
} from '../../../../../src/systems/computer-player/build-order/ground/front.js';
import { seatTerritoryOf } from '../../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import { SUCCESSFUL_IF } from '../../../../../src/systems/missions/index.js';
import { aiContent } from '../../../../fixtures/ai-content.js';
import { grassNodeMap } from '../../../../fixtures/terrain.js';
import { ctxOf, HOME_TYPE, HQ_TYPE, makeAiSeat, SEAT, SPEARMAN, VIKING } from '../../support.js';

const MAP_NODES = 160;
const CENTRE = { x: 80, y: 80 };

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The seat's headquarters at `home`, one enemy headquarters per point of `enemies` (seats after it), the
 *  enemies allied among themselves when `team`, and the computer seat's first decision taken, so the map
 *  brief holds every start. */
function seats(home: Point, enemies: readonly Point[], team = false): Simulation {
  const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  const players = enemies.map((_, i) => SEAT + 1 + i);
  for (const [player, at] of [
    [SEAT, home],
    ...enemies.map((at, i) => [SEAT + 1 + i, at] as const),
  ] as const) {
    sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player, tribes: [VIKING] });
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...at, tribe: VIKING, owner: player });
  }
  if (team) {
    for (const from of players)
      for (const to of players)
        if (from !== to) sim.enqueueSetup({ kind: 'setDiplomacy', from, to, state: 'friend' });
  }
  makeAiSeat(sim, SEAT);
  sim.step();
  return sim;
}

function surrounded(sim: Simulation): boolean {
  const base = seatBaseOf(sim.world, ctxOf(sim), SEAT);
  const node = base === null ? null : anchorNodeOf(sim.world, base);
  if (node === null) throw new Error('setup: the seat has no base');
  return enemiesSurround(sim.world, SEAT, node);
}

describe('seat front', () => {
  it('holds no single front while enemies come from several sides, one against a team', () => {
    const WEST = { x: CENTRE.x - 60, y: CENTRE.y };
    const EAST = { x: CENTRE.x + 60, y: CENTRE.y };
    const NORTH = { x: CENTRE.x, y: CENTRE.y - 60 };
    const SOUTH_WEST = { x: CENTRE.x - 40, y: CENTRE.y + 60 };
    const SOUTH_EAST = { x: CENTRE.x + 40, y: CENTRE.y + 60 };
    expect(surrounded(seats(CENTRE, [WEST, NORTH, EAST]))).toBe(true);
    expect(surrounded(seats(CENTRE, [SOUTH_WEST, SOUTH_EAST]))).toBe(true);
    // The same two seats as one team march together, from the south.
    expect(surrounded(seats(CENTRE, [SOUTH_WEST, SOUTH_EAST], true))).toBe(false);
    expect(surrounded(seats(CENTRE, [EAST]))).toBe(false);

    const sim = seats(CENTRE, [WEST, NORTH, EAST]);
    expect(seatFrontLine(sim.world, ctxOf(sim), SEAT, ownedBuildings(sim.world, SEAT))).toBeNull();
  });

  it("stands a rival's line well ahead of the seat's farthest building, inside a tower's reach of it", () => {
    const HQ = { x: 10, y: 80 };
    // Just inside two line depths, where a rounding to whole depths stood the line right at the home.
    const AHEAD = 2 * FRONT_LINE_DEPTH_NODES - 1;
    const sim = seats(HQ, [{ x: 150, y: 80 }]);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ.x + AHEAD,
      y: HQ.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const owned = ownedBuildings(sim.world, SEAT);
    const line = seatFrontLine(sim.world, ctxOf(sim), SEAT, owned);
    const ahead = line?.slots(FRONT_LINE_DEPTH_NODES, 1)[0];
    const farthest = Math.max(...owned.map((e) => anchorNodeOf(sim.world, e)?.hx ?? 0));
    if (ahead === undefined) throw new Error('expected a front line toward the rival');
    expect(ahead.hx - farthest).toBeGreaterThanOrEqual(RIVAL_LINE_ADVANCE_NODES);
    expect(ahead.hx - farthest).toBeLessThan(RIVAL_LINE_ADVANCE_NODES + FRONT_LINE_DEPTH_NODES / 2);
  });

  it('stands no farther than halfway to a near rival, past whatever its farthest building wants', () => {
    const HQ = { x: 40, y: 80 };
    const RIVAL = { x: 100, y: 80 };
    const sim = seats(HQ, [RIVAL]);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HOME_TYPE,
      x: HQ.x + 24,
      y: HQ.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const line = seatFrontLine(sim.world, ctxOf(sim), SEAT, ownedBuildings(sim.world, SEAT));
    const halfway = HQ.x + ((RIVAL.x - HQ.x) * LINE_MAX_SHARE_PCT) / 100;
    expect(line?.slots(FRONT_LINE_DEPTH_NODES, 1)[0]).toEqual({ hx: halfway, hy: HQ.y });
    expect(line?.beyond(halfway + 1, HQ.y)).toBe(true);
    expect(line?.beyond(halfway, HQ.y)).toBe(false);
  });

  it("faces the rival when the forecast attacks set out from the seat's own base", () => {
    const sim = seats({ x: 40, y: 80 }, [{ x: 150, y: 80 }]);
    const anchor = seatTerritoryOf(mapBriefOf(sim.world), SEAT)?.anchor;
    if (anchor === undefined) throw new Error('setup: the seat has no start in the map brief');
    const RAIDER = 6;
    const results = [
      {
        opcode: 'SetHumanX' as const,
        player: RAIDER,
        tribe: VIKING,
        job: SPEARMAN,
        point: anchor,
        humanId: 1,
        behaviour: 0,
        amount: 6,
      },
      { opcode: 'SendHuman' as const, humanId: 1, point: anchor },
    ];
    const mission = { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [], results };
    const ctx = { ...ctxOf(sim), missions: { missions: [mission] } };
    const line = seatFrontLine(sim.world, ctx, SEAT, ownedBuildings(sim.world, SEAT));
    expect(line?.scripted).toBe(false);
    expect(line?.slots(FRONT_LINE_DEPTH_NODES, 1)[0]?.hx).toBeGreaterThan(anchor.hx);
  });
});
