import { type ContentSet, type MapAiSeat, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AI_GATE_LIST_LIMIT,
  AI_MODULE_IDS,
  type AiGateRecord,
  AiProgram,
  aiProgramEntity,
  Palisade,
  Settler,
} from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Command } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, Rng, type ScriptLandscapeType, Simulation } from '../../src/index.js';
import { AI_HANDLER_ROUND_TICKS } from '../../src/systems/ai-player/cadence.js';
import { seatRaiders } from '../../src/systems/ai-player/military/defence/threat.js';
import { GATE_ENEMY_NEAR_POINTS, gateList, gateOrders } from '../../src/systems/ai-program/gates.js';
import type { SystemContext } from '../../src/systems/index.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/** The scripted handler's gates: shut while an enemy is near, opened again once he is gone. */

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
const FAR_GATE = { x: 80, y: 40 };
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

function gateSim(): Simulation {
  const row: MapAiSeat = {
    player: SEAT,
    disabled: false,
    strategicOff: [...AI_MODULE_IDS],
    conditions: [],
    tasks: [],
  };
  const map = {
    ...grassNodeMap(128, 96),
    landscapes: { types: [gateType(CLOSED, false, OPEN), gateType(OPEN, true, CLOSED)], placements: [] },
  };
  const sim = new Simulation({ seed: 1, content: CONTENT, map, aiScript: [row] });
  const off = Object.fromEntries(AI_MODULE_IDS.map((id) => [id, false]));
  sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true, modules: off });
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

function ctxOf(sim: Simulation): SystemContext {
  return {
    content: sim.content,
    rng: new Rng(1),
    tick: sim.tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function orders(sim: Simulation, gates: AiGateRecord[]): Command[] {
  const ctx = ctxOf(sim);
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('setup: the fixture map builds no terrain graph');
  return gateOrders(sim.world, SEAT, gates, () => seatRaiders(sim.world, ctx, terrain, SEAT));
}

function apply(sim: Simulation, commands: readonly Command[]): void {
  for (const command of commands) sim.enqueueSetup(command);
  sim.step();
}

function isOpen(sim: Simulation, gate: Entity): boolean {
  return sim.world.get(gate, Palisade).gate?.open === true;
}

describe('ai program gates', () => {
  it('shuts a gate while an enemy fighter is near and opens it once he is gone', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true);
    const gates: AiGateRecord[] = [{ gate, open: true }];
    const raider = spawn(sim, { x: GATE.x + GATE_ENEMY_NEAR_POINTS, y: GATE.y }, SPEARMAN);

    apply(sim, orders(sim, gates));
    expect(isOpen(sim, gate)).toBe(false);
    expect(orders(sim, gates)).toEqual([]);

    sim.world.destroy(raider);
    apply(sim, orders(sim, gates));
    expect(isOpen(sim, gate)).toBe(true);
  });

  it('shuts a gate for an enemy vehicle near it', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true);
    const catapult = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: CATAPULT,
      x: GATE.x + 10,
      y: GATE.y,
      tribe: VIKING,
      owner: FOE,
    });
    if (catapult === null) throw new Error('setup: the catapult is not in the content');
    expect(orders(sim, [{ gate, open: true }])).toEqual([
      { kind: 'setPalisadeGate', palisade: gate, open: false },
    ]);
  });

  it('leaves a gate alone for an enemy past the radius or a civilian at the door', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true);
    spawn(sim, { x: GATE.x + GATE_ENEMY_NEAR_POINTS + 2, y: GATE.y }, SPEARMAN);
    spawn(sim, { x: GATE.x, y: GATE.y + 4 }, CIVILIST);
    expect(orders(sim, [{ gate, open: true }])).toEqual([]);
  });

  it('keeps shut in peace a gate a script closed after the handler opened it', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, false);
    expect(orders(sim, [{ gate, open: true }])).toEqual([]);
  });

  it('shuts again a gate still open while the enemy stays', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true);
    spawn(sim, { x: GATE.x + 10, y: GATE.y }, SPEARMAN);
    expect(orders(sim, [{ gate, open: false }])).toEqual([
      { kind: 'setPalisadeGate', palisade: gate, open: false },
    ]);
  });

  it('never touches a gate another seat holds', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true, FOE);
    spawn(sim, { x: GATE.x + 10, y: GATE.y }, SPEARMAN);
    expect(orders(sim, [{ gate, open: true }])).toEqual([]);
  });

  it('lists every gate nearest the centre first, up to its limit', () => {
    const sim = gateSim();
    const far = placeGate(sim, FAR_GATE, false, FOE);
    const near = placeGate(sim, GATE, true);
    expect(gateList(sim.world, { hx: HQ.x, hy: HQ.y })).toEqual([
      { gate: near, open: true },
      { gate: far, open: false },
    ]);
    for (let i = 0; i < AI_GATE_LIST_LIMIT; i++)
      placeGate(sim, { x: 8 + 8 * (i % 14), y: 56 + 4 * Math.floor(i / 14) }, true);
    expect(gateList(sim.world, { hx: HQ.x, hy: HQ.y })).toHaveLength(AI_GATE_LIST_LIMIT);
  });

  it('opens on its first turn in peace a gate it found shut', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, false);
    for (let i = 0; i < AI_HANDLER_ROUND_TICKS; i++) sim.step();
    expect(isOpen(sim, gate)).toBe(true);
  });

  it('shuts its gate on the handler turn after a raider walks up', () => {
    const sim = gateSim();
    const gate = placeGate(sim, GATE, true);
    for (let i = 0; i < AI_HANDLER_ROUND_TICKS; i++) sim.step();
    const carrier = aiProgramEntity(sim.world, SEAT);
    if (carrier === null) throw new Error('the handler never took its first turn');
    expect(sim.world.get(carrier, AiProgram).gates).toEqual([{ gate, open: true }]);

    spawn(sim, { x: GATE.x + 10, y: GATE.y }, SPEARMAN);
    for (let i = 0; i < AI_HANDLER_ROUND_TICKS; i++) sim.step();
    expect(isOpen(sim, gate)).toBe(false);
  });
});
