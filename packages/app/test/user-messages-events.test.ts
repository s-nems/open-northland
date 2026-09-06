import { type Entity, ONE, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { messagesFromEvents } from '../src/hud/tool-panel/messages/from-events.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';

const LOCAL = 0;
const ENEMY = 1;
/** Entity ids as the sim brands them. */
const e = (id: number): Entity => id as Entity;

interface Actor {
  readonly id: number;
  readonly player: number;
  readonly kind: 'person' | 'animal' | 'building';
  readonly col?: number;
}

function snapshot(tick: number, actors: readonly Actor[]): WorldSnapshot {
  return {
    tick,
    events: [],
    entities: [...actors]
      .sort((a, b) => a.id - b.id)
      .map((a) => ({
        id: a.id,
        components: {
          Owner: { player: a.player },
          Position: { x: (a.col ?? 3) * ONE, y: 2 * ONE },
          ...(a.kind === 'building'
            ? { Building: { buildingType: 12, tribe: 1, built: ONE, level: 0 } }
            : { Settler: { tribe: 1, jobType: 7 } }),
          ...(a.kind === 'person' ? { Person: { person: true } } : {}),
        },
      })),
  };
}

const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null }),
  building: () => 'Dom',
  text: (type, parts) => `${parts.subjectName ?? '?'}:${type}`,
};

/** Raised messages flattened for assertions: the identity fields plus the composed text. */
const run = (events: SimEvent[], snap: WorldSnapshot, previous: WorldSnapshot | null = null) =>
  messagesFromEvents(events, snap, previous, LOCAL, naming).map((r) => ({ ...r.pending, text: r.compose() }));

describe('user messages from sim events', () => {
  it("raises finished and upgraded buildings the seat owns, and no one else's", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'building' },
      { id: 2, player: ENEMY, kind: 'building' },
    ]);
    const out = run(
      [
        { kind: 'buildingFinished', entity: e(1) },
        { kind: 'buildingFinished', entity: e(2) },
        { kind: 'buildingUpgraded', entity: e(1), level: 1 },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject, m.text])).toEqual([
      [
        USER_MESSAGE_TYPE.houseFinished,
        { kind: 'building', entity: e(1) },
        `Dom:${USER_MESSAGE_TYPE.houseFinished}`,
      ],
      [
        USER_MESSAGE_TYPE.houseUpgraded,
        { kind: 'building', entity: e(1) },
        `Dom:${USER_MESSAGE_TYPE.houseUpgraded}`,
      ],
    ]);
    expect(out[0]?.at).toEqual({ hx: 6, hy: 4 });
  });

  it("announces a person born to the seat, not an animal or another seat's child", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: LOCAL, kind: 'animal' },
      { id: 3, player: ENEMY, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'settlerBorn', entity: e(1) },
        { kind: 'settlerBorn', entity: e(2) },
        { kind: 'settlerBorn', entity: e(3) },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject?.entity, m.jobType])).toEqual([
      [USER_MESSAGE_TYPE.wasBorn, 1, 7],
    ]);
  });

  it('names a reaped settler off the snapshot before the frame, else reports an unknown hero', () => {
    const before = snapshot(49, [{ id: 1, player: LOCAL, kind: 'person' }]);
    const after = snapshot(50, []);
    const events: SimEvent[] = [
      { kind: 'settlerDied', entity: e(1), cause: 'combat', player: LOCAL, at: { hx: 4, hy: 4 } },
      { kind: 'settlerDied', entity: e(2), cause: 'combat', player: LOCAL, at: { hx: 8, hy: 8 } },
      { kind: 'settlerDied', entity: e(3), cause: 'combat', player: LOCAL, animal: true },
      { kind: 'settlerDied', entity: e(4), cause: 'combat', player: ENEMY },
    ];
    const out = run(events, after, before);
    expect(out.map((m) => [m.type, m.subject, m.at, m.text])).toEqual([
      [USER_MESSAGE_TYPE.humanDied, null, { hx: 4, hy: 4 }, `S1:${USER_MESSAGE_TYPE.humanDied}`],
      [USER_MESSAGE_TYPE.humanDied, null, { hx: 8, hy: 8 }, `?:${USER_MESSAGE_TYPE.humanDied}`],
    ]);
  });

  it("turns a blow on the seat's settler or building into an attack note", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: LOCAL, kind: 'building' },
      { id: 3, player: ENEMY, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'combatHit', attacker: e(3), target: e(1), at: { hx: 1, hy: 1 } },
        {
          kind: 'projectileHit',
          projectile: e(9),
          shooter: e(3),
          target: e(2),
          munitionType: 1,
          structure: true,
          at: { hx: 1, hy: 1 },
        },
        { kind: 'combatHit', attacker: e(1), target: e(3), at: { hx: 1, hy: 1 } },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject])).toEqual([
      [USER_MESSAGE_TYPE.humanAttacked, { kind: 'settler', entity: e(1) }],
      [USER_MESSAGE_TYPE.houseAttacked, { kind: 'building', entity: e(2) }],
    ]);
  });

  it('raises one attack note per target however many blows land in the frame', () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 3, player: ENEMY, kind: 'person' },
    ]);
    let composed = 0;
    const counting: MessageNaming = {
      ...naming,
      text: (type, parts) => `${composed++}:${parts.subjectName}:${type}`,
    };
    const raised = messagesFromEvents(
      [
        { kind: 'combatHit', attacker: e(3), target: e(1), at: { hx: 1, hy: 1 } },
        { kind: 'combatHit', attacker: e(3), target: e(1), at: { hx: 1, hy: 1 } },
        {
          kind: 'projectileHit',
          projectile: e(9),
          shooter: e(3),
          target: e(1),
          munitionType: 1,
          at: { hx: 1, hy: 1 },
        },
      ],
      snap,
      null,
      LOCAL,
      counting,
    );
    expect(raised).toHaveLength(1);
    expect(composed).toBe(0);
    expect(raised[0]?.compose()).toBe(`0:S1:${USER_MESSAGE_TYPE.humanAttacked}`);
  });

  it('ignores events with no message in the original', () => {
    const snap = snapshot(50, [{ id: 1, player: LOCAL, kind: 'building' }]);
    expect(run([{ kind: 'defenceAlarmRaised', entity: e(1), player: LOCAL }], snap)).toEqual([]);
  });
});
