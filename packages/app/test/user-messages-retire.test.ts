import {
  ONE,
  components as simComponents,
  systems,
  type WorkStatus,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_CIVILIST, JOB_SOLDIER, JOB_WOMAN } from '../src/catalog/jobs.js';
import { createMessageFeed, type MessageFeed, takeRaised } from '../src/hud/tool-panel/messages/feed.js';
import { FightAreas } from '../src/hud/tool-panel/messages/fight-areas.js';
import {
  createSnapshotMessageSource,
  DYING_NOTE_RETIRE_MARGIN_PER_MILLE,
  IDLE_SWEEPS_BEFORE_MESSAGE,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
} from '../src/hud/tool-panel/messages/from-snapshot.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import { LOST_NOTE_HOLD_TICKS, NoteRetirement } from '../src/hud/tool-panel/messages/retire.js';
import {
  USER_MESSAGE_TYPE,
  type UserMessage,
  type UserMessageType,
} from '../src/hud/tool-panel/messages/types.js';
import { WORK_STATUS_REASK_SWEEPS } from '../src/hud/tool-panel/messages/work-asks.js';

const RAISED = 100;
const HELD = RAISED + LOST_NOTE_HOLD_TICKS - 1;
const RELEASED = RAISED + LOST_NOTE_HOLD_TICKS;
const SETTLER = 7;
const HOME = 30;
const TRAINING_HOUSE = 31;
const PER_MILLE = 1000;

/** One fresh retirement per question: every rule but the no-path watch reads the snapshot alone. */
function isNoteOver(m: UserMessage, snapshot: WorldSnapshot): boolean {
  return new NoteRetirement(new FightAreas()).isOver(m, snapshot);
}

function world(tick: number, settler: 'lost' | 'found' | 'gone'): WorldSnapshot {
  if (settler === 'gone') return { tick, events: [], entities: [] };
  const components = settler === 'lost' ? { LostWay: { cutOff: false, since: 0, goal: null } } : {};
  return { tick, events: [], entities: [{ id: SETTLER, components }] };
}

function needsWorld(
  needs: { hunger?: number; fatigue?: number; piety?: number },
  enabled = true,
  ordered: string | null = null,
): WorldSnapshot {
  return {
    tick: RELEASED,
    events: [],
    entities: [
      {
        id: SETTLER,
        components: {
          Settler: {
            tribe: 1,
            jobType: 1,
            experience: { $map: [] },
          },
          SettlerNeeds: {
            hunger: needs.hunger ?? 0,
            fatigue: needs.fatigue ?? 0,
            piety: needs.piety ?? 0,
            enjoyment: 0,
            asOf: 0,
            drain: 'none',
          },
          ...(ordered === null ? {} : { NeedOrder: { need: ordered } }),
        },
      },
      ...(enabled ? [] : [{ id: 8, components: { WorldRules: { needsEnabled: false } } }]),
    ],
  };
}

/** The planner's marker for a settler its drive ladder found no work for. */
const IDLE_STAND = { IdleStand: { standing: true } };

function idleWorld(
  state: 'idle-at-workplace' | 'idle-without-workplace' | 'chat-walk' | 'walking' | 'working' | 'has-flag',
): WorldSnapshot {
  const workplace = state === 'idle-at-workplace' ? 8 : undefined;
  return {
    tick: RELEASED,
    events: [],
    entities: [
      {
        id: SETTLER,
        components: {
          ...(workplace === undefined ? {} : { JobAssignment: { workplace } }),
          ...(state === 'idle-at-workplace' || state === 'idle-without-workplace' || state === 'has-flag'
            ? IDLE_STAND
            : {}),
          ...(state === 'walking' || state === 'chat-walk' ? { MoveGoal: { cell: 12 } } : {}),
          ...(state === 'chat-walk'
            ? { Chat: { partner: 7, seeker: true, talking: false, speaks: true, kind: 'pastime' } }
            : {}),
          ...(state === 'working'
            ? { CurrentAtomic: { atomicId: 1, effect: { kind: 'produce', recipeOutput: 3 } } }
            : {}),
          ...(state === 'has-flag' ? { WorkFlag: { flag: 9 } } : {}),
        },
      },
      ...(workplace === undefined ? [] : [{ id: workplace, components: {} }]),
    ],
  };
}

