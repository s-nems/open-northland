import { type GatheringTrade, ONE, type WorkStatus, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_COLLECTOR, JOB_POTTER, JOB_SOLDIER } from '../src/catalog/jobs.js';
import { createMessageFeed, takeRaised } from '../src/hud/tool-panel/messages/feed.js';
import { FightAreas } from '../src/hud/tool-panel/messages/fight-areas.js';
import {
  createSnapshotMessageSource,
  IDLE_SWEEPS_BEFORE_MESSAGE,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
  type SnapshotMessageSource,
} from '../src/hud/tool-panel/messages/from-snapshot.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import { NoteRetirement } from '../src/hud/tool-panel/messages/retire.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE, type UserMessage } from '../src/hud/tool-panel/messages/types.js';
import { WORK_STATUS_REASK_SWEEPS, type WorkAnswer } from '../src/hud/tool-panel/messages/work-asks.js';
import {
  PRODUCTION_STALL_GRACE_TICKS,
  stallOf,
  type WorkshopSeam,
} from '../src/hud/tool-panel/messages/workshop-stalls.js';

const LOCAL = 0;
const RIVAL = 1;
const POTTERY = 20;
const HOME = 2;
const CLAY = 2;
const POT = 24;
const OTHER_INPUT = 3;
const WOOD = 5;
const WORKSHOP = 10;
const OPERATOR = 11;
/** The workshop's own collector, hired before the potter. */
const COLLECTOR = 9;
const SWEEPS_TO_GRACE = PRODUCTION_STALL_GRACE_TICKS / SNAPSHOT_SWEEP_INTERVAL_TICKS;

const WAITING_FOR_CLAY: WorkStatus = {
  kind: 'waitingInput',
  goodType: POT,
  missingInputs: [
    { goodType: CLAY, required: 1, available: 0, missing: 1, source: 'none', gatheredBy: null },
  ],
};
const SHELVES_FULL: WorkStatus = {
  kind: 'outputFull',
  outputs: [{ goodType: POT, required: 1, available: 4, capacity: 4, destination: 'none' }],
};

const plain = (full: string): MessageText => ({ short: full, full });
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null, female: false }),
  building: () => 'Garncarnia',
  vehicle: () => 'Wóz',
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type, parts) => plain(`${parts.subjectName}:${type}:${parts.stall}:${parts.goodName}`),
};

interface World {
  readonly producing?: boolean;
  readonly owner?: number;
  readonly buildingType?: number;
  /** The operator's trade; null leaves the workshop unstaffed. */
  readonly operatorJob?: number | null;
  /** The operator crews the workshop's vehicle yard site. */
  readonly yard?: boolean;
  /** The operator carries a load, as one taking a product to a store does. */
  readonly carrying?: boolean;
  /** The operator walks out on a supply errand for the workshop. */
  readonly fetching?: boolean;
  /** The workshop's own collector, standing idle or taking up a harvest. */
  readonly collector?: 'idle' | 'harvesting';
}

