import type { MapAiSeat, MapAiTask } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AiProgram,
  type AiProgramState,
  AttackOrder,
  aiProgramEntity,
  Building,
  Position,
  Settler,
  Stance,
  setDiplomacyStance,
} from '../../src/components/index.js';
import type { DeepReadonly, Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { hexDistanceBetween, nodeOfPosition } from '../../src/nav/halfcell.js';
import { AI_HANDLER_ROUND_TICKS } from '../../src/systems/ai-player/cadence.js';
import { CONDITION_ALWAYS } from '../../src/systems/ai-program/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The soldiers of a seat's program: how the Defend and Attack groups split the seat's men by priority
 * within their bounds, and what an Attack band does at its target and its rally point.
 */

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const HQ_TYPE = 1;
const SPEARMAN = 32;
const MAP = 128;
const TWO_TURNS = 2 * AI_HANDLER_ROUND_TICKS + 1;
const WALK_TICKS = 900;
const SPAWN = { x: 20, y: 20 };

function seatRow(rows: Partial<MapAiSeat>): MapAiSeat {
  return { player: SEAT, disabled: false, strategicOff: ['military'], conditions: [], tasks: [], ...rows };
}

function simWith(tasks: MapAiTask[]): Simulation {
  const sim = new Simulation({
    seed: 1,
    content: aiContent(),
    map: grassNodeMap(MAP, MAP),
    aiScript: [seatRow({ tasks })],
  });
  sim.enqueueSetup({ kind: 'setPlayerAi', player: SEAT, enabled: true, modules: { military: false } });
  return sim;
}

function spawn(sim: Simulation, count: number, at: { x: number; y: number }, owner = SEAT): Entity[] {
  const before = new Set(sim.world.query(Settler));
  for (let i = 0; i < count; i++) {
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: SPEARMAN,
      x: at.x + 2 * (i % 8),
      y: at.y + 2 * Math.floor(i / 8),
      tribe: VIKING,
      owner,
    });
  }
  sim.step();
  return [...sim.world.query(Settler)].filter((e) => !before.has(e));
}

function place(sim: Simulation, at: { x: number; y: number }, owner: number): Entity {
  const before = new Set(sim.world.query(Building));
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HQ_TYPE, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  const placed = [...sim.world.query(Building)].find((e) => !before.has(e));
  if (placed === undefined) throw new Error('setup: the placement was refused');
  return placed;
}

function programOf(sim: Simulation): DeepReadonly<AiProgramState> {
  const carrier = aiProgramEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('the seat runs no program');
  return sim.world.get(carrier, AiProgram);
}

function tasksOf(sim: Simulation): (number | null)[] {
  return programOf(sim).soldiers.map((s) => s.task);
}

function defend(over: Partial<Extract<MapAiTask, { kind: 'defend' }>>): MapAiTask {
  return {
    kind: 'defend',
    priority: 10,
    condition: CONDITION_ALWAYS,
    x: 60,
    y: 60,
    range: 20,
    min: 0,
    max: 0,
    ...over,
  };
}

describe('ai program soldiers - the shares', () => {
  it('splits the men between bounded posts by priority, holding each between its min and its max', () => {
    // 10 men, priorities 30 and 10 with caps 5 and 10: both posts are sized off the same ten in one
    // round, the first to its cap of 5 from its share of 8, the second to its share of 3; the men the
    // cap turned away do not flow on to the second post but hold the default position.
    const sim = simWith([
      defend({ x: 100, y: 20, min: 2, max: 5, priority: 30 }),
      defend({ x: 100, y: 100, min: 2, max: 10, priority: 10 }),
    ]);
    spawn(sim, 10, SPAWN);
    sim.run(TWO_TURNS);
    const tasks = tasksOf(sim);
    expect(tasks.filter((t) => t === 0)).toHaveLength(5);
    expect(tasks.filter((t) => t === 1)).toHaveLength(3);
    expect(tasks.filter((t) => t === null)).toHaveLength(2);
  });

  it('gives a post nothing when its share falls short of its min, and an uncapped post its share alone', () => {
    // 3 men: the post wanting 4 at least gets none; the uncapped one, judged in the second pass, takes
    // its sixth of the three men rounded up to one, and the other two hold the default position.
    const sim = simWith([
      defend({ x: 100, y: 20, min: 4, max: 6, priority: 50 }),
      defend({ x: 100, y: 100, min: 0, max: 0, priority: 10 }),
    ]);
    spawn(sim, 3, SPAWN);
    sim.run(TWO_TURNS);
    expect(tasksOf(sim)).toEqual([null, null, 1]);
    const program = programOf(sim);
    expect(program.soldiers.map((s) => s.onDefault)).toEqual([true, true, false]);
  });

  it('sends the nearest men to each post, the higher priority choosing first', () => {
    const sim = simWith([
      defend({ x: 100, y: 20, min: 1, max: 1, priority: 30 }),
      defend({ x: 20, y: 100, min: 1, max: 1, priority: 10 }),
    ]);
    const [east] = spawn(sim, 1, { x: 90, y: 20 });
    const [south] = spawn(sim, 1, { x: 20, y: 90 });
    sim.run(TWO_TURNS);
    const program = programOf(sim);
    expect(program.soldiers.find((s) => s.entity === east)?.task).toBe(0);
    expect(program.soldiers.find((s) => s.entity === south)?.task).toBe(1);
  });

  it('keeps a man on the post he holds across rechecks rather than reshuffling the band', () => {
    const sim = simWith([
      defend({ x: 100, y: 20, min: 1, max: 2, priority: 10 }),
      defend({ x: 100, y: 100, min: 1, max: 2, priority: 10 }),
    ]);
    spawn(sim, 4, SPAWN);
    sim.run(TWO_TURNS);
    const first = tasksOf(sim);
    sim.run(6 * AI_HANDLER_ROUND_TICKS);
    expect(tasksOf(sim)).toEqual(first);
  });
});

