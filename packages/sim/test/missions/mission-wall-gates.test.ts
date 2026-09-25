import { describe, expect, it } from 'vitest';
import { addWildlife, Palisade, Position } from '../../src/components/index.js';
import {
  type Entity,
  positionOfNode,
  type ScriptLandscapeType,
  type Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';
import { enableMissions, failedResultsNow, firingMission, scriptedSim } from './support.js';

const CLOSED = 696;
const OPEN = 700;
const ANCHOR = { hx: 8, hy: 8 } as const;
/** The gate's outermost blocked node: a script may name any point its body covers. */
const FLANK = { hx: ANCHOR.hx + 2, hy: ANCHOR.hy } as const;
const OWNER = 0;
const OTHER_PLAYER = 1;
const WOLF_TRIBE = 9;

const SPAN = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));

function gateType(typeId: number, open: boolean, counterpart: number): ScriptLandscapeType {
  return {
    typeId,
    walk: open
      ? [
          { dx: -2, dy: 0 },
          { dx: 2, dy: 0 },
        ]
      : SPAN,
    build: SPAN,
    groups: [],
    wall: {
      maxHitpoints: 100,
      repairPerStrike: 1,
      construction: [{ goodType: 5, amount: 1 }],
      gate: { open, counterpartGfxIndex: counterpart },
    },
  };
}

function gateMap(): TerrainMap {
  return {
    ...grassNodeMap(32, 32),
    landscapes: { types: [gateType(CLOSED, false, OPEN), gateType(OPEN, true, CLOSED)], placements: [] },
  };
}

/** A world whose script fires on the load pass, with one completed gate already standing. */
function gateSim(result: Parameters<typeof firingMission>[0][number], owner = OWNER): Simulation {
  const sim = scriptedSim([firingMission([result])], testContent(), gateMap());
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: CLOSED,
    x: ANCHOR.hx,
    y: ANCHOR.hy,
    tribe: 0,
    owner,
    underConstruction: false,
  });
  sim.step();
  return sim;
}

function theGate(sim: Simulation): Entity {
  const [gate, ...rest] = sim.world.query(Palisade);
  if (gate === undefined || rest.length > 0) throw new Error('expected exactly one gate');
  return gate;
}

function isOpen(sim: Simulation): boolean {
  return sim.world.get(theGate(sim), Palisade).gate?.open === true;
}

describe('1 Open/0 CloseWallGate', () => {
  it('opens the named player gate from any point its body covers', () => {
    const sim = gateSim({ opcode: '1 Open/0 CloseWallGate', player: OWNER, point: FLANK, flag: true });
    expect(isOpen(sim)).toBe(false);

    enableMissions(sim);
    sim.step();

    expect(isOpen(sim)).toBe(true);
    expect(failedResultsNow(sim)).toEqual([]);
  });

  it('closes through the same transition a seat command uses', () => {
    const sim = gateSim({ opcode: '1 Open/0 CloseWallGate', player: OWNER, point: ANCHOR, flag: false });
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: theGate(sim), open: true });
    sim.step();
    expect(isOpen(sim)).toBe(true);

    enableMissions(sim);
    sim.step();

    expect(isOpen(sim)).toBe(false);
    expect(failedResultsNow(sim)).toEqual([]);
  });

  it('reports the failure instead of closing onto an occupant', () => {
    const sim = gateSim({ opcode: '1 Open/0 CloseWallGate', player: OWNER, point: ANCHOR, flag: false });
    sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: theGate(sim), open: true });
    sim.step();
    // Only a mover blocks a closing gate, so the occupant needs to be one.
    const occupant = sim.world.create();
    sim.world.add(occupant, Position, positionOfNode(ANCHOR.hx, ANCHOR.hy));
    addWildlife(sim.world, occupant, WOLF_TRIBE);

    enableMissions(sim);
    sim.step();

    expect(isOpen(sim)).toBe(true);
    expect(failedResultsNow(sim)).toEqual(['1 Open/0 CloseWallGate']);
  });

  it('reports a gate belonging to another player', () => {
    const sim = gateSim(
      { opcode: '1 Open/0 CloseWallGate', player: OWNER, point: ANCHOR, flag: true },
      OTHER_PLAYER,
    );

    enableMissions(sim);
    sim.step();

    expect(isOpen(sim)).toBe(false);
    expect(failedResultsNow(sim)).toEqual(['1 Open/0 CloseWallGate']);
  });

  it('reports a point with no gate on it', () => {
    const sim = gateSim({
      opcode: '1 Open/0 CloseWallGate',
      player: OWNER,
      point: { hx: 20, hy: 20 },
      flag: true,
    });

    enableMissions(sim);
    sim.step();

    expect(isOpen(sim)).toBe(false);
    expect(failedResultsNow(sim)).toEqual(['1 Open/0 CloseWallGate']);
  });
});