function world(tick: number, w: World = {}): WorldSnapshot {
  const operatorJob = w.operatorJob === undefined ? JOB_POTTER : w.operatorJob;
  return {
    tick,
    events: [],
    entities: [
      ...(w.collector === undefined
        ? []
        : [
            {
              id: COLLECTOR,
              components: {
                Owner: { player: w.owner ?? LOCAL },
                Position: { x: 9 * ONE, y: 2 * ONE },
                Settler: { tribe: 1, jobType: JOB_COLLECTOR },
                Person: { person: true },
                JobAssignment: { workplace: WORKSHOP },
                ...(w.collector === 'idle'
                  ? { IdleStand: { standing: true } }
                  : { HarvestFocus: { node: 97 }, CurrentAtomic: { atomicId: 24 } }),
              },
            },
          ]),
      {
        id: WORKSHOP,
        components: {
          Owner: { player: w.owner ?? LOCAL },
          Position: { x: 5 * ONE, y: 5 * ONE },
          Building: { buildingType: w.buildingType ?? POTTERY, tribe: 1, built: ONE, level: 0 },
          ...(w.producing === true
            ? { Production: { cycles: [{ elapsed: 1, duration: 180, goodType: POT }] } }
            : {}),
        },
      },
      ...(operatorJob === null
        ? []
        : [
            {
              id: OPERATOR,
              components: {
                Owner: { player: w.owner ?? LOCAL },
                Position: { x: 3 * ONE, y: 2 * ONE },
                Settler: { tribe: 1, jobType: operatorJob },
                Person: { person: true },
                Stance: { mode: 0, anchorCell: null },
                JobAssignment: { workplace: WORKSHOP },
                ...(w.yard === true ? { SiteAssignment: { site: 99, pinned: false } } : {}),
                ...(w.carrying === true || w.fetching === true ? {} : { IdleStand: { standing: true } }),
                ...(w.carrying === true ? { Carrying: { goodType: POT, amount: 1 } } : {}),
                ...(w.fetching === true
                  ? {
                      SupplyRun: { site: WORKSHOP, goodType: CLAY, amount: 1, source: 98 },
                      MoveGoal: { cell: 5 },
                    }
                  : {}),
              },
            },
          ]),
    ],
  };
}

/** A seam whose every ask lands at once with `answer`'s diagnosis. */
function seamAnswering(answer: () => WorkStatus | undefined): WorkshopSeam {
  return { types: [POTTERY], workStatus: (_entity, asked) => ({ status: answer(), asked }) };
}

/** Sweep once per interval up to and including sweep `count`; the stall notes each sweep raised. */
function sweepTo(source: SnapshotMessageSource, count: number, w: World = {}, from = 0): string[][] {
  const out: string[][] = [];
  for (let i = from; i <= count; i++) {
    const raised = source.sweep(world(i * SNAPSHOT_SWEEP_INTERVAL_TICKS, w), naming);
    out.push(
      raised
        .filter((r) => r.pending.type === USER_MESSAGE_TYPE.productionStalled)
        .map((r) => r.compose().full),
    );
  }
  return out;
}

function stallNote(goodType: number | null, reason: 'noInputSource' | 'noOutputStore'): UserMessage {
  return {
    id: 1,
    type: USER_MESSAGE_TYPE.productionStalled,
    subject: { kind: 'building', entity: WORKSHOP },
    at: null,
    about: null,
    goodType,
    technologies: null,
    jobType: null,
    stall: { reason, goodType },
    priority: 1,
    tick: 0,
    text: { short: 'x', full: 'x' },
  };
}

