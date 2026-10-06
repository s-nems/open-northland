import { describe, expect, it } from 'vitest';
import {
  addPerson,
  MISSION_BEHAVIOUR,
  Owner,
  Position,
  Rider,
  seatPassenger,
  setMissionBehaviour,
  setNeedsEnabled,
  Vehicle,
  VehicleDrive,
  VehicleRoute,
} from '../../src/components/index.js';
import {
  exportSaveGame,
  MAX_UNIT_ORDER_MEMBERS,
  ONE,
  type PlayerCommand,
  parseCommandEnvelope,
  parseCommandLog,
  parseSaveGame,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { authorizedCommand } from '../../src/systems/command/authority.js';
import { commandSystem } from '../../src/systems/command/index.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

function vehicleContent() {
  const base = testContent();
  const weapon = base.weapons[0];
  if (weapon === undefined) throw new Error('missing fixture weapon');
  return {
    ...base,
    weapons: [
      ...base.weapons,
      { ...weapon, typeId: 21, id: 'group_siege', tribeType: 1, jobType: 54, minRange: 1, maxRange: 250 },
    ],
  };
}

function fixture() {
  const sim = new Simulation({ seed: 8, content: vehicleContent(), map: grassNodeMap(160, 100) });
  setNeedsEnabled(sim.world, false);
  const person = (player: number) => {
    const entity = sim.world.create();
    addPerson(sim.world, entity, {
      tribe: 1,
      jobType: 31,
      hunger: ONE,
      fatigue: ONE,
      piety: ONE,
      enjoyment: ONE,
    });
    sim.world.add(entity, Owner, { player });
    sim.world.add(entity, Position, positionOfNode(4, 4));
    return entity;
  };
  const vehicle = (x: number, y: number, player = 0) => {
    const entity = createVehicle(sim.world, ctxOf(sim), { vehicleType: 5, tribe: 1, x, y, owner: player });
    if (entity === null) throw new Error('missing catapult');
    const commander = person(player);
    if (!seatPassenger(sim.world, entity, commander)) throw new Error('no commander seat');
    boardRider(sim.world, commander, entity);
    return entity;
  };
  const vehicles = Array.from({ length: 25 }, (_, i) => vehicle(8 + 5 * (i % 5), 8 + 5 * Math.floor(i / 5)));
  const rival = vehicle(130, 80, 1);
  const held = vehicle(8, 38);
  setMissionBehaviour(sim.world, held, MISSION_BEHAVIOUR.NOT_CONTROLLABLE, true);
  const stale = sim.world.create();
  sim.world.destroy(stale);
  return { sim, vehicles, rival, held, stale, person };
}

function restore(sim: Simulation): Simulation {
  return restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
    content: vehicleContent(),
    map: grassNodeMap(160, 100),
  });
}

