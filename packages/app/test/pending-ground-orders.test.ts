import type { Entity, PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createPendingGroundOrders } from '../src/view/unit-controls/pending-ground-orders.js';

const entity = (id: number): Entity => id as Entity;
const move = (ids: readonly number[], x: number, queued = false): PlayerCommand => ({
  kind: 'moveUnitGroup',
  members: ids.map((id) => ({ entity: entity(id), x, y: 10 })),
  ...(queued ? { queued: true } : {}),
});

function fixture() {
  const pending = createPendingGroundOrders();
  const commands: PlayerCommand[] = [];
  const enqueue = (command: PlayerCommand): void => {
    commands.push(command);
  };
  const submit = (command: PlayerCommand): void => pending.submit(command, enqueue);
  return { pending, commands, submit };
}

describe('pending ground order intent', () => {
  it('keeps the unaffected 990 when 10 of 1000 receive a newer move, without waiting on the old answer', () => {
    const { pending, commands, submit } = fixture();
    const army = Array.from({ length: 1000 }, (_, i) => i + 1);
    const old = pending.begin(army, false);
    const redirected = pending.begin(army.slice(0, 10), false);
    pending.settle(redirected, () => submit(move(army.slice(0, 10), 80)));
    expect(commands).toEqual([move(army.slice(0, 10), 80)]);
    pending.settle(old, () =>
      submit(
        move(
          army.filter((id) => pending.current(old, id)),
          40,
        ),
      ),
    );
    expect(commands).toEqual([move(army.slice(0, 10), 80), move(army.slice(10), 40)]);
  });

  it('emits overlapping Shift clicks in press order even when all answers arrive in reverse', () => {
    const { pending, commands, submit } = fixture();
    const first = pending.begin([1, 2], false);
    const second = pending.begin([1, 2], true);
    const third = pending.begin([1], true);
    pending.settle(third, () => submit(move([1], 90, true)));
    pending.settle(second, () => submit(move([1, 2], 60, true)));
    expect(commands).toEqual([]);
    pending.settle(first, () => submit(move([1, 2], 30)));
    expect(commands).toEqual([move([1, 2], 30), move([1, 2], 60, true), move([1], 90, true)]);
  });

  it('lets an unrelated Shift answer through while another army still waits', () => {
    const { pending, commands, submit } = fixture();
    pending.begin([1, 2], false);
    const other = pending.begin([3, 4], true);
    pending.settle(other, () => submit(move([3, 4], 60, true)));
    expect(commands).toEqual([move([3, 4], 60, true)]);
  });

  it('immediate target attacks supersede only their actors in a pending formation and its Shift tail', () => {
    const { pending, commands, submit } = fixture();
    const first = pending.begin([1, 2], false);
    const queued = pending.begin([1, 2], true);
    const attack: PlayerCommand = { kind: 'attackUnit', entity: entity(1), target: entity(90) };
    submit(attack);
    pending.settle(queued, () =>
      submit(
        move(
          [1, 2].filter((id) => pending.current(queued, id)),
          60,
          true,
        ),
      ),
    );
    pending.settle(first, () =>
      submit(
        move(
          [1, 2].filter((id) => pending.current(first, id)),
          30,
        ),
      ),
    );
    expect(commands).toEqual([attack, move([2], 30), move([2], 60, true)]);
  });

  it('preserves a pending walk across stance, regeneration and home settings', () => {
    const { pending, commands, submit } = fixture();
    const ticket = pending.begin([1, 2], false);
    const stance: PlayerCommand = { kind: 'setStanceGroup', members: [{ entity: entity(1) }], mode: 2 };
    const regeneration: PlayerCommand = { kind: 'setRegeneration', entity: entity(2), enabled: false };
    submit(stance);
    submit(regeneration);
    const home: PlayerCommand = { kind: 'assignHouse', entity: entity(1), house: entity(70) };
    const groupHome: PlayerCommand = {
      kind: 'assignHouseGroup',
      members: [{ entity: entity(2) }],
      house: entity(70),
    };
    const homeless: PlayerCommand = { kind: 'unassignHouse', entity: entity(2) };
    submit(home);
    submit(groupHome);
    submit(homeless);
    pending.settle(ticket, () => submit(move([1, 2], 30)));
    expect(commands).toEqual([stance, regeneration, home, groupHome, homeless, move([1, 2], 30)]);
  });

  it('nested needs and boarding replace the appropriate pending actors', () => {
    const { pending, commands, submit } = fixture();
    const ticket = pending.begin([1, 2, 3], false);
    submit({
      kind: 'unitActionGroup',
      members: [{ entity: entity(1) }],
      action: { kind: 'orderNeed', need: 'fatigue' },
    });
    submit({
      kind: 'unitOrdersGroup',
      members: [{ entity: entity(2), actions: [{ kind: 'attachToVehicle', vehicle: entity(99) }] }],
    });
    pending.settle(ticket, () =>
      submit(
        move(
          [1, 2, 3].filter((id) => pending.current(ticket, id)),
          30,
        ),
      ),
    );
    expect(commands.at(-1)).toEqual(move([3], 30));
  });

  it('an immediate Shift-chest waits behind the pending walk and drops only replaced members', () => {
    const { pending, commands, submit } = fixture();
    const ticket = pending.begin([1, 2], false);
    submit({
      kind: 'unitActionGroup',
      members: [{ entity: entity(1) }, { entity: entity(2) }],
      action: { kind: 'openChest', chest: entity(80), queued: true },
    });
    expect(commands).toEqual([]);
    submit({ kind: 'attackUnit', entity: entity(1), target: entity(90) });
    pending.settle(ticket, () => submit(move([2], 30)));
    expect(commands.slice(1)).toEqual([
      move([2], 30),
      {
        kind: 'unitActionGroup',
        members: [{ entity: entity(2) }],
        action: { kind: 'openChest', chest: entity(80), queued: true },
      },
    ]);
  });

  it('a new normal click discards unanswered earlier clicks and their already answered Shift tail', () => {
    const { pending, commands, submit } = fixture();
    const old = pending.begin([1], false);
    const tail = pending.begin([1], true);
    pending.settle(tail, () => submit(move([1], 60, true)));
    const latest = pending.begin([1], false);
    pending.settle(latest, () => submit(move([1], 90)));
    pending.settle(old, () => submit(move([1], 30)));
    expect(commands).toEqual([move([1], 90)]);
  });

  it('queues a Shift-signpost behind an unanswered ground order', () => {
    const { pending, commands, submit } = fixture();
    const ticket = pending.begin([1], false);
    const signpost: PlayerCommand = { kind: 'placeSignpost', entity: entity(1), x: 50, y: 10, queued: true };
    submit(signpost);
    expect(commands).toEqual([]);
    pending.settle(ticket, () => submit(move([1], 30)));
    expect(commands).toEqual([move([1], 30), signpost]);
  });

  it('failed and duplicate answers release the next Shift exactly once; disposal suppresses late answers', () => {
    const { pending, commands, submit } = fixture();
    const first = pending.begin([1], false);
    const next = pending.begin([1], true);
    pending.settle(next, () => submit(move([1], 60, true)));
    pending.settle(first, () => {});
    pending.settle(first, () => submit(move([1], 30)));
    expect(commands).toEqual([move([1], 60, true)]);
    const last = pending.begin([1], false);
    pending.dispose();
    pending.settle(last, () => submit(move([1], 90)));
    expect(pending.current(last, 1)).toBe(false);
    expect(commands).toHaveLength(1);
  });

  it('starts a fresh Shift chain after all previous answers have finished', () => {
    const { pending, commands, submit } = fixture();
    const first = pending.begin([1], false);
    pending.settle(first, () => submit(move([1], 30)));
    const second = pending.begin([1], true);
    const third = pending.begin([1], true);
    pending.settle(third, () => submit(move([1], 90, true)));
    pending.settle(second, () => submit(move([1], 60, true)));
    expect(commands).toEqual([move([1], 30), move([1], 60, true), move([1], 90, true)]);
  });
});