describe('stalled workshops', () => {
  it('reads the reason and its good off the diagnosis, and no stall off a deliberate stop', () => {
    expect(stallOf(WAITING_FOR_CLAY)).toEqual({ reason: 'noInputSource', goodType: CLAY });
    // An input only a trade gathers points at that trade, not at a workshop to build.
    const unsourcedWood = { goodType: WOOD, required: 1, available: 0, missing: 1, source: 'none' } as const;
    const unsourcedBy = (gatheredBy: GatheringTrade) =>
      stallOf({ kind: 'waitingInput', goodType: POT, missingInputs: [{ ...unsourcedWood, gatheredBy }] });
    expect(unsourcedBy('collector')).toEqual({ reason: 'noCollector', goodType: WOOD });
    expect(unsourcedBy('hunter')).toEqual({ reason: 'noHunter', goodType: WOOD });
    expect(unsourcedBy('fisher')).toEqual({ reason: 'noFisher', goodType: WOOD });
    expect(
      stallOf({
        kind: 'waitingInput',
        goodType: POT,
        missingInputs: [
          { goodType: 5, required: 1, available: 0, missing: 1, source: 'inReach', gatheredBy: null },
          { goodType: CLAY, required: 1, available: 0, missing: 1, source: 'outOfReach', gatheredBy: null },
        ],
      }),
    ).toEqual({ reason: 'inputOutOfReach', goodType: CLAY });
    expect(stallOf(SHELVES_FULL)).toEqual({ reason: 'noOutputStore', goodType: POT });
    expect(stallOf({ kind: 'noOutputDestination', goodType: POT, reason: 'noStorage' })).toEqual({
      reason: 'noOutputStore',
      goodType: POT,
    });
    expect(stallOf({ kind: 'noOutputDestination', goodType: POT, reason: 'outOfReach' })).toEqual({
      reason: 'outputOutOfReach',
      goodType: POT,
    });
    expect(stallOf({ kind: 'productsLocked', goodTypes: [POT] })).toEqual({
      reason: 'productsLocked',
      goodType: POT,
    });
    expect(stallOf({ kind: 'nothingSelected' })).toBeNull();
    expect(stallOf({ kind: 'crafting', goodType: POT })).toBeNull();
  });

  it('names no stall for an input a source in reach supplies, nor for shelves a store in reach empties', () => {
    const clay = { goodType: CLAY, required: 1, available: 0, missing: 1 };
    const pots = { goodType: POT, required: 1, available: 4, capacity: 4 };
    expect(
      stallOf({
        kind: 'waitingInput',
        goodType: POT,
        missingInputs: [{ ...clay, source: 'inReach', gatheredBy: null }],
      }),
    ).toBeNull();
    expect(stallOf({ kind: 'outputFull', outputs: [{ ...pots, destination: 'inReach' }] })).toBeNull();
    expect(
      stallOf({
        kind: 'outputFull',
        outputs: [
          { ...pots, destination: 'none' },
          { ...pots, goodType: OTHER_INPUT, destination: 'inReach' },
        ],
      }),
    ).toBeNull();
  });

  it('raises one note per workshop once it has stood for the grace period', () => {
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => WAITING_FOR_CLAY),
    );
    const notes = sweepTo(source, SWEEPS_TO_GRACE);
    expect(notes.slice(0, -1).flat()).toEqual([]);
    expect(notes.at(-1)).toEqual([
      `Garncarnia:${USER_MESSAGE_TYPE.productionStalled}:noInputSource:good:${CLAY}`,
    ]);
  });

  it('judges only a landed answer, and a diagnosis with nothing in the way as no stall', () => {
    let landed: WorkAnswer | undefined;
    const asks: number[] = [];
    const source = createSnapshotMessageSource(LOCAL, {
      types: [POTTERY],
      workStatus: (_entity, asked) => {
        if (!asks.includes(asked)) asks.push(asked);
        return landed;
      },
    });
    sweepTo(source, SWEEPS_TO_GRACE + 1);
    expect(source.stalls?.verdict(WORKSHOP)).toBeUndefined();
    const [firstAsk] = asks;
    landed = { status: undefined, asked: firstAsk ?? -1 };
    sweepTo(source, SWEEPS_TO_GRACE + 2, {}, SWEEPS_TO_GRACE + 2);
    expect(source.stalls?.verdict(WORKSHOP)).toBeNull();
    // An answer to an earlier ask is not taken for the newest one's.
    sweepTo(source, SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS, {}, SWEEPS_TO_GRACE + 3);
    expect(asks).toHaveLength(2);
    landed = { status: SHELVES_FULL, asked: firstAsk ?? -1 };
    const next = SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS + 1;
    expect(sweepTo(source, next, {}, next).flat()).toEqual([]);
    landed = { status: SHELVES_FULL, asked: asks[1] ?? -1 };
    expect(sweepTo(source, next + 1, {}, next + 1).flat()).toEqual([
      `Garncarnia:${USER_MESSAGE_TYPE.productionStalled}:noOutputStore:good:${POT}`,
    ]);
  });

  it('judges the craftsman, never a collector posted there with a lower id', () => {
    const source = createSnapshotMessageSource(LOCAL, {
      types: [POTTERY],
      // The collector's own diagnosis names nothing in the way, so only the craftsman's raises the note.
      workStatus: (entity, at) => ({ status: entity === OPERATOR ? WAITING_FOR_CLAY : undefined, asked: at }),
    });
    const notes = sweepTo(source, SWEEPS_TO_GRACE, { collector: 'idle' });
    expect(notes.at(-1)).toHaveLength(1);
  });

  it('starts the stand over while its own collector takes up a harvest', () => {
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => WAITING_FOR_CLAY),
    );
    expect(sweepTo(source, 2 * SWEEPS_TO_GRACE, { collector: 'harvesting' }).flat()).toEqual([]);
    expect(source.stalls?.verdict(WORKSHOP)).toBeNull();
  });

  it('leaves out a producing workshop, an unstaffed one, a yard crew and another seat', () => {
    for (const w of [
      { producing: true },
      { operatorJob: null },
      { operatorJob: JOB_CARRIER },
      { yard: true },
      { owner: RIVAL },
      { buildingType: HOME },
    ] satisfies World[]) {
      const source = createSnapshotMessageSource(
        LOCAL,
        seamAnswering(() => WAITING_FOR_CLAY),
      );
      expect(sweepTo(source, SWEEPS_TO_GRACE, w).flat(), JSON.stringify(w)).toEqual([]);
    }
  });

  it('holds the operator idle note while its workshop rests, and lets it raise once production runs', () => {
    const nothingToDo = (w: World): boolean => {
      const source = createSnapshotMessageSource(
        LOCAL,
        seamAnswering(() => undefined),
      );
      let raised = false;
      for (let i = 0; i <= IDLE_SWEEPS_BEFORE_MESSAGE; i++) {
        const out = source.sweep(world(i * SNAPSHOT_SWEEP_INTERVAL_TICKS, w), naming);
        raised ||= out.some((r) => r.pending.type === USER_MESSAGE_TYPE.nothingToDo);
      }
      return raised;
    };
    expect(nothingToDo({})).toBe(false);
    expect(nothingToDo({ producing: true })).toBe(true);
  });

  it('lets an idle collector of a resting workshop name its own blocker until a stall stands', () => {
    const NO_TREES: WorkStatus = { kind: 'noEligibleResource', goodTypes: [WOOD], scope: 'workArea' };
    /** A collector whose search still finds work, as one pausing on a full shelf does. */
    const PAUSED: WorkStatus = { kind: 'unknown', reason: 'gatherSearch' };
    const WOOD_IN_REACH: WorkStatus = {
      kind: 'waitingInput',
      goodType: POT,
      missingInputs: [
        { goodType: WOOD, required: 1, available: 0, missing: 1, source: 'inReach', gatheredBy: 'collector' },
      ],
    };
    const watch = (operator: WorkStatus, collector: WorkStatus) => {
      const source = createSnapshotMessageSource(LOCAL, {
        types: [POTTERY],
        workStatus: (entity, asked) => ({ status: entity === COLLECTOR ? collector : operator, asked }),
      });
      const notes = (to: number, from = 0): number => {
        let raised = 0;
        for (let i = from; i <= to; i++) {
          const out = source.sweep(world(i * SNAPSHOT_SWEEP_INTERVAL_TICKS, { collector: 'idle' }), naming);
          raised += out.filter(
            (r) =>
              r.pending.type === USER_MESSAGE_TYPE.nothingToDo && r.pending.subject?.entity === COLLECTOR,
          ).length;
        }
        return raised;
      };
      return { source, notes };
    };
    const noTrees = watch(WOOD_IN_REACH, NO_TREES);
    expect(noTrees.notes(SWEEPS_TO_GRACE + 2)).toBeGreaterThan(0);
    expect(noTrees.source.stalls?.verdict(WORKSHOP)).toBeNull();
    expect(watch(WOOD_IN_REACH, PAUSED).notes(SWEEPS_TO_GRACE + 2)).toBe(0);
    // Once a stall stands, its note speaks for the collector, whose own note retires.
    const stalled = watch(WAITING_FOR_CLAY, NO_TREES);
    expect(stalled.notes(IDLE_SWEEPS_BEFORE_MESSAGE)).toBeGreaterThan(0);
    expect(stalled.notes(SWEEPS_TO_GRACE + 2, SWEEPS_TO_GRACE)).toBe(0);
    const retirement = new NoteRetirement(new FightAreas(), stalled.source.stalls);
    const { stall: _stall, ...note } = stallNote(null, 'noInputSource');
    const idleNote: UserMessage = {
      ...note,
      type: USER_MESSAGE_TYPE.nothingToDo,
      subject: { kind: 'settler', entity: COLLECTOR },
    };
    const tick = (SWEEPS_TO_GRACE + 2) * SNAPSHOT_SWEEP_INTERVAL_TICKS;
    expect(retirement.isOver(idleNote, world(tick, { collector: 'idle' }))).toBe(true);
  });

  it('retires the note when production resumes or the reason changes, not before the sweep judges', () => {
    let answer: WorkStatus = WAITING_FOR_CLAY;
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => answer),
    );
    const retirement = new NoteRetirement(new FightAreas(), source.stalls);
    const note = stallNote(CLAY, 'noInputSource');
    const tick = SWEEPS_TO_GRACE * SNAPSHOT_SWEEP_INTERVAL_TICKS;
    // A fresh source has not judged the workshop: a note restored from an earlier mount stands.
    source.sweep(world(0), naming);
    expect(retirement.isOver(note, world(0))).toBe(false);
    sweepTo(source, SWEEPS_TO_GRACE, {}, 1);
    expect(retirement.isOver(note, world(tick))).toBe(false);
    expect(retirement.isOver(note, world(tick, { producing: true }))).toBe(true);
    // A changed diagnosis is read at the next ask.
    answer = SHELVES_FULL;
    sweepTo(source, SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS, {}, SWEEPS_TO_GRACE + 1);
    expect(retirement.isOver(note, world(tick))).toBe(true);
  });

  it('keeps the note through another good of the same reason, and rewords it rather than raising anew', () => {
    let answer: WorkStatus = WAITING_FOR_CLAY;
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => answer),
    );
    const retirement = new NoteRetirement(new FightAreas(), source.stalls);
    const tick = (SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS) * SNAPSHOT_SWEEP_INTERVAL_TICKS;
    sweepTo(source, SWEEPS_TO_GRACE + WORK_STATUS_REASK_SWEEPS - 1);
    answer = {
      kind: 'waitingInput',
      goodType: POT,
      missingInputs: [
        { goodType: OTHER_INPUT, required: 1, available: 0, missing: 1, source: 'none', gatheredBy: null },
      ],
    };
    const raised = source
      .sweep(world(tick), naming)
      .filter((r) => r.pending.type === USER_MESSAGE_TYPE.productionStalled);
    expect(raised.map((r) => [r.pending.stall, r.updatesStanding])).toEqual([
      [{ reason: 'noInputSource', goodType: OTHER_INPUT }, true],
    ]);
    expect(retirement.isOver(stallNote(CLAY, 'noInputSource'), world(tick))).toBe(false);
  });

  it('raises a dismissed stall anew under a new reason, but keeps it dismissed through a new good', () => {
    let answer: WorkStatus = WAITING_FOR_CLAY;
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => answer),
    );
    const retirement = new NoteRetirement(new FightAreas(), source.stalls);
    const feed = createMessageFeed();
    let sweeps = 0;
    // The message centre's order: the sweep raises, the feed takes, then the stale notes retire.
    const present = (): void => {
      const tick = ++sweeps * SNAPSHOT_SWEEP_INTERVAL_TICKS;
      const snapshot = world(tick);
      for (const raised of source.sweep(snapshot, naming, (pending) => feed.dismissed(pending))) {
        takeRaised(feed, raised, tick);
      }
      feed.expire(tick, (m) => retirement.isOver(m, snapshot));
      retirement.endPass();
    };
    const presentUntilAsked = (): void => {
      for (let i = 0; i < WORK_STATUS_REASK_SWEEPS; i++) present();
    };
    const stallsShown = () => feed.live().map((m) => m.stall);
    while (feed.live().length === 0) present();
    expect(stallsShown()).toEqual([{ reason: 'noInputSource', goodType: CLAY }]);
    feed.remove(feed.live()[0]?.id ?? -1, sweeps * SNAPSHOT_SWEEP_INTERVAL_TICKS);

    answer = {
      kind: 'waitingInput',
      goodType: POT,
      missingInputs: [
        { goodType: OTHER_INPUT, required: 1, available: 0, missing: 1, source: 'none', gatheredBy: null },
      ],
    };
    presentUntilAsked();
    expect(stallsShown()).toEqual([]);
    expect(feed.state().history.map((m) => m.stall)).toEqual([
      { reason: 'noInputSource', goodType: OTHER_INPUT },
    ]);

    answer = SHELVES_FULL;
    presentUntilAsked();
    expect(stallsShown()).toEqual([{ reason: 'noOutputStore', goodType: POT }]);
    expect(feed.state().history).toEqual([]);
  });

  it('starts the stand over while goods move for the workshop, retiring a standing note', () => {
    for (const moving of [{ carrying: true }, { fetching: true }] satisfies World[]) {
      const source = createSnapshotMessageSource(
        LOCAL,
        seamAnswering(() => WAITING_FOR_CLAY),
      );
      const retirement = new NoteRetirement(new FightAreas(), source.stalls);
      expect(sweepTo(source, SWEEPS_TO_GRACE).at(-1)).toHaveLength(1);
      const tick = (SWEEPS_TO_GRACE + 1) * SNAPSHOT_SWEEP_INTERVAL_TICKS;
      const raised = source.sweep(world(tick, moving), naming);
      expect(raised.filter((r) => r.pending.type === USER_MESSAGE_TYPE.productionStalled)).toEqual([]);
      expect(retirement.isOver(stallNote(CLAY, 'noInputSource'), world(tick, moving))).toBe(true);
      const after = sweepTo(source, 2 * SWEEPS_TO_GRACE + 1, {}, SWEEPS_TO_GRACE + 2);
      expect(after.slice(0, -1).flat(), JSON.stringify(moving)).toEqual([]);
      expect(after.at(-1)).toHaveLength(1);
    }
  });

  it('judges a crew building a vehicle on the yard as no stall, so the standing note retires', () => {
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => WAITING_FOR_CLAY),
    );
    const retirement = new NoteRetirement(new FightAreas(), source.stalls);
    sweepTo(source, SWEEPS_TO_GRACE);
    const tick = (SWEEPS_TO_GRACE + 1) * SNAPSHOT_SWEEP_INTERVAL_TICKS;
    source.sweep(world(tick, { yard: true }), naming);
    expect(source.stalls?.verdict(WORKSHOP)).toBeNull();
    expect(retirement.isOver(stallNote(CLAY, 'noInputSource'), world(tick, { yard: true }))).toBe(true);
  });
});

