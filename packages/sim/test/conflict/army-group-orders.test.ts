import { describe, expect, it } from 'vitest';
import {
  AttackOrder,
  MISSION_BEHAVIOUR,
  MoveGoal,
  NeedOrder,
  OrderQueue,
  PathFollow,
  PlayerOrder,
  Position,
  Stance,
  setMissionBehaviour,
  TrainingOrder,
  WALK_DIRECTION,
  WalkFacing,
  Weapon,
} from '../../src/components/index.js';
import {
  type Entity,
  exportSaveGame,
  type GroupDestination,
  MAX_UNIT_ORDER_MEMBERS,
  parseCommandEnvelope,
  parseCommandLog,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { commandSystem } from '../../src/systems/command/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { fighterAt, grassMap, P0, P1, VIKING, WOODCUTTER } from './melee-engagement/support.js';

const WIDTH = 100;
const HEIGHT = 40;

function armyWorld(count = 1000): { sim: Simulation; army: Entity[] } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(WIDTH, HEIGHT) });
  const army = Array.from({ length: count }, (_, i) =>
    fighterAt(sim, 1 + (i % 40), 1 + Math.floor(i / 40), VIKING, 31, { owner: P0 }),
  );
  for (const entity of army) {
    sim.world.add(entity, WalkFacing, { direction: WALK_DIRECTION.E, target: WALK_DIRECTION.E });
    sim.world.add(entity, Weapon, { weaponTypeId: 7 });
  }
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: false });
  return { sim, army };
}

function destinations(army: readonly Entity[], offset = 100): GroupDestination[] {
  return army.map((entity, i) => ({ entity, x: offset + 2 * (i % 40), y: 2 + 2 * Math.floor(i / 40) }));
}

function expectMarch(sim: Simulation, members: readonly GroupDestination[], attack: boolean): void {
  for (const member of members) {
    const goal = sim.terrain?.nodeAtClamped(member.x, member.y);
    expect(sim.world.get(member.entity, MoveGoal).cell).toBe(goal);
    expect(sim.world.has(member.entity, PathFollow)).toBe(true);
    expect(sim.world.get(member.entity, PlayerOrder).attackMove?.goal).toBe(attack ? goal : undefined);
    expect(sim.world.has(member.entity, OrderQueue)).toBe(false);
  }
}

