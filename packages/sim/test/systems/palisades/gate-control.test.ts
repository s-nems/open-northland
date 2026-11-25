import { type ContentSet, type MapAiSeat, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  COMPUTER_MODULE_IDS,
  GateControl,
  Health,
  MoveGoal,
  Palisade,
  PathFollow,
  PathRoute,
  Position,
  pathFollowRecord,
  Settler,
  UnderConstruction,
  Vehicle,
  type Waypoint,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  ONE,
  positionOfNode,
  restoreSimulation,
  type ScriptLandscapeType,
  Simulation,
} from '../../../src/index.js';
import { nodeWorldX, positionXOfWorld } from '../../../src/nav/halfcell.js';
import { settlersByNode } from '../../../src/systems/movement/settler-nodes.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

/** Human and AI gates share one policy and the same spatial threat check. */

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const CIVILIST = 6;
const FIST = 31;
const SPEARMAN = 32;
const CATAPULT = 5;
const CLOSED = 696;
const OPEN = 700;
const WOOD = 1;

const HQ = { x: 24, y: 20 };
const GATE = { x: 40, y: 40 };
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
      construction: [{ goodType: WOOD, amount: 1 }],
      gate: { open, counterpartGfxIndex: counterpart },
    },
  };
}

/** {@link aiContent} with a catapult, the enemy vehicle a gate shuts for. */
const CONTENT: ContentSet = parseContentSet({
  ...aiContent(),
  vehicles: [
    {
      typeId: CATAPULT,
      id: 'catapult',
      jobId: 54,
      stockSlots: 0,
      logicSize: 1,
      passengerJobs: [FIST, SPEARMAN],
      commanderJob: FIST,
      hitpoints: 3000,
    },
  ],
});

const MAP = {
  ...grassNodeMap(128, 96),
  landscapes: { types: [gateType(CLOSED, false, OPEN), gateType(OPEN, true, CLOSED)], placements: [] },
};

function gateSim(scripted = true, allDisabled = false): Simulation {
  const row: MapAiSeat = {
    player: SEAT,
    allDisabled,
    computerDisabled: true,
    disabledComputerModules: [...COMPUTER_MODULE_IDS],
    conditions: [],
    tasks: [],
  };
  const sim = new Simulation({
    seed: 1,
    content: CONTENT,
    map: MAP,
    ...(scripted ? { mapAiScript: [row] } : {}),
  });
  const off = Object.fromEntries(COMPUTER_MODULE_IDS.map((id) => [id, false]));
  sim.enqueueSetup({
    kind: 'setAiControl',
    player: SEAT,
    enabled: true,
    modules: off,
    ...(allDisabled ? { mapAiEnabled: false } : {}),
  });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, ...HQ, tribe: VIKING, owner: SEAT });
  sim.step();
  return sim;
}

function placeGate(sim: Simulation, at: { x: number; y: number }, open: boolean, owner = SEAT): Entity {
  const before = new Set(sim.world.query(Palisade));
  sim.enqueueSetup({
    kind: 'placePalisade',
    gfxIndex: open ? OPEN : CLOSED,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner,
    underConstruction: false,
  });
  sim.step();
  const placed = [...sim.world.query(Palisade)].find((e) => !before.has(e));
  if (placed === undefined) throw new Error('setup: the gate was refused');
  return placed;
}

function spawn(sim: Simulation, at: { x: number; y: number }, jobType: number, owner = FOE): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType, ...at, tribe: VIKING, owner });
  sim.step();
  const born = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (born === undefined) throw new Error('setup: the spawn was refused');
  return born;
}

function isOpen(sim: Simulation, gate: Entity): boolean {
  return sim.world.get(gate, Palisade).gate?.open === true;
}
function mode(sim: Simulation, gate: Entity, mode: 'open' | 'closed' | 'automatic'): void {
  sim.enqueueSetup({ kind: 'setPalisadeGateMode', palisade: gate, mode });
  sim.step();
}

