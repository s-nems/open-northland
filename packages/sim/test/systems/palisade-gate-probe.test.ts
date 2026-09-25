import { beforeEach, describe, expect, it } from 'vitest';
import { addWildlife, Health, Palisade, Position, stampOwner } from '../../src/components/index.js';
import {
  cellOfNode,
  type Entity,
  positionOfNode,
  type ScriptLandscapeType,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { palisadeGateProbe } from '../../src/systems/palisades/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The original's conversion rule, one rejection per case: five of the player's own completed walls along
 * one hex direction, each at three quarters valency or better and within 8 height units of the centre.
 */

const NODES = 16;
const CELLS = NODES / 2;
const WALL_GFX = 691;
const OWNER = 0;
const OTHER_PLAYER = 1;
const TRIBE = 0;
const MAX_HP = 100;
/** The original's valency floor: three quarters of the maximum valency. */
const THREE_QUARTERS_HP = 75;
/** The centre of the run: hy 8 is an even row, so the span runs along hx. */
const CENTRE = { hx: 8, hy: 8 } as const;
const SPAN_HX: readonly [number, number, number, number, number] = [6, 7, 8, 9, 10];
const WOLF_TRIBE = 9;

const WALL: ScriptLandscapeType = {
  typeId: WALL_GFX,
  walk: [{ dx: 0, dy: 0 }],
  build: [{ dx: 0, dy: 0 }],
  groups: [],
  wall: {
    logicType: 82,
    maxHitpoints: MAX_HP,
    repairPerStrike: 3,
    construction: [{ goodType: 5, amount: 1 }],
  },
};

/** The three authored closed-gate orientations, shaped like the decoded `landscapes.cif` rows. */
const GATES: readonly { readonly typeId: number; readonly walk: { dx: number; dy: number }[] }[] = [
  // gate_01: the down-right diagonal.
  {
    typeId: 696,
    walk: [
      { dx: -1, dy: -2 },
      { dx: -1, dy: -1 },
      { dx: 0, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 2 },
    ],
  },
  // gate_02: the horizontal run.
  {
    typeId: 697,
    walk: [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 })),
  },
  // gate_03: the down-left diagonal.
  {
    typeId: 698,
    walk: [
      { dx: 1, dy: -2 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 0 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: 2 },
    ],
  },
];

function gateType(typeId: number, walk: { dx: number; dy: number }[]): ScriptLandscapeType {
  return {
    typeId,
    walk,
    build: walk,
    groups: [],
    wall: {
      logicType: 83,
      maxHitpoints: MAX_HP,
      repairPerStrike: 1,
      construction: [{ goodType: 5, amount: 1 }],
      gate: { open: false, counterpartGfxIndex: typeId + 4 },
    },
  };
}

const HORIZONTAL_GATE = 697;

function probeMap(elevation?: readonly number[]): TerrainMap {
  return {
    ...grassNodeMap(NODES, NODES),
    ...(elevation !== undefined ? { elevation } : {}),
    landscapes: {
      types: [WALL, ...GATES.map((gate) => gateType(gate.typeId, gate.walk))],
      placements: [],
    },
  };
}

/** A completed five-wall run along hy 8, owned by `OWNER`. */
function runOfFive(elevation?: readonly number[]): { sim: Simulation; walls: Map<number, Entity> } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: probeMap(elevation) });
  for (const hx of SPAN_HX) {
    sim.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL_GFX,
      x: hx,
      y: CENTRE.hy,
      tribe: TRIBE,
      owner: OWNER,
      force: true,
    });
  }
  sim.step();
  const walls = new Map<number, Entity>();
  for (const e of sim.world.query(Palisade, Position)) {
    walls.set(sim.world.get(e, Position).x as number, e);
  }
  return { sim, walls };
}

function wallAt(sim: Simulation, hx: number): Entity {
  for (const e of sim.world.query(Palisade, Position)) {
    const at = sim.world.get(e, Position);
    const centre = positionOfNode(hx, CENTRE.hy);
    if (at.x === centre.x && at.y === centre.y) return e;
  }
  throw new Error(`no wall at ${hx},${CENTRE.hy}`);
}

function probe(sim: Simulation) {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped fixture');
  return palisadeGateProbe(sim.world, terrain, CENTRE.hx, CENTRE.hy, [HORIZONTAL_GATE], OWNER);
}

