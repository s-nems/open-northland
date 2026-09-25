import { ONE, systems, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  createSnapshotMessageSource,
  IDLE_SWEEPS_BEFORE_MESSAGE,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
} from '../src/hud/tool-panel/messages/from-snapshot.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';

const LOCAL = 0;
const ENEMY = 1;
const WORKPLACE = 90;
const SITE = 91;
const WORKER_JOB = 7;
const HEALTH_POOL = systems.HUMAN_HITPOINTS;
/** The original's near-death line on a 5000 pool. */
const NEAR_DEATH = 720;

/** What a synthetic settler is doing, mapped onto the components the source reads. */
type Doing = 'nothing' | 'work' | 'chat' | 'walk' | 'ordered' | 'guard' | 'indoors';

interface Actor {
  readonly id: number;
  readonly player?: number;
  readonly kind?: 'person' | 'child' | 'animal' | 'building' | 'site';
  readonly hunger?: number;
  readonly fatigue?: number;
  readonly piety?: number;
  /** Hitpoints left of the person pool; absent leaves the settler without a Health component. */
  readonly hitpoints?: number;
  readonly workplace?: number;
  /** A gatherer's flag yard, which stands in for a workplace. */
  readonly workFlag?: number;
  readonly doing?: Doing;
  /** A `jobType` of null: the adult nobody plans or feeds. */
  readonly jobless?: boolean;
  /** The sim's `LostWay` marker. */
  readonly lost?: boolean;
  /** A trader's route with this many houses, and whether it rides a vehicle. */
  readonly tradeStops?: number;
  readonly rider?: boolean;
}

function doingComponents(doing: Doing): Record<string, unknown> {
  switch (doing) {
    case 'nothing':
      return {};
    case 'work':
      return { CurrentAtomic: { atomicId: 1, effect: { kind: 'produce', recipeOutput: 3 } } };
    case 'chat':
      return { CurrentAtomic: { atomicId: 14, effect: { kind: 'idle' } } };
    case 'walk':
      return { MoveGoal: { cell: 12 } };
    case 'ordered':
      return { PlayerOrder: { cell: 12 } };
    case 'guard':
      return { Stance: { mode: systems.MILITARY_MODE.DEFEND, anchorCell: null } };
    case 'indoors':
      return { Resting: { until: 5 } };
  }
}

function components(a: Actor): Record<string, unknown> {
  const kind = a.kind ?? 'person';
  if (kind === 'building' || kind === 'site') {
    return {
      Owner: { player: a.player ?? LOCAL },
      Position: { x: 5 * ONE, y: 5 * ONE },
      Building: { buildingType: 12, tribe: 1, built: kind === 'site' ? 0 : ONE, level: 0 },
      ...(kind === 'site' ? { UnderConstruction: { labor: 0 } } : {}),
    };
  }
  return {
    Owner: { player: a.player ?? LOCAL },
    Position: { x: 3 * ONE, y: 2 * ONE },
    Settler: {
      tribe: 1,
      jobType: a.jobless === true ? null : WORKER_JOB,
      hunger: a.hunger ?? 0,
      fatigue: a.fatigue ?? 0,
      piety: a.piety ?? 0,
    },
    Stance: { mode: systems.MILITARY_MODE.NONE, anchorCell: null },
    ...(a.hitpoints === undefined ? {} : { Health: { hitpoints: a.hitpoints, max: HEALTH_POOL } }),
    ...(kind === 'animal' ? {} : { Person: { person: true } }),
    ...(kind === 'child' ? { Age: { ticks: 40 } } : {}),
    ...(a.workplace === undefined ? {} : { JobAssignment: { workplace: a.workplace } }),
    ...(a.workFlag === undefined ? {} : { WorkFlag: { flag: a.workFlag } }),
    ...(a.lost === true ? { LostWay: { cutOff: false } } : {}),
    ...(a.tradeStops === undefined
      ? {}
      : { TradeRoute: { stops: Array.from({ length: a.tradeStops }, (_, house) => ({ house })) } }),
    ...(a.rider === true ? { Rider: { vehicle: 50, boarding: false } } : {}),
    ...doingComponents(a.doing ?? 'nothing'),
  };
}

