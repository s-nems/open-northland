import { ONE, type WorkStatus, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_POTTER, JOB_SOLDIER } from '../src/catalog/jobs.js';
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
const WORKSHOP = 10;
const OPERATOR = 11;
const SWEEPS_TO_GRACE = PRODUCTION_STALL_GRACE_TICKS / SNAPSHOT_SWEEP_INTERVAL_TICKS;

const WAITING_FOR_CLAY: WorkStatus = {
  kind: 'waitingInput',
  goodType: POT,
  missingInputs: [{ goodType: CLAY, required: 1, available: 0, missing: 1, outOfReach: false }],
};
const SHELVES_FULL: WorkStatus = {
  kind: 'outputFull',
  outputs: [{ goodType: POT, required: 1, available: 4, capacity: 4 }],
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
}

function world(tick: number, w: World = {}): WorldSnapshot {
  const operatorJob = w.operatorJob === undefined ? JOB_POTTER : w.operatorJob;
  return {
    tick,
    events: [],
    entities: [
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
              },
            },
          ]),
    ],
  };
}

function seamAnswering(answer: () => WorkStatus | undefined): WorkshopSeam {
  return { types: [POTTERY], workStatus: answer };
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

function stallNote(goodType: number | null, reason: 'missingInput' | 'outputFull'): UserMessage {
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
    expect(stallOf(WAITING_FOR_CLAY)).toEqual({ reason: 'missingInput', goodType: CLAY });
    expect(
      stallOf({
        kind: 'waitingInput',
        goodType: POT,
        missingInputs: [
          { goodType: 5, required: 1, available: 0, missing: 1, outOfReach: false },
          { goodType: CLAY, required: 1, available: 0, missing: 1, outOfReach: true },
        ],
      }),
    ).toEqual({ reason: 'inputOutOfReach', goodType: CLAY });
    expect(stallOf(SHELVES_FULL)).toEqual({ reason: 'outputFull', goodType: POT });
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

  it('raises one note per workshop once it has run no cycle for the grace period', () => {
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => WAITING_FOR_CLAY),
    );
    const notes = sweepTo(source, SWEEPS_TO_GRACE);
    expect(notes.slice(0, -1).flat()).toEqual([]);
    expect(notes.at(-1)).toEqual([
      `Garncarnia:${USER_MESSAGE_TYPE.productionStalled}:missingInput:good:${CLAY}`,
    ]);
  });

  it('judges only a landed answer: the first unanswered read asks, the next one rules out a stall', () => {
    let answer: WorkStatus | undefined;
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => answer),
    );
    sweepTo(source, SWEEPS_TO_GRACE);
    expect(source.stalls?.verdict(WORKSHOP)).toBeUndefined();
    sweepTo(source, SWEEPS_TO_GRACE + 1, {}, SWEEPS_TO_GRACE + 1);
    expect(source.stalls?.verdict(WORKSHOP)).toBeNull();
    answer = SHELVES_FULL;
    expect(sweepTo(source, SWEEPS_TO_GRACE + 2, {}, SWEEPS_TO_GRACE + 2).flat()).toEqual([
      `Garncarnia:${USER_MESSAGE_TYPE.productionStalled}:outputFull:good:${POT}`,
    ]);
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

  it('retires the note when production resumes or the reason changes, not before the sweep judges', () => {
    let answer: WorkStatus = WAITING_FOR_CLAY;
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => answer),
    );
    const retirement = new NoteRetirement(new FightAreas(), source.stalls);
    const note = stallNote(CLAY, 'missingInput');
    const tick = SWEEPS_TO_GRACE * SNAPSHOT_SWEEP_INTERVAL_TICKS;
    // A fresh source has not judged the workshop: a note restored from an earlier mount stands.
    source.sweep(world(0), naming);
    expect(retirement.isOver(note, world(0))).toBe(false);
    sweepTo(source, SWEEPS_TO_GRACE, {}, 1);
    expect(retirement.isOver(note, world(tick))).toBe(false);
    expect(retirement.isOver(note, world(tick, { producing: true }))).toBe(true);
    answer = SHELVES_FULL;
    sweepTo(source, SWEEPS_TO_GRACE + 1, {}, SWEEPS_TO_GRACE + 1);
    expect(retirement.isOver(note, world(tick))).toBe(true);
  });

  it('keeps the note through another good of the same reason, and rewords it rather than raising anew', () => {
    let answer: WorkStatus = WAITING_FOR_CLAY;
    const source = createSnapshotMessageSource(
      LOCAL,
      seamAnswering(() => answer),
    );
    const retirement = new NoteRetirement(new FightAreas(), source.stalls);
    const tick = (SWEEPS_TO_GRACE + 1) * SNAPSHOT_SWEEP_INTERVAL_TICKS;
    sweepTo(source, SWEEPS_TO_GRACE);
    answer = {
      kind: 'waitingInput',
      goodType: POT,
      missingInputs: [{ goodType: OTHER_INPUT, required: 1, available: 0, missing: 1, outOfReach: false }],
    };
    const raised = source
      .sweep(world(tick), naming)
      .filter((r) => r.pending.type === USER_MESSAGE_TYPE.productionStalled);
    expect(raised.map((r) => [r.pending.stall, r.updatesStanding])).toEqual([
      [{ reason: 'missingInput', goodType: OTHER_INPUT }, true],
    ]);
    expect(retirement.isOver(stallNote(CLAY, 'missingInput'), world(tick))).toBe(false);
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
    expect(retirement.isOver(stallNote(CLAY, 'missingInput'), world(tick, { yard: true }))).toBe(true);
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