describe('atomic army orders', () => {
  it.each(['moveUnitGroup', 'attackMoveUnitGroup'] as const)(
    '%s starts all 1000 members together and replaces repeated redirects without a backlog',
    (kind) => {
      const { sim, army } = armyWorld();
      const initial = army.map((entity) => ({ ...sim.world.get(entity, Position) }));
      const members = destinations(army);
      sim.enqueue(playerCommand(P0, { kind, members }));
      sim.step();
      expectMarch(sim, members, kind === 'attackMoveUnitGroup');
      // Routes start together; the existing turn animation can hold translation for up to four ticks.
      sim.run(4);
      expect(
        army.filter((entity, i) => {
          const position = sim.world.get(entity, Position);
          return position.x !== initial[i]?.x || position.y !== initial[i]?.y;
        }),
      ).toHaveLength(1000);
      const opposite = kind === 'moveUnitGroup' ? 'attackMoveUnitGroup' : 'moveUnitGroup';
      // Both clicks land in the next input tick; every member must carry only the newest destination.
      const redirect = destinations(army, 110);
      sim.enqueue(playerCommand(P0, { kind, members: destinations(army, 90) }));
      sim.enqueue(playerCommand(P0, { kind: opposite, members: redirect }));
      sim.step();
      expectMarch(sim, redirect, opposite === 'attackMoveUnitGroup');
      const logged = sim.commands.log.filter((entry) => entry.origin === 'player');
      expect(logged.map((entry) => entry.applyTick)).toEqual([1, 6, 6]);
      expect(logged).toHaveLength(3);
    },
  );

  it('keeps Shift waypoints per member and an ordinary group redirect clears them immediately', () => {
    const { sim, army } = armyWorld(4);
    const first = destinations(army);
    const next = destinations(army, 120);
    sim.enqueue(playerCommand(P0, { kind: 'moveUnitGroup', members: first }));
    sim.step();
    sim.enqueue(playerCommand(P0, { kind: 'attackMoveUnitGroup', members: next, queued: true }));
    sim.step();
    for (const [i, entity] of army.entries()) {
      expect(sim.world.get(entity, MoveGoal).cell).toBe(
        sim.terrain?.nodeAtClamped(first[i]?.x ?? 0, first[i]?.y ?? 0),
      );
      expect(sim.world.get(entity, OrderQueue).orders).toEqual([{ kind: 'attackMoveUnit', ...next[i] }]);
    }
    sim.enqueue(playerCommand(P0, { kind: 'moveUnitGroup', members: next }));
    sim.step();
    expectMarch(sim, next, false);
  });

  it('filters enemy, script-held and stale members without denying the rest of the selection', () => {
    const { sim, army } = armyWorld(3);
    const [owned, held, fallen] = army;
    if (owned === undefined || held === undefined || fallen === undefined) throw new Error('army fixture');
    setMissionBehaviour(sim.world, held, MISSION_BEHAVIOUR.NOT_CONTROLLABLE, true);
    sim.world.destroy(fallen);
    const enemy = fighterAt(sim, 45, 30, VIKING, WOODCUTTER, { owner: P1 });
    sim.enqueue(playerCommand(P0, { kind: 'moveUnitGroup', members: destinations([...army, enemy]) }));
    sim.step();
    expect(sim.world.has(owned, PlayerOrder)).toBe(true);
    expect(sim.world.has(held, PlayerOrder)).toBe(false);
    expect(sim.world.has(enemy, PlayerOrder)).toBe(false);
    expect(sim.world.isAlive(fallen)).toBe(false);
  });

  it('applies explicit attack and stance to every selected fighter in one tick', () => {
    const { sim, army } = armyWorld(1000);
    const target = fighterAt(sim, 98, 38, VIKING, WOODCUTTER, { owner: P1, hitpoints: 1_000_000 });
    const members = army.map((entity) => ({ entity }));
    sim.enqueue(playerCommand(P0, { kind: 'setStanceGroup', members, mode: MILITARY_MODE.DEFEND }));
    sim.enqueue(playerCommand(P0, { kind: 'attackUnitGroup', members, target }));
    sim.step();
    for (const entity of army) {
      expect(sim.world.get(entity, Stance).mode).toBe(MILITARY_MODE.DEFEND);
      expect(sim.world.get(entity, AttackOrder).target).toBe(target);
    }
  });

  it.each(['hunger', 'fatigue', 'enjoyment', 'piety'] as const)(
    'applies the %s need action to all 1000 soldiers together',
    (need) => {
      const { sim, army } = armyWorld();
      sim.enqueue(
        playerCommand(P0, {
          kind: 'unitActionGroup',
          members: army.map((entity) => ({ entity })),
          action: { kind: 'orderNeed', need },
        }),
      );
      sim.step();
      for (const entity of army) expect(sim.world.get(entity, NeedOrder).need).toBe(need);
      expect(sim.commands.log.filter((entry) => entry.origin === 'player')).toHaveLength(1);
    },
  );

  it('cancels every selected training order together while excluding a rival', () => {
    const { sim, army } = armyWorld();
    const house = sim.world.create();
    const rival = fighterAt(sim, 99, 39, VIKING, WOODCUTTER, { owner: P1 });
    for (const entity of [...army, rival])
      sim.world.add(entity, TrainingOrder, { house, drillTicksLeft: 100 });
    sim.enqueue(
      playerCommand(P0, {
        kind: 'unitActionGroup',
        members: [...army, rival].map((entity) => ({ entity })),
        action: { kind: 'cancelTraining' },
      }),
    );
    // Command-only inspection avoids the training system independently retiring the synthetic school.
    commandSystem(sim.world, ctxOf(sim));
    for (const entity of army) expect(sim.world.has(entity, TrainingOrder)).toBe(false);
    expect(sim.world.has(rival, TrainingOrder)).toBe(true);
  });

  it.each([
    { kind: 'spawnSettler', tribe: 1, jobType: 31, x: 1, y: 1 },
    { kind: 'unitActionGroup', members: [], action: { kind: 'cancelTraining' } },
    { kind: 'orderNeed', need: 'hunger', entity: 99 },
    { kind: 'orderNeed', need: 'hunger', owner: 1 },
    { kind: 'orderNeed', need: 'unknown' },
    { kind: 'cancelTraining', house: 99 },
    { kind: 'makeChild', child: 'unknown' },
  ])('refuses a nested action outside its exact member-local payload: $kind', (action) => {
    expect(() =>
      parseCommandEnvelope({
        v: 1,
        origin: 'player',
        player: P0,
        command: {
          kind: 'unitActionGroup',
          members: [{ entity: 1 }],
          action,
        },
      }),
    ).toThrow();
  });

  it('round-trips pending groups and active Shift queues through saves and serialized replay', () => {
    const { sim, army } = armyWorld(8);
    const restore = (source: Simulation): Simulation =>
      restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(source)))), {
        content: testContent(),
        map: grassMap(WIDTH, HEIGHT),
      });
    sim.enqueue(playerCommand(P0, { kind: 'moveUnitGroup', members: destinations(army) }));
    sim.enqueue(
      playerCommand(P0, {
        kind: 'unitActionGroup',
        members: army.map((entity) => ({ entity })),
        action: { kind: 'cancelTraining' },
      }),
    );
    const pendingCopy = restore(sim);
    sim.step();
    pendingCopy.step();
    expect(pendingCopy.hashState()).toBe(sim.hashState());
    sim.enqueue(
      playerCommand(P0, { kind: 'attackMoveUnitGroup', members: destinations(army, 120), queued: true }),
    );
    sim.step();
    const copy = restore(sim);
    const replay = restore(pendingCopy);
    const log = parseCommandLog(JSON.parse(JSON.stringify(sim.commands.log)));
    for (const entry of log.filter((entry) => entry.applyTick > replay.tick)) replay.enqueue(entry);
    replay.step();
    expect(replay.hashState()).toBe(sim.hashState());
    for (let i = 0; i < 20; i++) {
      sim.step();
      copy.step();
      replay.step();
      expect(copy.hashState()).toBe(sim.hashState());
      expect(replay.hashState()).toBe(sim.hashState());
    }
  });

  it.each([
    { kind: 'moveUnitGroup', queued: true },
    { kind: 'attackMoveUnitGroup', queued: true },
    { kind: 'attackUnitGroup', target: 5000 },
    { kind: 'setStanceGroup', mode: MILITARY_MODE.DEFEND },
    { kind: 'setRegenerationGroup', enabled: false },
    { kind: 'unitActionGroup', action: { kind: 'orderNeed', need: 'piety' } },
  ])('bounds imported $kind and rejects duplicate or malformed members', (fields) => {
    const walk = fields.kind === 'moveUnitGroup' || fields.kind === 'attackMoveUnitGroup';
    const members = Array.from({ length: MAX_UNIT_ORDER_MEMBERS }, (_, i) => ({
      entity: i + 1,
      ...(walk ? { x: i, y: 0 } : {}),
    }));
    const envelope = { v: 1, origin: 'player', player: P0, command: { ...fields, members } };
    expect(parseCommandEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
    const parse = (command: unknown): unknown => parseCommandEnvelope({ ...envelope, command });
    expect(() => parse({ ...envelope.command, members: [...members, members[0]] })).toThrow(/at most 4096/);
    expect(() => parse({ ...envelope.command, members: [members[0], members[0]] })).toThrow(
      /duplicate entity/,
    );
    expect(() => parse({ ...envelope.command, members: [{ ...members[0], entity: 1.5 }] })).toThrow(
      /expected an integer/,
    );
    expect(() => parse({ ...envelope.command, members: [{ ...members[0], owner: P1 }] })).toThrow(
      /unknown field/,
    );
    if (walk) {
      expect(() => parse({ ...envelope.command, members: [{ entity: 1, x: 1.5, y: 0 }] })).toThrow(
        /expected an integer/,
      );
    }
  });
});
