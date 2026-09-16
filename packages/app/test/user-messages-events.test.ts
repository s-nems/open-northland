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
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  training: (course, subjectName, jobName) => `${course}:${subjectName}:${jobName}`,
  text: (type, parts) =>
    `${parts.subjectName ?? '?'}:${type}${
      parts.technologySections === undefined
        ? ''
        : `:${parts.technologySections.jobs.join(',')}|${parts.technologySections.goods.join(',')}|${parts.technologySections.houses.join(',')}`
    }`,
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

  it("announces the seat's own child reaching adulthood", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: ENEMY, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'settlerGrewUp', entity: e(1) },
        { kind: 'settlerGrewUp', entity: e(2) },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject?.entity])).toEqual([[USER_MESSAGE_TYPE.grewUp, 1]]);
  });

  it("turns the local seat's discoveries into important settler notes", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: ENEMY, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'technologyDiscovered', entity: e(1), player: LOCAL, tribe: 1, technology: 'job', typeId: 8 },
        {
          kind: 'technologyDiscovered',
          entity: e(1),
          player: LOCAL,
          tribe: 1,
          technology: 'good',
          typeId: 9,
        },
        {
          kind: 'technologyDiscovered',
          entity: e(1),
          player: LOCAL,
          tribe: 1,
          technology: 'house',
          typeId: 10,
        },
        {
          kind: 'technologyDiscovered',
          entity: e(1),
          player: LOCAL,
          tribe: 1,
          technology: 'house',
          typeId: 11,
        },
        // A duplicate event in the same advancement batch must not duplicate the list entry.
        { kind: 'technologyDiscovered', entity: e(1), player: LOCAL, tribe: 1, technology: 'job', typeId: 8 },
        { kind: 'technologyDiscovered', entity: e(2), player: ENEMY, tribe: 1, technology: 'job', typeId: 8 },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject, m.technologies, m.text])).toEqual([
      [
        USER_MESSAGE_TYPE.experienceUnlocks,
        { kind: 'settler', entity: e(1) },
        [
          { kind: 'job', typeId: 8 },
          { kind: 'good', typeId: 9 },
        ],
        `S1:${USER_MESSAGE_TYPE.experienceUnlocks}:job:8|good:9|`,
      ],
      [
        USER_MESSAGE_TYPE.experienceUnlocks,
        { kind: 'settler', entity: e(1) },
        [
          { kind: 'house', typeId: 10 },
          { kind: 'house', typeId: 11 },
        ],
        `S1:${USER_MESSAGE_TYPE.experienceUnlocks}:||house:10,house:11`,
      ],
    ]);
  });

  it("announces this seat's completed barracks and school qualifications", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: ENEMY, kind: 'person' },
      { id: 3, player: LOCAL, kind: 'person', col: 5 },
    ]);
    const trainedNaming: MessageNaming = {
      ...naming,
      text: (type, parts) => `${parts.subjectName ?? '?'}:${type}:${parts.goodName ?? '-'}`,
    };
    const raised = messagesFromEvents(
      [
        { kind: 'settlerTrained', entity: e(1), course: 'barracks', target: 'job', typeId: 31 },
        { kind: 'settlerTrained', entity: e(1), course: 'school', target: 'good', typeId: 9 },
        { kind: 'settlerTrained', entity: e(2), course: 'school', target: 'job', typeId: 31 },
        { kind: 'settlerTrained', entity: e(3), course: 'school', target: 'job', typeId: 12 },
      ],
      snap,
      null,
      LOCAL,
      trainedNaming,
    );
    expect(raised.map((r) => ({ ...r.pending, text: r.compose() }))).toEqual([
      {
        type: USER_MESSAGE_TYPE.canDoNewJob,
        subject: { kind: 'settler', entity: e(1) },
        at: { hx: 6, hy: 4 },
        about: null,
        goodType: null,
        technologies: null,
        jobType: 31,
        text: 'barracks:S1:job:31',
      },
      {
        type: USER_MESSAGE_TYPE.canProduceNewGood,
        subject: { kind: 'settler', entity: e(1) },
        at: { hx: 6, hy: 4 },
        about: null,
        goodType: 9,
        technologies: null,
        jobType: 7,
        text: `S1:${USER_MESSAGE_TYPE.canProduceNewGood}:good:9`,
      },
      {
        type: USER_MESSAGE_TYPE.canDoNewJob,
        subject: { kind: 'settler', entity: e(3) },
        at: { hx: 10, hy: 4 },
        about: null,
        goodType: null,
        technologies: null,
        jobType: 12,
        text: 'school:S3:job:12',
      },
    ]);
  });

  it('announces an eliminated seat to everyone, naming the player rather than an entity', () => {
    const snap = snapshot(50, [{ id: 1, player: LOCAL, kind: 'person' }]);
    const out = run([{ kind: 'playerDefeated', player: ENEMY }], snap);
    expect(out).toEqual([
      {
        type: USER_MESSAGE_TYPE.playerDied,
        subject: null,
        at: null,
        about: ENEMY,
        goodType: null,
        technologies: null,
        jobType: null,
        text: `Gracz:${USER_MESSAGE_TYPE.playerDied}`,
      },
    ]);
  });

  it("notes this seat's settler the sim marked lost, and no one else's", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: ENEMY, kind: 'person' },
      { id: 3, player: LOCAL, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'settlerLost', entity: e(1) },
        { kind: 'settlerLost', entity: e(2) },
        { kind: 'settlerLost', entity: e(3) },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject?.entity])).toEqual([
      [USER_MESSAGE_TYPE.lostWithoutSignposts, 1],
      [USER_MESSAGE_TYPE.lostWithoutSignposts, 3],
    ]);
  });

  it('notes a marry order that found nobody', () => {
    const snap = snapshot(50, [{ id: 1, player: LOCAL, kind: 'person' }]);
    const out = run([{ kind: 'marriageUnmatched', entity: e(1) }], snap);
    expect(out.map((m) => [m.type, m.subject?.entity])).toEqual([[USER_MESSAGE_TYPE.noOneToMarry, 1]]);
  });

  it('notes a paper this seat found, named, keyed by the chest so two chests give two notes', () => {
    const snap = snapshot(50, []);
    const paper = { kind: 'placeHouse', param: 41 } as const;
    const out = run(
      [
        { kind: 'paperFound', player: LOCAL, paper, chest: e(70), at: { hx: 10, hy: 4 } },
        { kind: 'paperFound', player: LOCAL, paper, chest: e(71), at: { hx: 30, hy: 4 } },
        { kind: 'paperFound', player: ENEMY, paper, chest: e(72), at: { hx: 12, hy: 4 } },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.at, m.text])).toEqual([
      [USER_MESSAGE_TYPE.specialItemFound, { hx: 10, hy: 4 }, `?:${USER_MESSAGE_TYPE.specialItemFound}`],
      [USER_MESSAGE_TYPE.specialItemFound, { hx: 30, hy: 4 }, `?:${USER_MESSAGE_TYPE.specialItemFound}`],
    ]);
    expect(out.map((m) => m.about)).toEqual([70, 71]);
  });

  it('ignores events with no message in the original, a birth among them', () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'building' },
      { id: 2, player: LOCAL, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'defenceAlarmRaised', entity: e(1), player: LOCAL },
        { kind: 'settlerBorn', entity: e(2) },
      ],
      snap,
    );
    expect(out).toEqual([]);
  });
});
