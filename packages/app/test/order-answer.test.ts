import type { Entity } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { orderAnswerOf } from '../src/view/runtime/order-answer.js';

const one = 1 as Entity;
const two = 2 as Entity;

describe('order answers', () => {
  it('lets every member of a group order answer, and marks an attack', () => {
    const march = [
      { entity: one, x: 4, y: 4 },
      { entity: two, x: 6, y: 4 },
    ];
    expect(orderAnswerOf({ kind: 'moveUnitGroup', members: march })).toEqual({ members: [one, two] });
    expect(orderAnswerOf({ kind: 'attackMoveUnitGroup', members: march })).toEqual({
      members: [one, two],
      attack: true,
    });
    expect(orderAnswerOf({ kind: 'attackUnit', entity: one, target: two })).toEqual({
      members: [one],
      attack: true,
    });
  });

  it('answers nothing for a command that addresses no unit', () => {
    expect(orderAnswerOf({ kind: 'setDefenceMode', building: one, enabled: true })).toBeNull();
  });
});