/** A world holding only the note's subject, with the components the case under test reads. */
function subjectWorld(components: Record<string, unknown>): WorldSnapshot {
  return { tick: RELEASED, events: [], entities: [{ id: SETTLER, components }] };
}

function note(
  type: UserMessageType,
  subject: UserMessage['subject'] = { kind: 'settler', entity: SETTLER },
): UserMessage {
  return {
    id: 1,
    type,
    subject,
    at: null,
    about: null,
    goodType: null,
    technologies: null,
    jobType: null,
    priority: 2,
    tick: RAISED,
    text: { short: 'x', full: 'x' },
  };
}

describe('note retirement', () => {
  it('ends any note whose subject left the world, and none without a subject', () => {
    expect(isNoteOver(note(USER_MESSAGE_TYPE.hungry), world(RELEASED, 'gone'))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.lostWithoutSignposts), world(RELEASED, 'gone'))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.humanDied, null), world(RELEASED, 'gone'))).toBe(false);
  });

  it('leaves an event note to its lifetime whether or not its settler is lost', () => {
    expect(isNoteOver(note(USER_MESSAGE_TYPE.canDoNewJob), world(RELEASED, 'lost'))).toBe(false);
  });

  it('ends a grown-up note once a grown man takes up or is sent to learn a trade, or a grown woman has a home', () => {
    const grown = (jobType: number, extra: Record<string, unknown> = {}) =>
      subjectWorld({ Settler: { tribe: 1, jobType }, ...extra });
    const female = { Female: {} };
    expect(isNoteOver(note(USER_MESSAGE_TYPE.grewUp), grown(JOB_CIVILIST))).toBe(false);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.grewUp), grown(JOB_CARRIER))).toBe(true);
    const sentToTrain = { TrainingOrder: { house: TRAINING_HOUSE, drillTicksLeft: 0 } };
    expect(isNoteOver(note(USER_MESSAGE_TYPE.grewUp), grown(JOB_CIVILIST, sentToTrain))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.grewUp), grown(JOB_WOMAN, female))).toBe(false);
    expect(
      isNoteOver(note(USER_MESSAGE_TYPE.grewUp), grown(JOB_WOMAN, { ...female, Residence: { home: HOME } })),
    ).toBe(true);
  });

  it('ends hunger notes as soon as eating answers their condition', () => {
    expect(
      isNoteOver(note(USER_MESSAGE_TYPE.hungry), needsWorld({ hunger: systems.NEED_CRITICAL_THRESHOLD - 1 })),
    ).toBe(true);
    expect(
      isNoteOver(note(USER_MESSAGE_TYPE.hungry), needsWorld({ hunger: systems.NEED_CRITICAL_THRESHOLD })),
    ).toBe(false);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.starving), needsWorld({ hunger: ONE - 1 }))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.starving), needsWorld({ hunger: ONE }))).toBe(false);
  });

  it('ends tired and prayer notes when the corresponding need is answered', () => {
    const answered = systems.NEED_CRITICAL_THRESHOLD - 1;
    expect(isNoteOver(note(USER_MESSAGE_TYPE.tired), needsWorld({ fatigue: answered }))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.wantsToPray), needsWorld({ piety: answered }))).toBe(true);
  });

  it('keeps a prayer note at the level the sim warns from, the one the HUD marks a need at', () => {
    const marked = systems.NEED_CRITICAL_THRESHOLD;
    expect(isNoteOver(note(USER_MESSAGE_TYPE.wantsToPray), needsWorld({ piety: marked }))).toBe(false);
  });

  it('keeps the prayer note of an ordered prayer with nowhere to go while the order stands', () => {
    const calm = { piety: 0 };
    expect(isNoteOver(note(USER_MESSAGE_TYPE.wantsToPray), needsWorld(calm, true, 'piety'))).toBe(false);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.wantsToPray), needsWorld(calm, true, 'hunger'))).toBe(true);
  });

  it('ends need notes when needs are disabled or the settler no longer carries them', () => {
    expect(isNoteOver(note(USER_MESSAGE_TYPE.hungry), needsWorld({ hunger: ONE }, false))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.hungry), world(RELEASED, 'found'))).toBe(true);
  });

  it('ends nothing-to-do when the settler starts an activity or no longer has that workplace', () => {
    const idle = note(USER_MESSAGE_TYPE.nothingToDo);
    expect(isNoteOver(idle, idleWorld('idle-at-workplace'))).toBe(false);
    expect(isNoteOver(idle, idleWorld('working'))).toBe(true);
    expect(isNoteOver(idle, idleWorld('idle-without-workplace'))).toBe(true);
  });

  it('ends workplace-not-found when the settler acts or receives a workplace substitute', () => {
    const missing = note(USER_MESSAGE_TYPE.workplaceNotFound);
    expect(isNoteOver(missing, idleWorld('idle-without-workplace'))).toBe(false);
    expect(isNoteOver(missing, idleWorld('working'))).toBe(true);
    expect(isNoteOver(missing, idleWorld('idle-at-workplace'))).toBe(true);
    expect(isNoteOver(missing, idleWorld('has-flag'))).toBe(true);
  });

  it('keeps a lost note while the sim keeps the settler marked lost', () => {
    const lost = note(USER_MESSAGE_TYPE.lostWithoutSignposts);
    expect(isNoteOver(lost, world(RELEASED, 'lost'))).toBe(false);
    expect(isNoteOver(lost, world(RELEASED + 10_000, 'lost'))).toBe(false);
  });

  it('ends a lost note once the marker comes off, but not inside the hold', () => {
    const lost = note(USER_MESSAGE_TYPE.lostWithoutSignposts);
    expect(isNoteOver(lost, world(HELD, 'found'))).toBe(false);
    expect(isNoteOver(lost, world(RELEASED, 'found'))).toBe(true);
  });

  it('ends a held child order note once the order runs again, is gone or waits on another reason', () => {
    const order = (childOrder: Record<string, unknown> | null): WorldSnapshot =>
      subjectWorld(childOrder === null ? {} : { ChildOrder: { child: 'male', ...childOrder } });
    const held: UserMessage = { ...note(USER_MESSAGE_TYPE.familyBlocked), familyWait: 'husbandAway' };
    expect(isNoteOver(held, order({ blocked: 'husbandAway' }))).toBe(false);
    expect(isNoteOver(held, order({ blocked: 'livesApart' }))).toBe(true);
    expect(isNoteOver(held, order({ foodSearchMissed: true }))).toBe(true);
    expect(isNoteOver(held, order({}))).toBe(true);
    expect(isNoteOver(held, order(null))).toBe(true);
  });

  it('keeps an idle note through idle chatter walking to its partner, and ends it on any other walk or a held post', () => {
    const idle = note(USER_MESSAGE_TYPE.workplaceNotFound);
    expect(isNoteOver(idle, idleWorld('chat-walk'))).toBe(false);
    expect(isNoteOver(idle, idleWorld('walking'))).toBe(true);
    const guard = subjectWorld({
      ...IDLE_STAND,
      Stance: { mode: systems.MILITARY_MODE.DEFEND, anchorCell: null },
    });
    expect(isNoteOver(idle, guard)).toBe(true);
  });

  it('ends a near-death note only once the settler heals a margin past the line it was raised on', () => {
    const MAX = systems.HUMAN_HITPOINTS;
    const dying = note(USER_MESSAGE_TYPE.willDie);
    const health = (hitpoints: number): WorldSnapshot => subjectWorld({ Health: { hitpoints, max: MAX } });
    let line = 1;
    while (systems.isNearDeath(line + 1, MAX)) line++;
    const margin = (MAX * DYING_NOTE_RETIRE_MARGIN_PER_MILLE) / PER_MILLE;
    expect(isNoteOver(dying, health(1))).toBe(false);
    // Regeneration ticking across the raise line between blows keeps the card.
    expect(isNoteOver(dying, health(line + 1))).toBe(false);
    expect(isNoteOver(dying, health(line + margin))).toBe(false);
    expect(isNoteOver(dying, health(line + margin + 1))).toBe(true);
    expect(isNoteOver(dying, health(MAX))).toBe(true);
  });

  it('ends a no-one-to-marry note once the settler is married', () => {
    const single = note(USER_MESSAGE_TYPE.noOneToMarry);
    expect(isNoteOver(single, subjectWorld({}))).toBe(false);
    expect(isNoteOver(single, subjectWorld({ Marriage: { spouse: SETTLER + 1, child: null } }))).toBe(true);
  });

  it('ends the vehicle notes once a commander boards or the animal is harnessed', () => {
    const vehicle = { kind: 'vehicle', entity: SETTLER } as const;
    const crewed = (commander: number | null): WorldSnapshot =>
      subjectWorld({ Vehicle: { passengers: [null, commander === null ? null : { entity: commander }] } });
    expect(isNoteOver(note(USER_MESSAGE_TYPE.vehicleNoCommander, vehicle), crewed(null))).toBe(false);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.vehicleNoCommander, vehicle), crewed(SETTLER + 1))).toBe(true);
    const cart = (harnessed: boolean): WorldSnapshot => subjectWorld({ Vehicle: { harnessed } });
    expect(isNoteOver(note(USER_MESSAGE_TYPE.vehicleNoAnimal, vehicle), cart(false))).toBe(false);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.vehicleNoAnimal, vehicle), cart(true))).toBe(true);
  });

  it('ends a no-carrier note once a carrier or a commander boards, not for any other rider', () => {
    const vehicle = { kind: 'vehicle', entity: SETTLER } as const;
    const RIDER = SETTLER + 1;
    const aboard = (slots: readonly (number | null)[], riderJob: number): WorldSnapshot => ({
      tick: RELEASED,
      events: [],
      entities: [
        {
          id: SETTLER,
          components: {
            Vehicle: { passengers: slots.map((entity) => (entity === null ? null : { entity })) },
          },
        },
        { id: RIDER, components: { Settler: { tribe: 1, jobType: riderJob } } },
      ],
    });
    const noCarrier = note(USER_MESSAGE_TYPE.vehicleNoCarrier, vehicle);
    expect(isNoteOver(noCarrier, aboard([null, null], JOB_CARRIER))).toBe(false);
    expect(isNoteOver(noCarrier, aboard([RIDER, null], JOB_SOLDIER))).toBe(false);
    expect(isNoteOver(noCarrier, aboard([RIDER, null], JOB_CARRIER))).toBe(true);
    expect(isNoteOver(noCarrier, aboard([null, RIDER], JOB_SOLDIER))).toBe(true);
  });

  it('ends a no-path note on a drive that starts after the vehicle stood, not the one under way', () => {
    const vehicle = { kind: 'vehicle', entity: SETTLER } as const;
    const noPath = note(USER_MESSAGE_TYPE.vehicleNoPath, vehicle);
    const cart = (driving: boolean): WorldSnapshot =>
      subjectWorld({ Vehicle: { passengers: [] }, ...(driving ? { VehicleDrive: { step: 0 } } : {}) });
    const retirement = new NoteRetirement(new FightAreas());
    const pass = (driving: boolean): boolean => {
      const over = retirement.isOver(noPath, cart(driving));
      retirement.endPass();
      return over;
    };
    // A redirect refused mid-drive: the old drive runs on, then the cart stands, then drives again.
    expect(pass(true)).toBe(false);
    expect(pass(true)).toBe(false);
    expect(pass(false)).toBe(false);
    expect(pass(true)).toBe(true);
    // A note no pass looks at any more is forgotten, so its id starts over.
    retirement.endPass();
    expect(pass(true)).toBe(false);
  });

  it('ends a no-cart note once the trader rides or its route falls short', () => {
    const fullRoute = Array.from({ length: simComponents.TRADE_ROUTE_HOUSES }, (_, i) => ({ house: i + 1 }));
    const trader = (extra: Record<string, unknown>): WorldSnapshot =>
      subjectWorld({ TradeRoute: { stops: fullRoute }, ...IDLE_STAND, ...extra });
    const noCart = note(USER_MESSAGE_TYPE.noVehicleForWork);
    expect(isNoteOver(noCart, trader({}))).toBe(false);
    expect(isNoteOver(noCart, trader({ Rider: { vehicle: SETTLER + 1 } }))).toBe(true);
    expect(isNoteOver(noCart, subjectWorld({ TradeRoute: { stops: [] }, ...IDLE_STAND }))).toBe(true);
  });

  it('keeps a vehicle site note while the workshop holds its refused search, and ends it after', () => {
    const WORKSHOP = SETTLER + 1;
    const yard = (refusals: boolean): WorldSnapshot => ({
      tick: RELEASED,
      events: [],
      entities: [
        { id: SETTLER, components: { JobAssignment: { workplace: WORKSHOP } } },
        {
          id: WORKSHOP,
          components: refusals
            ? { VehicleYardRefusals: { entries: [{ houseType: 42, until: RELEASED }] } }
            : {},
        },
      ],
    });
    for (const type of [USER_MESSAGE_TYPE.vehicleSiteNotFound, USER_MESSAGE_TYPE.vehicleSiteOccupied]) {
      expect(isNoteOver(note(type), yard(true))).toBe(false);
      expect(isNoteOver(note(type), yard(false))).toBe(true);
    }
  });
});

