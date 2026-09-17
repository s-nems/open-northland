import type { MapAiCondition } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AI_TICK_NEVER,
  type AiConditionRecord,
  Building,
  recordContact,
  Settler,
  setAiExternalFlag,
  setDiplomacyStance,
} from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import type { Entity } from '../../src/ecs/world.js';
import { EventBuffer, Rng, Simulation } from '../../src/index.js';
import {
  conditionActive,
  conditionsBySlot,
  freshConditionRecord,
  recheckConditions,
} from '../../src/systems/ai-program/conditions.js';
import { ANY_PLAYER, CONDITION_ALWAYS, CONDITION_NEVER } from '../../src/systems/ai-program/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { aiContent } from '../fixtures/ai-content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/** Every condition kind of a seat's program, judged the way the original's handler judges it. */

const VIKING = 1;
const SEAT = 2;
const FOE = 3;
const FRIEND = 4;
const HQ_TYPE = 1;
/** A house with a construction cost, so an under-construction placement stays a site. */
const HOME_TYPE = 2;
const SPEARMAN = 32;
const CIVILIST = 6;
const MAP = 64;
const POINT = { x: 30, y: 30 };

function aiSim(): Simulation {
  return new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(MAP, MAP) });
}

function ctxAt(sim: Simulation, tick: number): SystemContext {
  return {
    content: sim.content,
    rng: new Rng(1),
    tick,
    events: new EventBuffer(),
    commands: new CommandQueue(),
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

function spawn(sim: Simulation, at: { x: number; y: number }, jobType: number, owner: number): Entity {
  const before = new Set(sim.world.query(Settler));
  sim.enqueueSetup({ kind: 'spawnSettler', jobType, x: at.x, y: at.y, tribe: VIKING, owner });
  sim.step();
  const spawned = [...sim.world.query(Settler)].find((e) => !before.has(e));
  if (spawned === undefined) throw new Error('setup: the spawn was refused');
  return spawned;
}

function place(
  sim: Simulation,
  at: { x: number; y: number },
  owner: number,
  buildingType = HQ_TYPE,
  underConstruction = false,
): Entity {
  const before = new Set(sim.world.query(Building));
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner,
    underConstruction,
  });
  sim.step();
  const placed = [...sim.world.query(Building)].find((e) => !before.has(e));
  if (placed === undefined) throw new Error('setup: the placement was refused');
  return placed;
}

/** Judge `defs` at `tick` on turn `turn` over fresh records and hand the records back. */
function judge(
  sim: Simulation,
  defs: readonly MapAiCondition[],
  tick = 0,
  turn = 0,
  records?: (AiConditionRecord | null)[],
): (AiConditionRecord | null)[] {
  const bySlot = conditionsBySlot(defs);
  const state = records ?? bySlot.map((d) => (d === null ? null : freshConditionRecord()));
  recheckConditions(sim.world, ctxAt(sim, tick), SEAT, bySlot, state, turn);
  return state;
}

function active(records: readonly (AiConditionRecord | null)[], slot: number): boolean {
  return records[slot]?.active ?? false;
}

describe('ai program conditions - the fixed references', () => {
  it('reads 100000 as always, 100001 and any slot past the table as never', () => {
    expect(conditionActive([], CONDITION_ALWAYS)).toBe(true);
    expect(conditionActive([], CONDITION_NEVER)).toBe(false);
    expect(conditionActive([], 100)).toBe(false);
    expect(conditionActive([{ active: true, activatedTick: 0, deactivatedTick: AI_TICK_NEVER }], 0)).toBe(
      true,
    );
  });

  it('keeps the first declaration of a slot, as the loader refuses a slot already set', () => {
    const bySlot = conditionsBySlot([
      { kind: 'true', slot: 3 },
      { kind: 'onExternal', slot: 3, raised: true },
    ]);
    expect(bySlot).toEqual([null, null, null, { kind: 'true', slot: 3 }]);
  });
});