function snapshot(tick: number, actors: readonly Actor[], needsEnabled = true): WorldSnapshot {
  const entities = [...actors]
    .sort((a, b) => a.id - b.id)
    .map((a) => ({ id: a.id, components: components(a) }));
  if (!needsEnabled) entities.unshift({ id: 0, components: { WorldRules: { needsEnabled: false } } });
  return { tick, events: [], entities };
}

const FLAG = 92;

const plain = (full: string): MessageText => ({ short: full, full });
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null }),
  training: (course, subjectName, jobName) => plain(`${course}:${subjectName}:${jobName}`),
  building: () => 'Dom',
  vehicle: () => 'Wóz',
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type, parts) => plain(`${parts.subjectName ?? '?'}:${type}`),
};

/** One sweep flattened to `[type, subject entity]` pairs. */
function sweep(
  source: ReturnType<typeof createSnapshotMessageSource>,
  snap: WorldSnapshot,
): [number, number | null][] {
  return source.sweep(snap, naming).map((r) => [r.pending.type, r.pending.subject?.entity ?? null]);
}

const belowAlert = systems.NEED_CRITICAL_THRESHOLD - 1;

describe('user messages read off the snapshot', () => {
  it('raises hungry at the bubble threshold, starving on a pinned bar, nothing below', () => {
    const source = createSnapshotMessageSource(LOCAL);
    const out = sweep(
      source,
      snapshot(100, [
        { id: 1, hunger: belowAlert },
        { id: 2, hunger: systems.NEED_CRITICAL_THRESHOLD },
        { id: 3, hunger: ONE },
      ]),
    );
    expect(out).toEqual([
      [USER_MESSAGE_TYPE.hungry, 2],
      [USER_MESSAGE_TYPE.hungry, 3],
      [USER_MESSAGE_TYPE.starving, 3],
    ]);
  });

  it('warns about any settler whose pool has nearly run out, fed or wounded', () => {
    const source = createSnapshotMessageSource(LOCAL);
    const out = sweep(
      source,
      snapshot(100, [
        { id: 1, hunger: ONE, hitpoints: HEALTH_POOL },
        { id: 2, hunger: ONE, hitpoints: NEAR_DEATH },
        { id: 3, hunger: ONE, hitpoints: 0 },
        { id: 4, hitpoints: 1 },
        { id: 5, hitpoints: NEAR_DEATH + 1 },
      ]),
    );
    expect(out).toEqual([
      [USER_MESSAGE_TYPE.hungry, 1],
      [USER_MESSAGE_TYPE.starving, 1],
      [USER_MESSAGE_TYPE.hungry, 2],
      [USER_MESSAGE_TYPE.starving, 2],
      [USER_MESSAGE_TYPE.willDie, 2],
      [USER_MESSAGE_TYPE.hungry, 3],
      [USER_MESSAGE_TYPE.starving, 3],
      [USER_MESSAGE_TYPE.willDie, 4],
    ]);
  });

  it("raises the lost note off the sim's marker, for this seat's people only", () => {
    const source = createSnapshotMessageSource(LOCAL);
    const out = sweep(
      source,
      snapshot(100, [
        { id: 1, lost: true },
        { id: 2, lost: true, player: ENEMY },
        { id: 3, lost: true, kind: 'animal' },
        { id: 4 },
      ]),
    );
    expect(out).toEqual([[USER_MESSAGE_TYPE.lostWithoutSignposts, 1]]);
  });

  it('warns about a wounded settler even where the needs rule is off', () => {
    const source = createSnapshotMessageSource(LOCAL);
    const out = sweep(source, snapshot(100, [{ id: 1, hunger: ONE, hitpoints: 1 }], false));
    expect(out).toEqual([[USER_MESSAGE_TYPE.willDie, 1]]);
  });

  it('raises tired and wants-to-pray from the fatigue and piety bars', () => {
    const source = createSnapshotMessageSource(LOCAL);
    const out = sweep(
      source,
      snapshot(100, [
        { id: 1, fatigue: systems.NEED_CRITICAL_THRESHOLD },
        { id: 2, piety: systems.NEED_CRITICAL_THRESHOLD },
        { id: 3, fatigue: systems.NEED_DRIVE_THRESHOLD },
      ]),
    );
    expect(out).toEqual([
      [USER_MESSAGE_TYPE.tired, 1],
      [USER_MESSAGE_TYPE.wantsToPray, 2],
    ]);
  });

  it("warns about a starving child, but ignores wildlife and other seats' settlers", () => {
    const source = createSnapshotMessageSource(LOCAL);
    const out = sweep(
      source,
      snapshot(100, [
        { id: 1, kind: 'child', hunger: ONE },
        { id: 2, kind: 'animal', hunger: ONE },
        { id: 3, player: ENEMY, hunger: ONE },
        { id: 4, hunger: ONE },
      ]),
    );
    expect(out).toEqual([
      [USER_MESSAGE_TYPE.hungry, 1],
      [USER_MESSAGE_TYPE.starving, 1],
      [USER_MESSAGE_TYPE.hungry, 4],
      [USER_MESSAGE_TYPE.starving, 4],
    ]);
  });

  it('leaves a jobless adult alone, whose pinned bars the sim never acts on', () => {
    const source = createSnapshotMessageSource(LOCAL);
    expect(sweep(source, snapshot(100, [{ id: 1, hunger: ONE, fatigue: ONE, jobless: true }]))).toEqual([]);
  });

  it('skips the needs while the needs rule is off', () => {
    const source = createSnapshotMessageSource(LOCAL);
    expect(sweep(source, snapshot(100, [{ id: 1, hunger: ONE }], false))).toEqual([]);
  });

  it('sweeps once per interval and composes the text only when asked', () => {
    const source = createSnapshotMessageSource(LOCAL);
    const actors: Actor[] = [{ id: 1, hunger: ONE }];
    const first = source.sweep(snapshot(100, actors), naming);
    expect(first.map((r) => r.compose().full)).toEqual([
      `S1:${USER_MESSAGE_TYPE.hungry}`,
      `S1:${USER_MESSAGE_TYPE.starving}`,
    ]);
    expect(sweep(source, snapshot(100 + SNAPSHOT_SWEEP_INTERVAL_TICKS - 1, actors))).toEqual([]);
    expect(sweep(source, snapshot(100 + SNAPSHOT_SWEEP_INTERVAL_TICKS, actors))).toHaveLength(2);
  });

  describe('a worker with nothing to do', () => {
    const building: Actor = { id: WORKPLACE, kind: 'building' };
    const site: Actor = { id: SITE, kind: 'site' };
    /** Sweep `doing` over consecutive intervals and return the types raised at each. */
    const run = (
      source: ReturnType<typeof createSnapshotMessageSource>,
      doings: readonly Doing[],
      from = 0,
    ) =>
      doings.map((doing, i) =>
        sweep(
          source,
          snapshot((from + i + 1) * SNAPSHOT_SWEEP_INTERVAL_TICKS, [
            building,
            site,
            { id: 1, workplace: WORKPLACE, doing },
          ]),
        ).map(([type]) => type),
      );

    it('is reported only once it has idled through enough sweeps', () => {
      const source = createSnapshotMessageSource(LOCAL);
      const idle = Array.from({ length: IDLE_SWEEPS_BEFORE_MESSAGE }, (): Doing => 'nothing');
      const out = run(source, idle);
      expect(out.slice(0, -1).every((types) => types.length === 0)).toBe(true);
      expect(out.at(-1)).toEqual([USER_MESSAGE_TYPE.nothingToDo]);
    });

    it('counts company as idling, holds the count through a walk and resets it on work', () => {
      const source = createSnapshotMessageSource(LOCAL);
      const mostly: Doing[] = Array.from({ length: IDLE_SWEEPS_BEFORE_MESSAGE - 1 }, (): Doing => 'chat');
      expect(run(source, [...mostly, 'walk', 'walk']).flat()).toEqual([]);
      expect(run(source, ['nothing'], mostly.length + 2).flat()).toEqual([USER_MESSAGE_TYPE.nothingToDo]);
      expect(run(source, ['work', ...mostly, 'nothing'], mostly.length + 3).flat()).toEqual([
        USER_MESSAGE_TYPE.nothingToDo,
      ]);
      expect(run(source, ['work', ...mostly], 2 * mostly.length + 5).flat()).toEqual([]);
    });

    it('never for a guard, an ordered unit, one indoors, or one waiting on its site', () => {
      const source = createSnapshotMessageSource(LOCAL);
      const idle = Array.from({ length: IDLE_SWEEPS_BEFORE_MESSAGE }, () => null);
      const actors: Actor[] = [
        building,
        site,
        { id: 1, workplace: WORKPLACE, doing: 'guard' },
        { id: 2, workplace: WORKPLACE, doing: 'ordered' },
        { id: 3, workplace: WORKPLACE, doing: 'indoors' },
        { id: 4, workplace: SITE },
        { id: 6, workplace: WORKPLACE },
      ];
      const out = idle.map((_, i) =>
        sweep(source, snapshot((i + 1) * SNAPSHOT_SWEEP_INTERVAL_TICKS, actors)),
      );
      expect(out.flat()).toEqual([[USER_MESSAGE_TYPE.nothingToDo, 6]]);
    });

    it('has nowhere to work once a post it held is gone, never for a trade that never had one', () => {
      const source = createSnapshotMessageSource(LOCAL);
      const crew: Actor[] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, jobless: true }];
      const atWork = crew.map((a) => ({ ...a, workplace: WORKPLACE, doing: 'work' as Doing }));
      // One sweep with the whole crew at its post, then the workshop is gone from under three of them.
      sweep(
        source,
        snapshot(SNAPSHOT_SWEEP_INTERVAL_TICKS, [building, ...atWork.slice(0, 3), crew[3] as Actor]),
      );
      const after: Actor[] = [
        building,
        { id: 1 },
        { id: 2, workFlag: FLAG },
        { id: 3, workplace: WORKPLACE },
        { id: 4, jobless: true },
      ];
      const out = Array.from({ length: IDLE_SWEEPS_BEFORE_MESSAGE }, (_, i) =>
        sweep(source, snapshot((i + 2) * SNAPSHOT_SWEEP_INTERVAL_TICKS, after)),
      );
      expect(out.flat()).toEqual([
        [USER_MESSAGE_TYPE.workplaceNotFound, 1],
        [USER_MESSAGE_TYPE.nothingToDo, 3],
      ]);
    });

    it('reports a trader with a full route and no cart, never one with a cart or a short route', () => {
      const source = createSnapshotMessageSource(LOCAL);
      const actors: Actor[] = [
        { id: 1, tradeStops: 2 },
        { id: 2, tradeStops: 2, rider: true },
        { id: 3, tradeStops: 1 },
      ];
      const out = Array.from({ length: IDLE_SWEEPS_BEFORE_MESSAGE }, (_, i) =>
        sweep(source, snapshot((i + 1) * SNAPSHOT_SWEEP_INTERVAL_TICKS, actors)),
      );
      expect(out.flat()).toEqual([[USER_MESSAGE_TYPE.noVehicleForWork, 1]]);
    });

    it('starts the idle run over when a post is taken, so a new hire is not reported on arrival', () => {
      const source = createSnapshotMessageSource(LOCAL);
      for (let i = 0; i < IDLE_SWEEPS_BEFORE_MESSAGE; i++) {
        sweep(source, snapshot((i + 1) * SNAPSHOT_SWEEP_INTERVAL_TICKS, [building, { id: 1 }]));
      }
      const hired: Actor[] = [building, { id: 1, workplace: WORKPLACE, doing: 'walk' }];
      const from = IDLE_SWEEPS_BEFORE_MESSAGE + 1;
      expect(sweep(source, snapshot(from * SNAPSHOT_SWEEP_INTERVAL_TICKS, hired))).toEqual([]);
    });
  });
});