describe('atomic vehicle selection orders', () => {
  it.each([false, true])(
    'drives every authorized vehicle in one tick, preserving individual mechanics (attackMove=%s)',
    (attackMove) => {
      const grouped = fixture(),
        singles = fixture();
      const members = [...grouped.vehicles, grouped.rival, grouped.held, grouped.stale].map((entity, i) => ({
        entity,
        x: 70 + 5 * (i % 5),
        y: 8 + 5 * Math.floor(i / 5),
      }));
      grouped.sim.enqueue(
        playerCommand(0, { kind: 'moveVehicleGroup', members, ...(attackMove ? { attackMove: true } : {}) }),
      );
      for (const { entity: vehicle, x, y } of members)
        singles.sim.enqueue(
          playerCommand(0, {
            kind: 'moveVehicle',
            vehicle,
            x,
            y,
            ...(attackMove ? { attackMove: true } : {}),
          }),
        );
      commandSystem(grouped.sim.world, ctxOf(grouped.sim));
      commandSystem(singles.sim.world, ctxOf(singles.sim));
      expect(grouped.sim.snapshot().entities).toEqual(singles.sim.snapshot().entities);
      for (const entity of grouped.vehicles) {
        expect(grouped.sim.world.has(entity, VehicleDrive)).toBe(true);
        expect(grouped.sim.world.has(entity, VehicleRoute)).toBe(true);
        expect(grouped.sim.world.get(entity, Vehicle).march !== null).toBe(attackMove);
      }
      expect(grouped.sim.world.has(grouped.rival, VehicleDrive)).toBe(false);
      expect(grouped.sim.world.has(grouped.held, VehicleDrive)).toBe(false);
      expect(grouped.sim.commands.log).toHaveLength(1);
    },
  );

  it('attacks with all authorized catapults and restores pending groups and serialized replay', () => {
    const { sim, vehicles, rival, held, stale } = fixture();
    const replay = restore(sim);
    const target = { kind: 'entity' as const, entity: rival };
    sim.enqueue(
      playerCommand(0, {
        kind: 'attackWithVehicleGroup',
        members: [...vehicles, rival, held, stale].map((entity) => ({ entity })),
        target,
      }),
    );
    const saved = restore(sim);
    sim.step();
    saved.step();
    for (const entry of parseCommandLog(JSON.parse(JSON.stringify(sim.commands.log)))) replay.enqueue(entry);
    replay.step();
    expect(saved.hashState()).toBe(sim.hashState());
    expect(replay.hashState()).toBe(sim.hashState());
    for (const entity of vehicles)
      expect(sim.world.get(entity, Vehicle).attack).toMatchObject({ target, ordered: true });
    expect(sim.world.get(rival, Vehicle).attack?.ordered).not.toBe(true);
    expect(sim.world.get(held, Vehicle).attack?.ordered).not.toBe(true);
  });

  it('sets every selected vehicle stance together while filtering rival and script-held members', () => {
    const { sim, vehicles, rival, held } = fixture();
    sim.enqueue(
      playerCommand(0, {
        kind: 'setVehicleStanceGroup',
        members: [...vehicles, rival, held].map((entity) => ({ entity })),
        stance: 'defence',
      }),
    );
    commandSystem(sim.world, ctxOf(sim));
    for (const entity of vehicles) expect(sim.world.get(entity, Vehicle).stance).toBe('defence');
    expect(sim.world.get(rival, Vehicle).stance).toBe('hold');
    expect(sim.world.get(held, Vehicle).stance).toBe('hold');
    expect(sim.commands.log).toHaveLength(1);
  });

  it('checks both the passenger and vehicle owner inside grouped boarding', () => {
    const { sim, vehicles, rival, person } = fixture();
    const owned = person(0),
      other = person(1);
    const vehicle = vehicles[0];
    if (vehicle === undefined) throw new Error('missing vehicle');
    const order: PlayerCommand = {
      kind: 'unitActionGroup',
      members: [{ entity: owned }, { entity: other }],
      action: { kind: 'attachToVehicle', vehicle },
    };
    expect(authorizedCommand(sim.world, playerCommand(0, order))).toMatchObject({
      members: [{ entity: owned }],
    });
    const rejected: PlayerCommand = {
      kind: 'unitOrdersGroup',
      members: [{ entity: owned, actions: [{ kind: 'attachToVehicle', vehicle: rival }] }],
    };
    expect(authorizedCommand(sim.world, playerCommand(0, rejected))).toMatchObject({ members: [] });
    sim.enqueue(playerCommand(0, rejected));
    commandSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(owned, Rider)).toBe(false);
  });

  it.each(['moveVehicleGroup', 'attackWithVehicleGroup'] as const)(
    'bounds and strictly parses %s members and targets',
    (kind) => {
      const fields =
        kind === 'moveVehicleGroup' ? { attackMove: true } : { target: { kind: 'ground', hx: 2, hy: 4 } };
      const member = { entity: 1, ...(kind === 'moveVehicleGroup' ? { x: 4, y: 6 } : {}) };
      const parse = (members: unknown) =>
        parseCommandEnvelope({ v: 1, origin: 'player', player: 0, command: { kind, ...fields, members } });
      expect(parse([member])).toBeDefined();
      expect(() => parse([member, member])).toThrow(/duplicate entity/);
      expect(() => parse([{ ...member, owner: 1 }])).toThrow(/unknown field/);
      expect(() =>
        parse(Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => ({ ...member, entity: i + 1 }))),
      ).toThrow(/at most 4096/);
    },
  );
});