describe('ai program conditions - the simple kinds', () => {
  it('True holds at once, OnTime from its tick on, and OnExternal reads the script flag', () => {
    const sim = aiSim();
    const defs: MapAiCondition[] = [
      { kind: 'true', slot: 0 },
      { kind: 'onTime', slot: 1, ticks: 720 },
      { kind: 'onExternal', slot: 2, raised: false },
    ];
    let records = judge(sim, defs, 719);
    expect([0, 1, 2].map((s) => active(records, s))).toEqual([true, false, false]);
    setAiExternalFlag(sim.world, SEAT, 2, true);
    records = judge(sim, defs, 720, 12, records);
    expect([0, 1, 2].map((s) => active(records, s))).toEqual([true, true, true]);
    setAiExternalFlag(sim.world, SEAT, 2, false);
    records = judge(sim, defs, 721, 13, records);
    expect(active(records, 2)).toBe(false);
  });

  it('a sticky slot never falls back; a non-sticky one does', () => {
    const sim = aiSim();
    const defs: MapAiCondition[] = [
      { kind: 'onNumberOfSoldiers', slot: 0, sticky: true, count: 1, player: SEAT },
      { kind: 'onNumberOfSoldiers', slot: 1, sticky: false, count: 1, player: SEAT },
    ];
    const soldier = spawn(sim, POINT, SPEARMAN, SEAT);
    let records = judge(sim, defs, 100);
    expect([0, 1].map((s) => active(records, s))).toEqual([true, true]);
    expect(records[0]?.activatedTick).toBe(100);
    sim.world.destroy(soldier);
    records = judge(sim, defs, 200, 1, records);
    expect([0, 1].map((s) => active(records, s))).toEqual([true, false]);
    expect(records[1]?.deactivatedTick).toBe(200);
  });

  it('OnConditions combines slots: all of, any of, not the one, either of two', () => {
    const sim = aiSim();
    const defs: MapAiCondition[] = [
      { kind: 'true', slot: 0 },
      { kind: 'onExternal', slot: 1, raised: false },
      { kind: 'onConditions', slot: 2, sticky: false, mode: 1, slots: [0, 1] },
      { kind: 'onConditions', slot: 3, sticky: false, mode: 2, slots: [1, 0] },
      { kind: 'onConditions', slot: 4, sticky: false, mode: 3, slots: [1] },
      { kind: 'onConditions', slot: 5, sticky: false, mode: 4, slots: [0, 1] },
      { kind: 'onConditions', slot: 6, sticky: false, mode: 1, slots: [CONDITION_ALWAYS, 0] },
      { kind: 'onConditions', slot: 7, sticky: false, mode: 1, slots: [CONDITION_NEVER] },
      { kind: 'onConditions', slot: 8, sticky: false, mode: 9, slots: [0] },
    ];
    const records = judge(sim, defs);
    expect([2, 3, 4, 5, 6, 7, 8].map((s) => active(records, s))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('settles a chain of slots within one turn, walking the passes until nothing changes', () => {
    const sim = aiSim();
    const defs: MapAiCondition[] = [
      { kind: 'onConditions', slot: 0, sticky: false, mode: 1, slots: [1] },
      { kind: 'onConditions', slot: 1, sticky: false, mode: 1, slots: [2] },
      { kind: 'true', slot: 2 },
    ];
    expect(active(judge(sim, defs), 0)).toBe(true);
  });

  it('OnConditionChangeDelayed counts from the source’s change, and never before one', () => {
    const sim = aiSim();
    const defs: MapAiCondition[] = [
      { kind: 'onExternal', slot: 0, raised: false },
      {
        kind: 'onConditionChangeDelayed',
        slot: 1,
        sticky: false,
        source: 0,
        onActivation: true,
        delayTicks: 60,
      },
      {
        kind: 'onConditionChangeDelayed',
        slot: 2,
        sticky: false,
        source: 0,
        onActivation: false,
        delayTicks: 60,
      },
    ];
    let records = judge(sim, defs, 0);
    expect([1, 2].map((s) => active(records, s))).toEqual([false, false]);
    setAiExternalFlag(sim.world, SEAT, 0, true);
    records = judge(sim, defs, 100, 1, records);
    expect(active(records, 1)).toBe(false);
    records = judge(sim, defs, 160, 2, records);
    expect(active(records, 1)).toBe(true);
    setAiExternalFlag(sim.world, SEAT, 0, false);
    records = judge(sim, defs, 200, 3, records);
    records = judge(sim, defs, 260, 4, records);
    expect([1, 2].map((s) => active(records, s))).toEqual([true, true]);
  });

  it('OnTimer waits its delay, then holds and rests by turns', () => {
    const sim = aiSim();
    const defs: MapAiCondition[] = [
      { kind: 'onTimer', slot: 0, delayTicks: 100, activeTicks: 50, inactiveTicks: 30 },
    ];
    let records = judge(sim, defs, 100);
    expect(active(records, 0)).toBe(false);
    records = judge(sim, defs, 101, 1, records);
    expect(active(records, 0)).toBe(true);
    records = judge(sim, defs, 150, 2, records);
    expect(active(records, 0)).toBe(true);
    records = judge(sim, defs, 151, 3, records);
    expect(active(records, 0)).toBe(false);
    records = judge(sim, defs, 181, 4, records);
    expect(active(records, 0)).toBe(false);
    records = judge(sim, defs, 182, 5, records);
    expect(active(records, 0)).toBe(true);
  });
});

describe('ai program conditions - the world-reading kinds', () => {
  it('OnDiplomacyChange, OnPlayerSeen and OnPlayerDead read the player tables', () => {
    const sim = aiSim();
    const defs: MapAiCondition[] = [
      { kind: 'onDiplomacyChange', slot: 0, sticky: false, from: SEAT, to: FOE, state: 3 },
      { kind: 'onPlayerSeen', slot: 1, sticky: false, seer: SEAT, seen: FOE },
      { kind: 'onPlayerDead', slot: 2, player: FOE },
    ];
    const foe = spawn(sim, POINT, CIVILIST, FOE);
    setDiplomacyStance(sim.world, SEAT, FOE, 'neutral');
    let records = judge(sim, defs, 800);
    expect([0, 1, 2].map((s) => active(records, s))).toEqual([false, false, false]);
    setDiplomacyStance(sim.world, SEAT, FOE, 'enemy');
    recordContact(sim.world, SEAT, FOE);
    sim.world.destroy(foe);
    records = judge(sim, defs, 801, 1, records);
    expect([0, 1, 2].map((s) => active(records, s))).toEqual([true, true, true]);
    // Not judged in the first minute: the slot stays as it was.
    expect(active(judge(sim, defs, 720), 2)).toBe(false);
  });

  it('OnCreatureInRange skips the seat’s own men, narrows to enemies and soldiers, and stops short of the range', () => {
    const sim = aiSim();
    const anyone = (
      slot: number,
      over: Partial<Extract<MapAiCondition, { kind: 'onCreatureInRange' }>>,
    ): MapAiCondition => ({
      kind: 'onCreatureInRange',
      slot,
      sticky: false,
      ...POINT,
      range: 10,
      player: ANY_PLAYER,
      enemiesOnly: false,
      soldiersOnly: false,
      ...over,
    });
    const defs: MapAiCondition[] = [
      anyone(0, {}),
      anyone(1, { enemiesOnly: true }),
      anyone(2, { soldiersOnly: true }),
      anyone(3, { player: FRIEND }),
      anyone(4, { player: SEAT }),
      anyone(5, { range: 5 }),
    ];
    setDiplomacyStance(sim.world, SEAT, FOE, 'enemy');
    setDiplomacyStance(sim.world, SEAT, FRIEND, 'friend');
    spawn(sim, { x: POINT.x + 6, y: POINT.y }, SPEARMAN, SEAT);
    expect([0, 1, 2, 3, 4, 5].map((s) => active(judge(sim, defs), s))).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    spawn(sim, { x: POINT.x + 8, y: POINT.y }, CIVILIST, FRIEND);
    expect([0, 1, 2, 3].map((s) => active(judge(sim, defs), s))).toEqual([true, false, false, true]);
    spawn(sim, { x: POINT.x + 9, y: POINT.y }, SPEARMAN, FOE);
    expect([1, 2].map((s) => active(judge(sim, defs), s))).toEqual([true, true]);
  });

  it('OnHouseInRange reads type, finish and owner, and skips the seat’s own houses for player 20', () => {
    const sim = aiSim();
    const houses = (
      slot: number,
      over: Partial<Extract<MapAiCondition, { kind: 'onHouseInRange' }>>,
    ): MapAiCondition => ({
      kind: 'onHouseInRange',
      slot,
      sticky: false,
      ...POINT,
      range: 12,
      player: ANY_PLAYER,
      enemiesOnly: false,
      houseType: 0,
      finishedOnly: false,
      ...over,
    });
    const defs: MapAiCondition[] = [
      houses(0, {}),
      houses(1, { player: SEAT }),
      houses(2, { enemiesOnly: true }),
      houses(3, { houseType: HQ_TYPE }),
      houses(4, { finishedOnly: true }),
    ];
    setDiplomacyStance(sim.world, SEAT, FOE, 'enemy');
    place(sim, { x: POINT.x + 4, y: POINT.y }, SEAT);
    expect([0, 1, 2, 3, 4].map((s) => active(judge(sim, defs), s))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    place(sim, { x: POINT.x - 6, y: POINT.y }, FOE, HOME_TYPE, true);
    expect([0, 2, 3, 4].map((s) => active(judge(sim, defs), s))).toEqual([true, true, false, false]);
  });

  it('rechecks a range scan every tenth turn only', () => {
    const sim = aiSim();
    const defs: MapAiCondition[] = [
      {
        kind: 'onCreatureInRange',
        slot: 0,
        sticky: false,
        ...POINT,
        range: 10,
        player: ANY_PLAYER,
        enemiesOnly: false,
        soldiersOnly: false,
      },
    ];
    const records = judge(sim, defs, 0, 0);
    spawn(sim, POINT, CIVILIST, FOE);
    judge(sim, defs, 100, 3, records);
    expect(active(records, 0)).toBe(false);
    judge(sim, defs, 200, 10, records);
    expect(active(records, 0)).toBe(true);
  });
});