describe('shared gate control', () => {
  it.each([true, false])('adopts new AI gates immediately (scripted: %s)', (scripted) => {
    const sim = gateSim(scripted);
    const gate = placeGate(sim, GATE, false);
    expect(sim.world.get(gate, GateControl).mode).toBe('automatic');
    expect(isOpen(sim, gate)).toBe(true);
    const enemy = spawn(sim, { x: 43, y: 44 }, SPEARMAN);
    expect(isOpen(sim, gate)).toBe(false);
    sim.world.destroy(enemy);
    sim.step();
    expect(isOpen(sim, gate)).toBe(true);
  });

  it('leaves the gates of a seat whose map AI is disabled as placed', () => {
    const sim = gateSim(true, true);
    const gate = placeGate(sim, GATE, false);
    sim.step();
    expect(sim.world.has(gate, GateControl)).toBe(false);
    expect(isOpen(sim, gate)).toBe(false);
  });

  it('closes only at the 12-point boundary and reopens outside it', () => {
    const sim = gateSim(false);
    const gate = placeGate(sim, GATE, false);
    const enemy = spawn(sim, { x: GATE.x + 13, y: GATE.y }, CIVILIST);
    expect(isOpen(sim, gate)).toBe(true);
    sim.world.add(enemy, Position, positionOfNode(GATE.x + 12, GATE.y));
    sim.step();
    expect(isOpen(sim, gate)).toBe(false);
    sim.world.add(enemy, Position, positionOfNode(GATE.x + 13, GATE.y));
    sim.step();
    expect(isOpen(sim, gate)).toBe(true);
  });

  it('gives a human the same automatic policy, and keeps manual overrides', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, false, 0);
    mode(sim, gate, 'automatic');
    expect(isOpen(sim, gate)).toBe(true);
    const enemy = spawn(sim, { x: 43, y: 44 }, CIVILIST);
    expect(isOpen(sim, gate)).toBe(false);
    mode(sim, gate, 'open');
    sim.run(3);
    expect(isOpen(sim, gate)).toBe(true);
    mode(sim, gate, 'automatic');
    expect(isOpen(sim, gate)).toBe(false);
    sim.world.destroy(enemy);
    mode(sim, gate, 'closed');
    sim.run(3);
    expect(isOpen(sim, gate)).toBe(false);
  });

  it('ignores distant, friendly and dead units; reacts to movement and diplomacy', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, false);
    const enemy = spawn(sim, { x: 110, y: 80 }, SPEARMAN);
    expect(isOpen(sim, gate)).toBe(true);
    sim.world.add(enemy, Position, positionOfNode(43, 44));
    sim.step();
    expect(isOpen(sim, gate)).toBe(false);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: FOE, to: SEAT, state: 'friend' });
    sim.step();
    expect(isOpen(sim, gate)).toBe(true);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: FOE, to: SEAT, state: 'enemy' });
    sim.step();
    expect(isOpen(sim, gate)).toBe(false);
    sim.world.mut(enemy, Health).hitpoints = 0;
    sim.step();
    expect(isOpen(sim, gate)).toBe(true);
  });

  it('retries closing an occupied passage without losing automatic mode', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true);
    const passer = spawn(sim, GATE, CIVILIST, SEAT);
    const enemy = spawn(sim, { x: 43, y: 44 }, SPEARMAN);
    expect(isOpen(sim, gate)).toBe(true);
    expect(sim.world.get(gate, GateControl).mode).toBe('automatic');
    sim.world.add(passer, Position, positionOfNode(30, 44));
    sim.step();
    expect(isOpen(sim, gate)).toBe(false);
    sim.world.destroy(enemy);
    sim.step();
    expect(isOpen(sim, gate)).toBe(true);
  });

  it('does not close on a traveller passing between its nodes on a column step', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('expected a mapped simulation');
    // Straight down column 39 from row 39 to row 41, between the gate's nodes (39,40) and (40,40); just
    // past the skipped row the walker reads its destination, off the gate.
    const from = { hx: GATE.x - 1, hy: GATE.y - 1 };
    const to = { hx: GATE.x - 1, hy: GATE.y + 1 };
    const passer = spawn(sim, { x: from.hx, y: from.hy }, CIVILIST, SEAT);
    const stop = (n: { hx: number; hy: number }): Waypoint => ({
      ...positionOfNode(n.hx, n.hy),
      node: terrain.nodeAt(n.hx, n.hy),
    });
    const y = fx.add(positionOfNode(GATE.x, GATE.y).y, fx.div(ONE, fx.fromInt(16)));
    sim.world.add(passer, Position, { x: positionXOfWorld(nodeWorldX(from.hx, from.hy), y), y });
    sim.world.add(passer, MoveGoal, { cell: terrain.nodeAt(to.hx, to.hy) });
    sim.world.add(passer, PathRoute, { waypoints: [stop(from), stop(to)] });
    sim.world.add(passer, PathFollow, pathFollowRecord({ index: 1, legElapsed: 0, legCost: 0 }));
    spawn(sim, { x: 43, y: 44 }, SPEARMAN);
    expect(sim.world.get(passer, PathFollow).index).toBe(1);
    expect(isOpen(sim, gate)).toBe(true);
  });

  it('counts hostile vehicles and preserves policy across save and restore', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true);
    sim.enqueueSetup({
      kind: 'createVehicle',
      vehicleType: CATAPULT,
      x: 43,
      y: 44,
      tribe: VIKING,
      owner: FOE,
    });
    sim.step();
    const vehicle = [...sim.world.query(Vehicle)][0];
    if (vehicle === undefined) throw new Error('vehicle missing');
    expect(isOpen(sim, gate)).toBe(false);
    const restored = restoreSimulation(exportSaveGame(sim), {
      content: sim.content,
      map: MAP,
      ...(sim.mapAiScript === undefined ? {} : { mapAiScript: sim.mapAiScript }),
    });
    expect(restored.world.get(gate, GateControl).mode).toBe('automatic');
    expect(isOpen(restored, gate)).toBe(false);
    expect(restored.hashState()).toBe(sim.hashState());
    restored.world.destroy(vehicle);
    restored.step();
    expect(isOpen(restored, gate)).toBe(true);
  });

  it('repeats the same gate decisions and state hashes across independent worlds', () => {
    const run = (): string[] => {
      const sim = gateSim(false);
      const gate = placeGate(sim, GATE, false);
      const hashes = [sim.hashState()];
      const enemy = spawn(sim, { x: 43, y: 44 }, SPEARMAN);
      expect(isOpen(sim, gate)).toBe(false);
      hashes.push(sim.hashState());
      sim.world.destroy(enemy);
      sim.step();
      expect(isOpen(sim, gate)).toBe(true);
      hashes.push(sim.hashState());
      expect(sim.world.verifyCaches()).toEqual([]);
      return hashes;
    };
    expect(run()).toEqual(run());
  });

  it('keeps passage occupancy current across movement, boarding and removal', () => {
    const sim = gateSim(false);
    const passer = spawn(sim, GATE, CIVILIST, SEAT);
    expect(settlersByNode(sim.world).at(GATE.x, GATE.y)).toContain(passer);
    sim.world.add(passer, Position, positionOfNode(30, 44));
    expect(settlersByNode(sim.world).at(GATE.x, GATE.y)).not.toContain(passer);
    expect(settlersByNode(sim.world).at(30, 44)).toContain(passer);
    sim.world.remove(passer, Position);
    expect(settlersByNode(sim.world).at(30, 44)).not.toContain(passer);
    sim.world.add(passer, Position, positionOfNode(GATE.x, GATE.y));
    expect(settlersByNode(sim.world).at(GATE.x, GATE.y)).toEqual([passer]);
    sim.world.destroy(passer);
    expect(settlersByNode(sim.world).at(GATE.x, GATE.y)).toEqual([]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('leaves unfinished gates alone', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, false, 0);
    sim.world.add(gate, UnderConstruction, { labor: fx.fromInt(0) });
    mode(sim, gate, 'automatic');
    expect(sim.world.has(gate, GateControl)).toBe(false);
  });
});
