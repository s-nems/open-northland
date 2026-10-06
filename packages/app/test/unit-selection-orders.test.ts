import {
  type Entity,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  type UnitSelectionCommand,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { enqueueUnitSelection } from '../src/view/unit-controls/group-orders.js';

describe('bounded selection gestures', () => {
  it('keeps different equipment slots and each member’s compound action order in one envelope', () => {
    const commands: UnitSelectionCommand[] = Array.from({ length: 1000 }, (_, i) => [
      { kind: 'unequipGood' as const, entity: (i + 1) as Entity, group: 'misc' as const, slot: i % 3 },
      {
        kind: 'equipGood' as const,
        entity: (i + 1) as Entity,
        group: 'misc' as const,
        slot: i % 3,
        goodType: 70,
      },
    ]).flat();
    const issued: PlayerCommand[] = [];
    expect(enqueueUnitSelection(commands, (command) => issued.push(command))).toBe(true);
    expect(issued).toHaveLength(1);
    expect(issued[0]?.kind).toBe('unitOrdersGroup');
    const group = issued[0];
    if (group?.kind !== 'unitOrdersGroup') throw new Error('expected compound gesture');
    expect(group.members).toHaveLength(1000);
    expect(
      group.members.flatMap(({ entity, actions }) => actions.map((action) => ({ ...action, entity }))),
    ).toEqual(commands);
    expect(new TextEncoder().encode(JSON.stringify(group)).length).toBeLessThan(512 * 1024);
  });

  it('compacts identical actions and preserves the existing single-settler payload', () => {
    const issued: PlayerCommand[] = [];
    const first: UnitSelectionCommand = { kind: 'setJob', entity: 2 as Entity, jobType: 31 };
    const commands = [first];
    enqueueUnitSelection(commands, (command) => issued.push(command));
    enqueueUnitSelection([...commands, { ...first, entity: 3 as Entity }], (command) => issued.push(command));
    expect(issued).toEqual([
      commands[0],
      {
        kind: 'unitActionGroup',
        members: [{ entity: 2 }, { entity: 3 }],
        action: { kind: 'setJob', jobType: 31 },
      },
    ]);
  });

  it('refuses an oversized whole gesture before submitting any member', () => {
    const commands: UnitSelectionCommand[] = Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => ({
      kind: 'setWorkFlag',
      entity: (i + 1) as Entity,
      x: i,
      y: 0,
    }));
    const issued: PlayerCommand[] = [];
    let refused = 0;
    expect(
      enqueueUnitSelection(
        commands,
        (command) => issued.push(command),
        () => refused++,
      ),
    ).toBe(false);
    expect(issued).toEqual([]);
    expect(refused).toBe(1);
  });

  it('never silently reorders interleaved settlers or truncates a member’s action list', () => {
    const order = (entity: number): UnitSelectionCommand => ({
      kind: 'cancelTraining',
      entity: entity as Entity,
    });
    for (const commands of [
      [order(1), order(2), order(1)],
      [order(1), order(1), order(1)],
    ]) {
      const issued: PlayerCommand[] = [];
      let refused = 0;
      expect(
        enqueueUnitSelection(
          commands,
          (command) => issued.push(command),
          () => refused++,
        ),
      ).toBe(false);
      expect(issued).toEqual([]);
      expect(refused).toBe(1);
    }
  });
});
