import { describe, expect, it } from 'vitest';
import {
  JobAssignment,
  MISSION_BEHAVIOUR,
  NeedOrder,
  Owner,
  setMissionBehaviour,
  TrainingOrder,
  WorkFlag,
} from '../../src/components/index.js';
import {
  aiCommand,
  type Entity,
  exportSaveGame,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  parseCommandEnvelope,
  parseCommandLog,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { authorizedCommand } from '../../src/systems/command/authority.js';
import { commandSystem } from '../../src/systems/command/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassMap, makeWoodcutter } from '../settlers/gatherer-flag/support.js';

function fixture(count = 3) {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(100, 30) });
  const units = Array.from({ length: count }, (_, i) => {
    const entity = makeWoodcutter(sim, i % 40, Math.floor(i / 40));
    sim.world.add(entity, Owner, { player: 0 });
    return entity;
  });
  return { sim, units };
}

describe('compound selection orders', () => {
  it.each(['unitActionGroup', 'unitOrdersGroup'] as const)(
    '%s retains target ownership and script control checks for every nested action',
    (kind) => {
      const { sim, units } = fixture();
      const [mine, held, rival] = units as [Entity, Entity, Entity];
      setMissionBehaviour(sim.world, held, MISSION_BEHAVIOUR.NOT_CONTROLLABLE, true);
      sim.world.add(rival, Owner, { player: 1 });
      const enemyHouse = sim.world.create();
      sim.world.add(enemyHouse, Owner, { player: 1 });
      for (const action of [
        { kind: 'assignBuilder' as const, site: enemyHouse },
        { kind: 'learn' as const, house: enemyHouse, target: 'job' as const, typeId: 1 },
        { kind: 'trainSoldier' as const, house: enemyHouse },
      ]) {
        const order: PlayerCommand =
          kind === 'unitActionGroup'
            ? { kind, action, members: units.map((entity) => ({ entity })) }
            : { kind, members: units.map((entity) => ({ entity, actions: [action] })) };
        expect(authorizedCommand(sim.world, playerCommand(0, order))).toMatchObject({ members: [] });
      }
      const action = { kind: 'cancelTraining' as const };
      const order: PlayerCommand =
        kind === 'unitActionGroup'
          ? { kind, action, members: units.map((entity) => ({ entity })) }
          : { kind, members: units.map((entity) => ({ entity, actions: [action] })) };
      expect(authorizedCommand(sim.world, playerCommand(0, order))).toMatchObject({
        members: [{ entity: mine }],
      });
      expect(authorizedCommand(sim.world, aiCommand(0, order))).toMatchObject({
        members: [{ entity: mine }, { entity: held }],
      });
      const partial: PlayerCommand = {
        kind: 'unitOrdersGroup',
        members: [
          {
            entity: mine,
            actions: [{ kind: 'learn', house: enemyHouse, target: 'good', typeId: 1 }, action],
          },
        ],
      };
      expect(authorizedCommand(sim.world, playerCommand(0, partial))).toEqual({
        kind: 'unitOrdersGroup',
        members: [{ entity: mine, actions: [action] }],
      });
    },
  );

  it('matches the former release-all then flag-all gesture while applying each compound member in order', () => {
    const old = fixture();
    const grouped = fixture();
    for (const { sim, units } of [old, grouped]) {
      const workplace = sim.world.create();
      sim.world.add(workplace, Owner, { player: 0 });
      for (const entity of units) sim.world.add(entity, JobAssignment, { workplace });
    }
    for (const entity of old.units) old.sim.enqueue(playerCommand(0, { kind: 'unassignWorker', entity }));
    for (const entity of old.units)
      old.sim.enqueue(playerCommand(0, { kind: 'setWorkFlag', entity, x: 20, y: 10 }));
    grouped.sim.enqueue(
      playerCommand(0, {
        kind: 'unitOrdersGroup',
        members: grouped.units.map((entity) => ({
          entity,
          actions: [{ kind: 'unassignWorker' }, { kind: 'setWorkFlag', x: 20, y: 10 }],
        })),
      }),
    );
    commandSystem(old.sim.world, ctxOf(old.sim));
    commandSystem(grouped.sim.world, ctxOf(grouped.sim));
    expect(grouped.sim.snapshot().entities).toEqual(old.sim.snapshot().entities);
    for (const entity of grouped.units) {
      expect(grouped.sim.world.has(entity, JobAssignment)).toBe(false);
      expect(grouped.sim.world.has(entity, WorkFlag)).toBe(true);
    }
    expect(grouped.sim.commands.log).toHaveLength(1);
  });

  it('applies 1000 compound members on one tick and round-trips their serialized save and replay', () => {
    const { sim, units } = fixture(1000);
    const house = sim.world.create();
    for (const entity of units) sim.world.add(entity, TrainingOrder, { house, drillTicksLeft: 100 });
    const order: PlayerCommand = {
      kind: 'unitOrdersGroup',
      members: units.map((entity, i) => ({
        entity,
        actions: [{ kind: 'cancelTraining' }, { kind: 'orderNeed', need: i % 2 === 0 ? 'hunger' : 'piety' }],
      })),
    };
    const restore = (source: Simulation) =>
      restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(source)))), {
        content: testContent(),
        map: grassMap(100, 30),
      });
    const replay = restore(sim);
    sim.enqueue(playerCommand(0, order));
    const saved = restore(sim);
    sim.step();
    saved.step();
    for (const entry of parseCommandLog(JSON.parse(JSON.stringify(sim.commands.log)))) replay.enqueue(entry);
    replay.step();
    expect(saved.hashState()).toBe(sim.hashState());
    expect(replay.hashState()).toBe(sim.hashState());
    for (const [i, entity] of units.entries()) {
      expect(sim.world.has(entity, TrainingOrder)).toBe(false);
      expect(sim.world.get(entity, NeedOrder).need).toBe(i % 2 === 0 ? 'hunger' : 'piety');
    }
    expect(sim.commands.log).toHaveLength(1);
  });

  it('bounds all nested input and forbids command recursion or injected actors', () => {
    const parse = (members: unknown) =>
      parseCommandEnvelope({
        v: 1,
        origin: 'player',
        player: 0,
        command: { kind: 'unitOrdersGroup', members },
      });
    const action = { kind: 'cancelTraining' };
    const member = { entity: 1, actions: [action] };
    expect(parse([member])).toBeDefined();
    for (const actions of [
      [],
      [action, action, action],
      [{ ...action, entity: 2 }],
      [{ kind: 'unitActionGroup', members: [{ entity: 2 }], action }],
      [{ kind: 'spawnSettler', tribe: 1, x: 0, y: 0 }],
    ]) {
      expect(() => parse([{ ...member, actions }])).toThrow();
    }
    expect(() => parse([member, member])).toThrow(/duplicate entity/);
    expect(() =>
      parse(Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => ({ ...member, entity: i + 1 }))),
    ).toThrow(/at most 4096/);
  });
});
