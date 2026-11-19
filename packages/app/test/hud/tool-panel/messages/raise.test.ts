import { components, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { aboutSilencedSettler, type RaisedMessage } from '../../../../src/hud/tool-panel/messages/raise.js';
import { USER_MESSAGE_TYPE } from '../../../../src/hud/tool-panel/messages/types.js';

const SILENCED = 1;
const ORDINARY = 2;

const snapshot: WorldSnapshot = {
  tick: 0,
  events: [],
  entities: [
    { id: SILENCED, components: { MissionBehaviour: { flags: components.MISSION_BEHAVIOUR.NO_MESSAGES } } },
    { id: ORDINARY, components: {} },
  ],
};

function hungerNote(subject: number | null): RaisedMessage {
  return {
    pending: {
      type: USER_MESSAGE_TYPE.hungry,
      subject: subject === null ? null : { kind: 'settler', entity: subject },
      at: null,
      about: subject === null ? SILENCED : null,
      goodType: null,
      technologies: null,
      jobType: null,
    },
    compose: () => ({ short: '', full: '' }),
  };
}

describe('aboutSilencedSettler', () => {
  it('holds back a note about a settler a script silenced, and only that one', () => {
    expect(aboutSilencedSettler(hungerNote(SILENCED), snapshot)).toBe(true);
    expect(aboutSilencedSettler(hungerNote(ORDINARY), snapshot)).toBe(false);
    // A note with no live subject, as a death note is, still raises.
    expect(aboutSilencedSettler(hungerNote(null), snapshot)).toBe(false);
  });
});
