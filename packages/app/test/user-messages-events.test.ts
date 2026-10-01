import { type Entity, ONE, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { FightAreas } from '../src/hud/tool-panel/messages/fight-areas.js';
import {
  type BuildingTrades,
  courseNoteKeeps,
  messagesFromEvents,
  pictureOfUnlocks,
} from '../src/hud/tool-panel/messages/from-events.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';

const LOCAL = 0;
const ENEMY = 1;
/** Entity ids as the sim brands them. */
const e = (id: number): Entity => id as Entity;

interface Actor {
  readonly id: number;
  readonly player: number;
  readonly kind: 'person' | 'animal' | 'building' | 'vehicle';
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
            : a.kind === 'vehicle'
              ? { Vehicle: { vehicleType: 2, tribe: 1, task: 'none', passengers: [null] } }
              : { Settler: { tribe: 1, jobType: 7 } }),
          ...(a.kind === 'person' ? { Person: { person: true } } : {}),
        },
      })),
  };
}

const plain = (full: string): MessageText => ({ short: full, full });
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null, female: false }),
  building: () => 'Dom',
  vehicle: () => 'Wóz',
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type, parts) =>
    plain(
      parts.training !== undefined
        ? `${parts.training.course}:${parts.subjectName}:${parts.training.profession}`
        : `${parts.subjectName ?? '?'}:${type}${
            parts.technologySections === undefined
              ? ''
              : `:${parts.technologySections.jobs.join(',')}|${parts.technologySections.goods.join(',')}|${parts.technologySections.houses.join(',')}`
          }`,
    ),
};

/** A construction menu that lists no building, so no unlock pictures one. */
const NO_MENU: BuildingTrades = () => undefined;