describe('ai program soldiers - an Attack task', () => {
  it('marches the band on the enemy house standing on its target and orders the assault', () => {
    const TARGET = { x: 100, y: 100 };
    const sim = simWith([
      {
        kind: 'attack',
        priority: 100,
        condition: CONDITION_ALWAYS,
        ...TARGET,
        range: 30,
        min: 0,
        max: 0,
        rallyX: 60,
        rallyY: 60,
        stance: MILITARY_MODE.ATTACK,
      },
    ]);
    setDiplomacyStance(sim.world, SEAT, FOE, 'enemy');
    const house = place(sim, TARGET, FOE);
    const band = spawn(sim, 3, SPAWN);
    sim.run(TWO_TURNS);
    for (const e of band) expect(sim.world.get(e, Stance).mode).toBe(MILITARY_MODE.ATTACK);
    sim.run(WALK_TICKS);
    expect(band.some((e) => sim.world.tryGet(e, AttackOrder)?.target === house)).toBe(true);
    for (const e of band) {
      const at = sim.world.get(e, Position);
      const node = nodeOfPosition(at.x, at.y);
      expect(hexDistanceBetween(node.hx, node.hy, TARGET.x, TARGET.y)).toBeLessThan(30);
    }
  });

  it('pulls a scattered band back to its rally point before it goes in again', () => {
    const TARGET = { x: 110, y: 110 };
    const RALLY = { x: 60, y: 60 };
    const sim = simWith([
      {
        kind: 'attack',
        priority: 100,
        condition: CONDITION_ALWAYS,
        ...TARGET,
        range: 10,
        min: 0,
        max: 0,
        rallyX: RALLY.x,
        rallyY: RALLY.y,
        stance: MILITARY_MODE.ATTACK,
      },
    ]);
    // Six men spread over the map: none within the target's range, and none within 3n of the
    // foremost, so the band regroups at the rally point with a range of n/3.
    const band = [
      ...spawn(sim, 1, { x: 10, y: 10 }),
      ...spawn(sim, 1, { x: 10, y: 110 }),
      ...spawn(sim, 1, { x: 110, y: 10 }),
      ...spawn(sim, 1, { x: 60, y: 10 }),
      ...spawn(sim, 1, { x: 10, y: 60 }),
      ...spawn(sim, 1, { x: 90, y: 20 }),
    ];
    sim.run(TWO_TURNS);
    const groups = (): readonly { task: number; regrouping: boolean; range: number }[] =>
      programOf(sim).groups;
    expect(groups()).toEqual([{ task: 0, regrouping: true, range: 2 }]);
    const toRally = (e: Entity): number => {
      const at = sim.world.get(e, Position);
      const node = nodeOfPosition(at.x, at.y);
      return hexDistanceBetween(node.hx, node.hy, RALLY.x, RALLY.y);
    };
    // A third of a walk in, the band is closing on the rally point and nobody has gone for the target.
    sim.run(WALK_TICKS / 3);
    expect(groups()[0]?.regrouping).toBe(true);
    for (const e of band) expect(toRally(e)).toBeLessThan(30);
    // Once half of it stands within twice its size of the foremost man, the attack is back on and
    // the band leaves the rally point behind.
    sim.run(WALK_TICKS);
    expect(groups()[0]?.regrouping).toBe(false);
    expect(band.filter((e) => toRally(e) > 20).length).toBeGreaterThan(band.length / 2);
  });
});
