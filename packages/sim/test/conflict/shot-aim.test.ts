import { describe, expect, it } from 'vitest';
import { MoveSpeed, PathFollow, PathRoute, Position } from '../../src/components/index.js';
import { fx, positionOfNode, Simulation } from '../../src/index.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import {
  leadPoint,
  marksmanSpread,
  scatteredNode,
  shelterSpread,
} from '../../src/systems/conflict/shot-aim.js';
import { VIKING } from '../conflict/combat-system/support.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { addSettlerOfTribe } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

const DRAWS = 400;
const LONG_SHOT_NODES = 20;
/** Under four nodes a quarter of the range rounds to nothing, so no shot can scatter. */
const POINT_BLANK_NODES = 3;
/** Hits past which a bowman never scatters: the roll tops out at 99, against hits plus 10. */
const MARKSMAN_BOW_HITS = 90;
const BOW_SPEED = 8;

function sim(): Simulation {
  return new Simulation({ seed: 7, content: testContent(), map: grassCellMap(32, 32) });
}

describe('shot scatter', () => {
  it('a novice strays on most long shots, never beyond a quarter of the range', () => {
    const s = sim();
    const spreads = Array.from({ length: DRAWS }, () => marksmanSpread(ctxOf(s), LONG_SHOT_NODES, 0));
    const strays = spreads.filter((spread) => spread > 0).length;
    expect(strays).toBeGreaterThan(DRAWS / 2);
    expect(Math.max(...spreads)).toBeLessThanOrEqual(LONG_SHOT_NODES / 4);
  });

  it('a practised bowman and a point-blank shot land true', () => {
    const s = sim();
    for (let i = 0; i < DRAWS; i++) {
      expect(marksmanSpread(ctxOf(s), LONG_SHOT_NODES, MARKSMAN_BOW_HITS)).toBe(0);
      expect(marksmanSpread(ctxOf(s), POINT_BLANK_NODES, 0)).toBe(0);
    }
  });

  it("a building's long shot mostly lands true", () => {
    const s = sim();
    const strays = Array.from({ length: DRAWS }, () => shelterSpread(ctxOf(s), LONG_SHOT_NODES)).filter(
      (spread) => spread > 0,
    ).length;
    expect(strays).toBeGreaterThan(0);
    expect(strays).toBeLessThan(DRAWS / 2);
  });

  it('shifts the landing within the spread, centred on the mark', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapless sim');
    const mark = terrain.nodeAtClamped(20, 20);
    const spread = 4;
    const seen = new Set<number>();
    for (let i = 0; i < DRAWS; i++) {
      const landing: NodeId = scatteredNode(ctxOf(s), terrain, mark, spread);
      const dx = terrain.xOf(landing) - terrain.xOf(mark);
      const dy = terrain.yOf(landing) - terrain.yOf(mark);
      expect(Math.abs(dx)).toBeLessThanOrEqual(spread / 2);
      expect(Math.abs(dy)).toBeLessThanOrEqual(spread / 2);
      seen.add(dx);
    }
    expect(seen.size).toBe(spread + 1);
    expect(scatteredNode(ctxOf(s), terrain, mark, 0)).toBe(mark);
  });
});

describe('leading a walker', () => {
  it('aims where a walking target will be when the shot comes down', () => {
    const s = sim();
    const walker = s.world.create();
    const start = positionOfNode(10, 10);
    s.world.add(walker, Position, { x: start.x, y: start.y });
    const pace = fx.div(fx.fromInt(1), fx.fromInt(BOW_SPEED)); // an eighth of a tile a tick
    s.world.add(walker, MoveSpeed, { perTick: pace });
    const end = positionOfNode(30, 10);
    s.world.add(walker, PathRoute, { waypoints: [{ x: end.x, y: end.y, node: 0 as NodeId }] });
    s.world.add(walker, PathFollow, { index: 0, legTicks: 0, legCost: 0 });
    const from = positionOfNode(10, 2);

    const lead = leadPoint(s.world, ctxOf(s), from, walker, BOW_SPEED);
    expect(lead.y).toBe(start.y);
    expect(lead.x).toBeGreaterThan(start.x); // ahead along its walk
    expect(lead.x).toBeLessThan(end.x);

    // A shot at a standing target aims at it.
    s.world.remove(walker, PathFollow);
    expect(leadPoint(s.world, ctxOf(s), from, walker, BOW_SPEED)).toEqual(start);
  });

  it('leads a walking person on the tick it steps onto a node, before its next leg is timed', () => {
    const s = sim();
    const walker = s.world.create();
    const start = positionOfNode(10, 10);
    s.world.add(walker, Position, { x: start.x, y: start.y });
    addSettlerOfTribe(s, walker, {
      tribe: VIKING,
      jobType: null,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    const next = positionOfNode(12, 10);
    const end = positionOfNode(30, 10);
    s.world.add(walker, PathRoute, {
      waypoints: [
        { x: start.x, y: start.y, node: 0 as NodeId },
        { x: next.x, y: next.y, node: 0 as NodeId },
        { x: end.x, y: end.y, node: 0 as NodeId },
      ],
    });
    s.world.add(walker, PathFollow, { index: 1, legTicks: 0, legCost: 0 });

    const lead = leadPoint(s.world, ctxOf(s), positionOfNode(10, 2), walker, BOW_SPEED);
    expect(lead.x).toBeGreaterThan(start.x);
  });
});