/** Raised messages flattened for assertions: the identity fields plus the composed text. */
const run = (events: SimEvent[], snap: WorldSnapshot, departed: WorldSnapshot['entities'] = []) =>
  messagesFromEvents(events, snap, departed, LOCAL, naming, NO_MENU, new FightAreas()).map((r) => ({
    ...r.pending,
    text: r.compose().full,
  }));

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

  it('names a reaped settler off the entities the frame removed, else reports an unknown hero', () => {
    const departed = snapshot(49, [{ id: 1, player: LOCAL, kind: 'person' }]).entities;
    const after = snapshot(50, []);
    const events: SimEvent[] = [
      { kind: 'settlerDied', entity: e(1), cause: 'combat', player: LOCAL, at: { hx: 4, hy: 4 } },
      { kind: 'settlerDied', entity: e(2), cause: 'combat', player: LOCAL, at: { hx: 8, hy: 8 } },
      { kind: 'settlerDied', entity: e(3), cause: 'combat', player: LOCAL, animal: true },
      { kind: 'settlerDied', entity: e(4), cause: 'combat', player: ENEMY },
    ];
    const out = run(events, after, departed);
    expect(out.map((m) => [m.type, m.subject, m.at, m.text])).toEqual([
      [USER_MESSAGE_TYPE.humanDied, null, { hx: 4, hy: 4 }, `S1:${USER_MESSAGE_TYPE.humanDied}`],
      [USER_MESSAGE_TYPE.humanDied, null, { hx: 8, hy: 8 }, `?:${USER_MESSAGE_TYPE.humanDied}`],
    ]);
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

  it('pictures the new trade’s workplace, else the settler’s own, else the first menu building', () => {
    // Trades and buildings as the content ties them: the potter works the pottery, the fixture settler's
    // trade (7) the mason's hut; the school employs no one and the cart site is not on the menu.
    const POTTER = 11;
    const OWN_TRADE = 7;
    const CARRIER = 24;
    const [POTTERY, SCHOOL, MASON_HUT, CART_SITE] = [20, 38, 30, 42];
    const trades = new Map<number, readonly number[]>([
      [POTTERY, [POTTER, CARRIER]],
      [SCHOOL, []],
      [MASON_HUT, [OWN_TRADE, CARRIER]],
    ]);
    const menu: BuildingTrades = (typeId) => trades.get(typeId);
    const job = (typeId: number) => ({ kind: 'job', typeId }) as const;
    const house = (typeId: number) => ({ kind: 'house', typeId }) as const;
    expect(
      pictureOfUnlocks([job(POTTER), house(SCHOOL), house(MASON_HUT), house(POTTERY)], OWN_TRADE, menu),
    ).toBe(POTTERY);
    expect(pictureOfUnlocks([house(SCHOOL), house(MASON_HUT)], OWN_TRADE, menu)).toBe(MASON_HUT);
    expect(pictureOfUnlocks([house(CART_SITE), house(SCHOOL), house(MASON_HUT)], undefined, menu)).toBe(
      SCHOOL,
    );
    expect(pictureOfUnlocks([job(POTTER), house(CART_SITE)], OWN_TRADE, menu)).toBeUndefined();

    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: LOCAL, kind: 'person' },
    ]);
    const discovered = (entity: number, technology: 'job' | 'good' | 'house', typeId: number): SimEvent => ({
      kind: 'technologyDiscovered',
      entity: e(entity),
      player: LOCAL,
      tribe: 1,
      technology,
      typeId,
    });
    const out = messagesFromEvents(
      [
        discovered(1, 'job', POTTER),
        discovered(1, 'house', SCHOOL),
        discovered(1, 'house', POTTERY),
        discovered(2, 'house', CART_SITE),
      ],
      snap,
      [],
      LOCAL,
      naming,
      menu,
      new FightAreas(),
    );
    // The pictured building leads the list its card names; a note opening only a cart site keeps its
    // settler.
    expect(out.map((r) => [r.pending.subject?.entity, r.pending.technologies, r.pending.building])).toEqual([
      [1, [job(POTTER)], undefined],
      [1, [house(POTTERY), house(SCHOOL)], POTTERY],
      [2, [house(CART_SITE)], undefined],
    ]);
  });

  it('leaves out what no catalog names, and a note with nothing named left', () => {
    const UNNAMED = 99;
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: LOCAL, kind: 'person' },
    ]);
    const partial: MessageNaming = {
      ...naming,
      technology: (kind, typeId) => (typeId === UNNAMED ? undefined : `${kind}:${typeId}`),
    };
    const discovered = (entity: number, technology: 'job' | 'house', typeId: number): SimEvent => ({
      kind: 'technologyDiscovered',
      entity: e(entity),
      player: LOCAL,
      tribe: 1,
      technology,
      typeId,
    });
    const out = messagesFromEvents(
      [
        discovered(1, 'job', 8),
        discovered(1, 'job', UNNAMED),
        discovered(1, 'house', UNNAMED),
        { kind: 'settlerTrained', entity: e(2), course: 'school', target: 'job', typeId: UNNAMED },
        { kind: 'settlerTrained', entity: e(2), course: 'school', target: 'good', typeId: UNNAMED },
      ],
      snap,
      [],
      LOCAL,
      partial,
      NO_MENU,
      new FightAreas(),
    );
    expect(out.map((r) => [r.pending.type, r.pending.technologies, r.compose().full])).toEqual([
      [
        USER_MESSAGE_TYPE.experienceUnlocks,
        [{ kind: 'job', typeId: 8 }],
        `S1:${USER_MESSAGE_TYPE.experienceUnlocks}:job:8||`,
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
      text: (type, parts) =>
        parts.training === undefined
          ? plain(`${parts.subjectName ?? '?'}:${type}:${parts.goodName ?? '-'}`)
          : naming.text(type, parts),
    };
    const raised = messagesFromEvents(
      [
        { kind: 'settlerTrained', entity: e(1), course: 'barracks', target: 'job', typeId: 31 },
        { kind: 'settlerTrained', entity: e(1), course: 'school', target: 'good', typeId: 9 },
        { kind: 'settlerTrained', entity: e(2), course: 'school', target: 'job', typeId: 31 },
        { kind: 'settlerTrained', entity: e(3), course: 'school', target: 'job', typeId: 12 },
      ],
      snap,
      [],
      LOCAL,
      trainedNaming,
      NO_MENU,
      new FightAreas(),
    );
    expect(raised.map((r) => ({ ...r.pending, text: r.compose().full }))).toEqual([
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

  it('never tells a seat of its own defeat, which its defeat panel reports', () => {
    const snap = snapshot(50, [{ id: 1, player: LOCAL, kind: 'person' }]);
    expect(run([{ kind: 'playerDefeated', player: LOCAL }], snap)).toEqual([]);
  });

  it('announces an eliminated seat to everyone else, naming the player rather than an entity', () => {
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

  it("notes this seat's settler that found nowhere to pray, once, as the original's wants-to-pray note", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: ENEMY, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'prayerSiteMissing', entity: e(1) },
        { kind: 'prayerSiteMissing', entity: e(1) },
        { kind: 'prayerSiteMissing', entity: e(2) },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject?.entity])).toEqual([[USER_MESSAGE_TYPE.wantsToPray, 1]]);
  });

  it("notes this seat's workshop worker that found nowhere for its vehicle site, by reason", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'person' },
      { id: 2, player: ENEMY, kind: 'person' },
      { id: 3, player: LOCAL, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'vehicleSiteRefused', entity: e(1), reason: 'notFound' },
        { kind: 'vehicleSiteRefused', entity: e(2), reason: 'notFound' },
        { kind: 'vehicleSiteRefused', entity: e(3), reason: 'occupied' },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject?.entity])).toEqual([
      [USER_MESSAGE_TYPE.vehicleSiteNotFound, 1],
      [USER_MESSAGE_TYPE.vehicleSiteOccupied, 3],
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

  it("notes this seat's refused vehicle orders by reason, keyed on and centred at the vehicle", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'vehicle', col: 5 },
      { id: 2, player: ENEMY, kind: 'vehicle' },
    ]);
    const out = run(
      [
        { kind: 'vehicleMoveRefused', entity: e(1), player: LOCAL, reason: 'noAnimal' },
        { kind: 'vehicleMoveRefused', entity: e(1), player: LOCAL, reason: 'noCommander' },
        { kind: 'vehicleMoveRefused', entity: e(1), player: LOCAL, reason: 'noPath' },
        { kind: 'vehicleMoveRefused', entity: e(1), player: LOCAL, reason: 'noPath' },
        { kind: 'vehicleMoveRefused', entity: e(2), player: ENEMY, reason: 'noPath' },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject, m.at, m.text])).toEqual([
      [
        USER_MESSAGE_TYPE.vehicleNoAnimal,
        { kind: 'vehicle', entity: e(1) },
        { hx: 10, hy: 4 },
        `Wóz:${USER_MESSAGE_TYPE.vehicleNoAnimal}`,
      ],
      [
        USER_MESSAGE_TYPE.vehicleNoCommander,
        { kind: 'vehicle', entity: e(1) },
        { hx: 10, hy: 4 },
        `Wóz:${USER_MESSAGE_TYPE.vehicleNoCommander}`,
      ],
      [
        USER_MESSAGE_TYPE.vehicleNoPath,
        { kind: 'vehicle', entity: e(1) },
        { hx: 10, hy: 4 },
        `Wóz:${USER_MESSAGE_TYPE.vehicleNoPath}`,
      ],
    ]);
  });

  it("notes this seat's refused crew orders about the vehicle and the refused rider orders about the settler", () => {
    const snap = snapshot(50, [
      { id: 1, player: LOCAL, kind: 'vehicle', col: 5 },
      { id: 2, player: LOCAL, kind: 'person' },
      { id: 3, player: ENEMY, kind: 'person' },
    ]);
    const out = run(
      [
        { kind: 'vehicleCrewRefused', entity: e(1), player: LOCAL, reason: 'noRoom' },
        { kind: 'vehicleCrewRefused', entity: e(1), player: LOCAL, reason: 'cannotAttach' },
        { kind: 'vehicleCrewRefused', entity: e(1), player: LOCAL, reason: 'cannotNearShip' },
        { kind: 'vehicleCrewRefused', entity: e(1), player: LOCAL, reason: 'cannotLeave' },
        { kind: 'riderRefused', entity: e(2), player: LOCAL, reason: 'cannotEnter' },
        { kind: 'riderRefused', entity: e(2), player: LOCAL, reason: 'cannotLeave' },
        { kind: 'riderRefused', entity: e(3), player: ENEMY, reason: 'cannotLeave' },
      ],
      snap,
    );
    expect(out.map((m) => [m.type, m.subject])).toEqual([
      [USER_MESSAGE_TYPE.vehicleNoPassengerRoom, { kind: 'vehicle', entity: e(1) }],
      [USER_MESSAGE_TYPE.cannotAttachVehicle, { kind: 'vehicle', entity: e(1) }],
      [USER_MESSAGE_TYPE.vehicleCannotNearShip, { kind: 'vehicle', entity: e(1) }],
      [USER_MESSAGE_TYPE.cannotLeaveVehicle, { kind: 'vehicle', entity: e(1) }],
      [USER_MESSAGE_TYPE.cannotEnterVehicle, { kind: 'settler', entity: e(2) }],
      [USER_MESSAGE_TYPE.cannotLeaveVehicle, { kind: 'settler', entity: e(2) }],
    ]);
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

  it('announces nothing when a script takes a house down its chain', () => {
    const snap = snapshot(50, [{ id: 1, player: LOCAL, kind: 'building' }]);
    expect(run([{ kind: 'buildingUpgraded', entity: e(1), level: 0, lowered: true }], snap)).toEqual([]);
  });

  it('lists a vehicle build site among the vehicles of an unlock, not the buildings', () => {
    const CART_SITE = 42;
    const SCHOOL = 38;
    const sections: string[] = [];
    const listing: MessageNaming = {
      ...naming,
      text: (type, parts) => {
        const t = parts.technologySections;
        if (t !== undefined) sections.push(`${t.houses.join(',')}|${t.vehicles.join(',')}`);
        return plain(String(type));
      },
    };
    const discovered = (typeId: number): SimEvent => ({
      kind: 'technologyDiscovered',
      entity: e(1),
      player: LOCAL,
      tribe: 1,
      technology: 'house',
      typeId,
    });
    const snap = snapshot(50, [{ id: 1, player: LOCAL, kind: 'person' }]);
    const raised = messagesFromEvents(
      [discovered(SCHOOL), discovered(CART_SITE)],
      snap,
      [],
      LOCAL,
      listing,
      NO_MENU,
      new FightAreas(),
      (typeId) => typeId === CART_SITE,
    );
    for (const r of raised) r.compose();
    expect(sections).toEqual([`house:${SCHOOL}|house:${CART_SITE}`]);
  });

  describe('a school course that discovers what it taught', () => {
    const taught = (typeId: number): SimEvent => ({
      kind: 'settlerTrained',
      entity: e(1),
      course: 'school',
      target: 'job',
      typeId,
    });
    const found = (technology: 'job' | 'good', typeId: number): SimEvent => ({
      kind: 'technologyDiscovered',
      entity: e(1),
      player: LOCAL,
      tribe: 1,
      technology,
      typeId,
    });
    const snap = snapshot(50, [{ id: 1, player: LOCAL, kind: 'person' }]);
    const types = (events: SimEvent[]) => run(events, snap).map((m) => m.type);

    it('keeps the course note alone when the discovery is the lesson alone', () => {
      expect(courseNoteKeeps({ kind: 'job', typeId: 12 }, [{ kind: 'job', typeId: 12 }])).toBe('course');
      expect(types([taught(12), found('job', 12)])).toEqual([USER_MESSAGE_TYPE.canDoNewJob]);
    });

    it('keeps the unlock note alone when it lists more than the lesson', () => {
      expect(types([taught(12), found('job', 12), found('good', 26)])).toEqual([
        USER_MESSAGE_TYPE.experienceUnlocks,
      ]);
    });

    it('keeps both when the batch did not discover the lesson', () => {
      expect(types([taught(12), found('good', 26)])).toEqual([
        USER_MESSAGE_TYPE.canDoNewJob,
        USER_MESSAGE_TYPE.experienceUnlocks,
      ]);
    });
  });
});