describe('palisadeGateProbe', () => {
  let sim: Simulation;

  beforeEach(() => {
    sim = runOfFive().sim;
  });

  it('converts five of the player own completed walls and names the span it would clear', () => {
    const result = probe(sim);
    expect(result.canConvert).toBe(true);
    expect(result.axis).toBe(0);
    expect(result.gfxIndex).toBe(HORIZONTAL_GATE);
    expect(result.center).toBe(wallAt(sim, CENTRE.hx));
    expect(result.span.map((node) => node.hx)).toEqual([...SPAN_HX]);
    // Only the two neighbours go: the outer pair stays standing inside the gate's own body.
    expect(new Set(result.remove)).toEqual(new Set([wallAt(sim, 7), wallAt(sim, 9)]));
  });

  it('refuses a span member below three quarters of its maximum valency', () => {
    const edge = wallAt(sim, SPAN_HX[0]);
    sim.world.mut(edge, Health).hitpoints = THREE_QUARTERS_HP;
    expect(probe(sim).canConvert).toBe(true);

    sim.world.mut(edge, Health).hitpoints = THREE_QUARTERS_HP - 1;
    const result = probe(sim);
    expect(result.canConvert).toBe(false);
    // A rejected run still reports the centre and span, so the cursor can show why.
    expect(result.center).toBe(wallAt(sim, CENTRE.hx));
    expect(result.span).toHaveLength(SPAN_HX.length);
  });

  it('refuses a span member more than eight height units from the centre', () => {
    const lane = (units: number): number[] => {
      const heights = new Array<number>(CELLS * CELLS).fill(0);
      const cell = cellOfNode(SPAN_HX[4], CENTRE.hy);
      heights[cell.cy * CELLS + cell.cx] = units;
      return heights;
    };
    expect(probe(runOfFive(lane(8)).sim).canConvert).toBe(true);
    expect(probe(runOfFive(lane(9)).sim).canConvert).toBe(false);
  });

  it('refuses a span member owned by another player', () => {
    stampOwner(sim.world, wallAt(sim, SPAN_HX[4]), OTHER_PLAYER);
    expect(probe(sim).canConvert).toBe(false);
  });

  it('refuses a span member that is still a construction site', () => {
    const gap = runOfFive().sim;
    gap.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL_GFX,
      x: 12,
      y: CENTRE.hy,
      tribe: TRIBE,
      owner: OWNER,
      underConstruction: true,
      force: true,
    });
    gap.step();
    // The unfinished anchor is outside the span, so the run itself still converts.
    expect(probe(gap).canConvert).toBe(true);

    const unfinished = runOfFive().sim;
    unfinished.world.destroy(wallAt(unfinished, SPAN_HX[1]));
    unfinished.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL_GFX,
      x: SPAN_HX[1],
      y: CENTRE.hy,
      tribe: TRIBE,
      owner: OWNER,
      underConstruction: true,
      force: true,
    });
    unfinished.step();
    // Full valency, so only the unfinished marker itself can be the rejection.
    unfinished.world.mut(wallAt(unfinished, SPAN_HX[1]), Health).hitpoints = MAX_HP;
    expect(probe(unfinished).canConvert).toBe(false);
  });

  it('refuses a run with a gap where a span member should stand', () => {
    sim.world.destroy(wallAt(sim, SPAN_HX[0]));
    expect(probe(sim).canConvert).toBe(false);
  });

  it('refuses while a mover stands inside the gate body', () => {
    const wolf = sim.world.create();
    sim.world.add(wolf, Position, positionOfNode(CENTRE.hx, CENTRE.hy));
    addWildlife(sim.world, wolf, WOLF_TRIBE);
    expect(probe(sim).canConvert).toBe(false);

    sim.world.destroy(wolf);
    expect(probe(sim).canConvert).toBe(true);
  });

  it('reports no centre when the hovered node carries no wall', () => {
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped fixture');
    const away = palisadeGateProbe(sim.world, terrain, 4, 4, [HORIZONTAL_GATE], OWNER);
    expect(away.center).toBeNull();
    expect(away.canConvert).toBe(false);
    // The span is still reported, so the gate cursor draws a rejected run over open ground.
    expect(away.span).toHaveLength(SPAN_HX.length);
  });

  it('reads each authored orientation axis off its own walk cells', () => {
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped fixture');
    const axisOf = (typeId: number): number | null =>
      palisadeGateProbe(sim.world, terrain, CENTRE.hx, CENTRE.hy, [typeId], OWNER).axis;
    expect(GATES.map((gate) => axisOf(gate.typeId))).toEqual([1, 0, 2]);
  });

  it('offers every orientation in one query and returns the one that suits the run', () => {
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped fixture');
    const rows = GATES.map((gate) => gate.typeId);
    const result = palisadeGateProbe(sim.world, terrain, CENTRE.hx, CENTRE.hy, rows, OWNER);
    expect(result.canConvert).toBe(true);
    expect(result.gfxIndex).toBe(HORIZONTAL_GATE);
  });

  it('refuses a run the hovering player does not own', () => {
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped fixture');
    const foreign = palisadeGateProbe(
      sim.world,
      terrain,
      CENTRE.hx,
      CENTRE.hy,
      [HORIZONTAL_GATE],
      OTHER_PLAYER,
    );
    expect(foreign.canConvert).toBe(false);
    expect(foreign.center).toBe(wallAt(sim, CENTRE.hx));
  });
});