describe('a store carrier idle at an empty pickup flag', () => {
  const LOCAL = 0;
  const STORE = SETTLER + 1;
  const FLAG = SETTLER + 2;
  const HAUL_FLAG_RADIUS = 32;
  const STORE_TYPE = 12;
  const naming: MessageNaming = {
    settler: (e) => ({ name: `S${e.id}`, jobLabel: null, female: false }),
    building: () => 'Magazyn',
    vehicle: () => 'Wóz',
    player: () => 'Gracz',
    stance: (state) => state,
    paper: (paper) => `${paper.kind}:${paper.param}`,
    technology: (kind, typeId) => `${kind}:${typeId}`,
    text: (type) => ({ short: String(type), full: String(type) }),
  };

  function porterWorld(tick: number, flagged: boolean): WorldSnapshot {
    const owned = { Owner: { player: LOCAL }, Position: { x: 3 * ONE, y: 2 * ONE } };
    return {
      tick,
      events: [],
      entities: [
        {
          id: SETTLER,
          components: {
            ...owned,
            Settler: { tribe: 1, jobType: JOB_CARRIER },
            Person: { person: true },
            JobAssignment: { workplace: STORE },
            ...IDLE_STAND,
            ...(flagged ? { HaulFlag: { flag: FLAG, radius: HAUL_FLAG_RADIUS } } : {}),
          },
        },
        { id: STORE, components: { ...owned, Building: { buildingType: STORE_TYPE, tribe: 1, built: ONE } } },
      ],
    };
  }

  /** The message centre's raise, feed and retire order over idle sweeps, the sim naming an empty flag,
   *  run with the flag up until the card is due. */
  function flaggedUntilNoted(): { feed: MessageFeed; sweep(i: number, flagged: boolean): void } {
    const source = createSnapshotMessageSource(LOCAL, {
      types: [],
      workStatus: (_entity, asked) => ({ status: { kind: 'nothingAtFlag' }, asked }),
    });
    const retirement = new NoteRetirement(new FightAreas(), source.stalls);
    const feed = createMessageFeed();
    const sweep = (i: number, flagged: boolean): void => {
      const snapshot = porterWorld(i * SNAPSHOT_SWEEP_INTERVAL_TICKS, flagged);
      for (const raised of source.sweep(snapshot, naming)) takeRaised(feed, raised, snapshot.tick);
      feed.expire(snapshot.tick, (m) => retirement.isOver(m, snapshot));
      retirement.endPass();
    };
    for (let i = 1; i <= IDLE_SWEEPS_BEFORE_MESSAGE; i++) sweep(i, true);
    return { feed, sweep };
  }

  it('gets the empty-flag card, which goes once the player takes the flag away', () => {
    const { feed, sweep } = flaggedUntilNoted();
    expect(feed.live().map((m) => [m.type, m.idle?.kind])).toEqual([
      [USER_MESSAGE_TYPE.nothingToDo, 'nothingAtFlag'],
    ]);
    sweep(IDLE_SWEEPS_BEFORE_MESSAGE + 1, false);
    expect(feed.live()).toEqual([]);
  });

  it('forgets a dismissed empty-flag card once the flag is gone', () => {
    const { feed, sweep } = flaggedUntilNoted();
    const [card] = feed.live();
    if (card === undefined) throw new Error('no card');
    feed.remove(card.id, card.tick);
    expect(feed.dismissed(card)).toBe(true);
    sweep(IDLE_SWEEPS_BEFORE_MESSAGE + 1, false);
    expect(feed.dismissed(card)).toBe(false);
    expect(feed.state().history).toEqual([]);
  });
});