describe('idle notes about soldiers', () => {
  /** The notes a settler of `job` raises over the sweeps after it lost the post it held. */
  function afterLosingPost(job: number): number[] {
    const source = createSnapshotMessageSource(LOCAL);
    const unposted = (tick: number): WorldSnapshot => {
      const snap = world(tick, { operatorJob: job, buildingType: HOME });
      return {
        ...snap,
        entities: snap.entities.map((e) => {
          if (e.id !== OPERATOR) return e;
          const { JobAssignment: _post, ...rest } = e.components;
          return { ...e, components: rest };
        }),
      };
    };
    source.sweep(world(0, { operatorJob: job, buildingType: HOME }), naming);
    const raised: number[] = [];
    for (let i = 1; i <= IDLE_SWEEPS_BEFORE_MESSAGE + 1; i++) {
      for (const r of source.sweep(unposted(i * SNAPSHOT_SWEEP_INTERVAL_TICKS), naming)) {
        raised.push(r.pending.type);
      }
    }
    return raised;
  }

  it('tells of a craftsman that lost its post, never of a soldier', () => {
    expect(afterLosingPost(JOB_POTTER)).toContain(USER_MESSAGE_TYPE.workplaceNotFound);
    expect(afterLosingPost(JOB_SOLDIER)).toEqual([]);
  });
});
