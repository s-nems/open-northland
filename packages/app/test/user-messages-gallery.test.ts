import { ONE, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createMessageFeed } from '../src/hud/tool-panel/messages/feed.js';
import { galleryMessages } from '../src/hud/tool-panel/messages/gallery.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import { composeMessageText, type MessageText } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';
import { en } from '../src/i18n/en.js';

const LOCAL = 0;
const ENEMY = 1;
const GOOD = 5;
const JOB = 7;
const HOUSE = 12;

interface Actor {
  readonly id: number;
  readonly player: number;
  readonly kind: 'person' | 'building';
}

function snapshot(actors: readonly Actor[]): WorldSnapshot {
  return {
    tick: 100,
    events: [],
    entities: actors.map((a) => ({
      id: a.id,
      components: {
        Owner: { player: a.player },
        Position: { x: 3 * ONE, y: 2 * ONE },
        ...(a.kind === 'building'
          ? { Building: { buildingType: HOUSE, tribe: 1, built: ONE, level: 0 } }
          : { Settler: { tribe: 1, jobType: JOB }, Person: { person: true } }),
      },
    })),
  };
}

const plain = (full: string): MessageText => ({ short: full, full });
/** Names as the fakes in the sibling tests do, with the real composer behind `text` over synthetic rows,
 *  so every type's composition is exercised without the decoded strings. */
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: 'drwal' }),
  building: () => 'Dom',
  player: (player) => `Gracz ${player}`,
  stance: (state) => state,
  paper: (paper) => paper.kind,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  training: (course, subjectName, jobName) => plain(`${course}:${subjectName}:${jobName}`),
  text: (type, parts) =>
    composeMessageText(type, parts, {
      uiString: (_table, _id, fallback) => fallback,
      fallbackRow: (id) => `row${id}`,
      short: {
        byType: en.userMessages.short,
        withGood: en.userMessages.shortWithGood,
        withStance: en.userMessages.shortWithStance,
        unknownHeroDied: en.userMessages.shortUnknownHeroDied,
      },
    }),
};

const ALL_TYPES = Object.values(USER_MESSAGE_TYPE);
const world = snapshot([
  { id: 1, player: LOCAL, kind: 'person' },
  { id: 2, player: LOCAL, kind: 'person' },
  { id: 3, player: ENEMY, kind: 'person' },
  { id: 4, player: LOCAL, kind: 'building' },
]);

describe('notice gallery', () => {
  it('raises one message of every type with non-empty text, on the seat’s own actors only', () => {
    const out = galleryMessages(world, LOCAL, naming, [], { goodType: GOOD });
    expect(out.map((r) => r.pending.type).sort((a, b) => a - b)).toEqual(
      [...ALL_TYPES].sort((a, b) => a - b),
    );
    for (const raised of out) {
      const text = raised.compose();
      expect(text.full, `type ${raised.pending.type}`).not.toBe('');
      expect(text.short, `type ${raised.pending.type}`).not.toBe('');
      expect(raised.pending.subject?.entity, `type ${raised.pending.type}`).not.toBe(3);
    }
  });

  it('spreads the settler rows over the seat’s people and names the good, the paper and the seat', () => {
    const out = galleryMessages(world, LOCAL, naming, [{ player: ENEMY, towardYou: 'friend' }], {
      goodType: GOOD,
    });
    const byType = new Map(out.map((r) => [r.pending.type, r]));
    const settlers = new Set(
      out
        .map((r) => r.pending.subject)
        .filter((s) => s?.kind === 'settler')
        .map((s) => s?.entity),
    );
    expect([...settlers].sort()).toEqual([1, 2]);
    expect(byType.get(USER_MESSAGE_TYPE.goodNotFound)?.compose().full).toContain('good:5');
    expect(byType.get(USER_MESSAGE_TYPE.specialItemFound)?.compose().full).toContain('indulgence');
    expect(byType.get(USER_MESSAGE_TYPE.diplomacyChanged)?.compose().full).toContain('Gracz 1');
    expect(byType.get(USER_MESSAGE_TYPE.diplomacyChanged)?.compose().full).toContain('friend');
    expect(byType.get(USER_MESSAGE_TYPE.houseFinished)?.pending.subject).toEqual({
      kind: 'building',
      entity: 4,
    });
    expect(byType.get(USER_MESSAGE_TYPE.experienceUnlocks)?.pending.technologies).toEqual([
      { kind: 'job', typeId: JOB },
      { kind: 'good', typeId: GOOD },
      { kind: 'house', typeId: HOUSE },
    ]);
  });

  it('raises the same keys on every sweep, so a second pass adds nothing to the feed', () => {
    const feed = createMessageFeed();
    const sweep = (): readonly string[] =>
      galleryMessages(world, LOCAL, naming, [], { goodType: GOOD }).map((r) =>
        feed.add(r.pending, world.tick, r.compose),
      );
    expect(new Set(sweep())).toEqual(new Set(['accepted']));
    expect(new Set(sweep())).toEqual(new Set(['duplicate']));
    expect(feed.live()).toHaveLength(ALL_TYPES.length);
  });

  it('keeps only the subjectless rows when the seat has no one and nothing', () => {
    const out = galleryMessages(snapshot([{ id: 3, player: ENEMY, kind: 'person' }]), LOCAL, naming, [], {
      goodType: null,
    });
    expect(out.map((r) => r.pending.type).sort((a, b) => a - b)).toEqual([
      USER_MESSAGE_TYPE.playerSighted,
      USER_MESSAGE_TYPE.diplomacyChanged,
      USER_MESSAGE_TYPE.playerDied,
      USER_MESSAGE_TYPE.specialItemFound,
    ]);
  });
});
