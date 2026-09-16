import { describe, expect, it } from 'vitest';
import { createDiplomacyMessageSource, type MetSeat } from '../src/hud/tool-panel/messages/from-diplomacy.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';

const ALLY = 1;
const RIVAL = 2;

const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null }),
  building: () => 'Dom',
  player: (player) => `Gracz ${player}`,
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type, parts) => `${parts.subjectName ?? '?'}:${type}:${parts.stanceName ?? ''}`,
};

describe('user messages about the other seats', () => {
  it('announces a first contact and every stance that moves toward this seat', () => {
    let seats: readonly MetSeat[] = [{ player: ALLY, towardYou: 'neutral' }];
    const source = createDiplomacyMessageSource(() => seats);
    const poll = (): [number, number | null][] =>
      source.poll(naming).map((r) => [r.pending.type, r.pending.about]);

    expect(poll()).toEqual([]); // the seeding poll records what the player already knows

    seats = [...seats, { player: RIVAL, towardYou: 'friend' }];
    expect(poll()).toEqual([[USER_MESSAGE_TYPE.playerSighted, RIVAL]]);

    seats = [
      { player: ALLY, towardYou: 'enemy' },
      { player: RIVAL, towardYou: 'friend' },
    ];
    expect(poll()).toEqual([[USER_MESSAGE_TYPE.diplomacyChanged, ALLY]]);

    expect(poll()).toEqual([]);
  });

  it('names the seat and the stance it now holds', () => {
    let seats: readonly MetSeat[] = [];
    const source = createDiplomacyMessageSource(() => seats);
    source.poll(naming);
    seats = [{ player: RIVAL, towardYou: 'enemy' }];
    expect(source.poll(naming).map((r) => r.compose())).toEqual([
      `Gracz ${RIVAL}:${USER_MESSAGE_TYPE.playerSighted}:enemy`,
    ]);
  });
});