describe('a field worker whose trade finds nothing to work', () => {
  const LOCAL = 0;
  const STORE = SETTLER + 1;
  const FLAG = SETTLER + 2;
  const STORE_TYPE = 12;
  const naming: MessageNaming = {
    settler: (e) => ({ name: `S${e.id}`, jobLabel: null, female: false }),
    building: () => 'Magazyn',
    vehicle: () => 'Wóz',
    player: () => 'Gracz',
    stance: (state) => state,
    paper: (paper) => `${paper.kind}:${paper.param}`,
    technology: (kind, typeId) => `${kind}:${typeId}`,
    text: (type) => ({ short: String(type), full: String(type) }),
  };

  function workerWorld(tick: number, post: 'store' | 'flag'): WorldSnapshot {
    const owned = { Owner: { player: LOCAL }, Position: { x: 3 * ONE, y: 2 * ONE } };
    return {
      tick,
      events: [],
      entities: [
        {
          id: SETTLER,
          components: {
            ...owned,
            Settler: { tribe: 1, jobType: JOB_CIVILIST },
            Person: { person: true },
            ...(post === 'store' ? { JobAssignment: { workplace: STORE } } : { WorkFlag: { flag: FLAG } }),
            ...IDLE_STAND,
          },
        },
        { id: STORE, components: { ...owned, Building: { buildingType: STORE_TYPE, tribe: 1, built: ONE } } },
      ],
    };
  }

  /** The message centre's raise, feed and retire order over idle sweeps, the sim answering `status`. */
  function watch(post: 'store' | 'flag') {
    const sim = { status: { kind: 'noGame' } as WorkStatus };
    const source = createSnapshotMessageSource(LOCAL, {
      types: [],
      workStatus: (_entity, asked) => ({ status: sim.status, asked }),
    });
    const retirement = new NoteRetirement(
      new FightAreas(),
      source.stalls,
      source.shortages,
      source.idleReasons,
    );
    const feed = createMessageFeed();
    let i = 0;
    const sweeps = (n: number): [UserMessageType, string | undefined][] => {
      for (let end = i + n; i < end; ) {
        const snapshot = workerWorld(++i * SNAPSHOT_SWEEP_INTERVAL_TICKS, post);
        for (const raised of source.sweep(snapshot, naming)) takeRaised(feed, raised, snapshot.tick);
        feed.expire(snapshot.tick, (m) => retirement.isOver(m, snapshot));
        retirement.endPass();
      }
      return feed.live().map((m) => [m.type, m.idle?.kind]);
    };
    return { sim, sweeps };
  }

  it('gets the shortage note at its post, handed over to nothing-to-do and back as the reason moves', () => {
    const { sim, sweeps } = watch('store');
    expect(sweeps(IDLE_SWEEPS_BEFORE_MESSAGE)).toEqual([[USER_MESSAGE_TYPE.cannotFindGood, 'noGame']]);
    sim.status = { kind: 'nothingSelected' };
    expect(sweeps(WORK_STATUS_REASK_SWEEPS)).toEqual([[USER_MESSAGE_TYPE.nothingToDo, 'nothingSelected']]);
    sim.status = { kind: 'noFish' };
    expect(sweeps(WORK_STATUS_REASK_SWEEPS)).toEqual([[USER_MESSAGE_TYPE.cannotFindGood, 'noFish']]);
  });

  it('speaks at its own flag only for a shortage, and goes quiet when the reason does', () => {
    const { sim, sweeps } = watch('flag');
    expect(sweeps(IDLE_SWEEPS_BEFORE_MESSAGE)).toEqual([[USER_MESSAGE_TYPE.cannotFindGood, 'noGame']]);
    sim.status = { kind: 'nothingSelected' };
    expect(sweeps(WORK_STATUS_REASK_SWEEPS)).toEqual([]);
  });
});
