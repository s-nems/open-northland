import { BUILDING_KIND } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { rebaseSlotJob } from '../src/game/sandbox/ids/index.js';
import {
  assignmentPriority,
  assignmentPriorityFor,
  trainsRatherThanEmploys,
  workerRoleOf,
} from '../src/game/sandbox/worker-roles.js';

/**
 * The right-click worker-role classification over REAL extracted content (the browser scene/map path),
 * whose building worker slots carry the raw `jobtypes.ini` job ids — NOT the sandbox-rebased ids the
 * headless twin uses. This is the path that regressed once interactive views started running on real
 * content: a warehouse's raw hunter(15)/fisher(22) slots were misclassified as craftsmen and offered
 * ahead of the carrier, so a right-click made a settler a hunter instead of a Tragarz.
 */

// Raw jobtypes.ini ids as they appear in the extracted `ir.json` building worker slots (real content).
// The app names only the two shared trades (collector/carrier); the un-rebased craft/gather ids have no
// app constant, so pin them here with their source.
const REAL_JOB = {
  carrier: JOB_CARRIER, // 24
  collector: JOB_COLLECTOR, // 8
  hunter: 15,
  fisher: 22,
  farmer: 18,
  miller: 19,
  potter: 11, // an in-house craftsman (jobtypes.ini)
} as const;

// Real ir.json worker slots, verbatim shapes (stock_00 / work_mill_00 / work_farm_00).
const WAREHOUSE_SLOTS = [
  { jobType: REAL_JOB.carrier, count: 3 },
  { jobType: REAL_JOB.collector, count: 3 },
  { jobType: REAL_JOB.fisher, count: 3 },
  { jobType: REAL_JOB.hunter, count: 3 },
];
const MILL_SLOTS = [
  { jobType: REAL_JOB.miller, count: 2 },
  { jobType: REAL_JOB.carrier, count: 1 },
];
const FARM_SLOTS = [
  { jobType: REAL_JOB.farmer, count: 4 },
  { jobType: REAL_JOB.carrier, count: 1 },
];

describe('workerRoleOf classifies the raw real trades', () => {
  it('recognizes the outdoor gatherers by their raw ids (not only the rebased sandbox ids)', () => {
    expect(workerRoleOf(REAL_JOB.collector)).toBe('gatherer');
    expect(workerRoleOf(REAL_JOB.hunter)).toBe('gatherer');
    expect(workerRoleOf(REAL_JOB.fisher)).toBe('gatherer');
  });

  it('keeps the carrier a carrier and an in-workshop trade a craftsman', () => {
    expect(workerRoleOf(REAL_JOB.carrier)).toBe('carrier');
    expect(workerRoleOf(REAL_JOB.miller)).toBe('craftsman');
    expect(workerRoleOf(REAL_JOB.farmer)).toBe('craftsman');
  });
});

describe('classification is independent of the id space (raw real vs sandbox-rebased)', () => {
  // The classifier is one pure function fed slots from either content base, so a trade must
  // classify the same whether it arrives as its raw `jobtypes.ini` id or its sandbox-rebased id — the
  // role is keyed off the de-rebased (canonical) id, not a per-base id table — the fix that removed the
  // dual raw∪rebased gatherer registration.
  it('a trade classifies the same raw and rebased', () => {
    for (const raw of [
      REAL_JOB.collector,
      REAL_JOB.hunter,
      REAL_JOB.fisher,
      REAL_JOB.miller,
      REAL_JOB.farmer,
    ]) {
      expect(workerRoleOf(rebaseSlotJob(raw))).toBe(workerRoleOf(raw));
    }
    // The carrier keeps its own id under the rebase, so it stays a carrier either way.
    expect(workerRoleOf(rebaseSlotJob(REAL_JOB.carrier))).toBe('carrier');
  });

  it('assignmentPriority over rebased slots offers the same trades, in the rebased space', () => {
    const rebasedWarehouse = WAREHOUSE_SLOTS.map((s) => ({ jobType: rebaseSlotJob(s.jobType) }));
    // Only the carrier is offered (gatherers excluded), and it is the rebased carrier id — which equals
    // the raw one, since the rebase leaves the carrier untouched.
    expect(assignmentPriority(rebasedWarehouse)).toEqual([rebaseSlotJob(REAL_JOB.carrier)]);
    const rebasedMill = MILL_SLOTS.map((s) => ({ jobType: rebaseSlotJob(s.jobType) }));
    expect(assignmentPriority(rebasedMill)).toEqual([
      rebaseSlotJob(REAL_JOB.miller),
      rebaseSlotJob(REAL_JOB.carrier),
    ]);
  });
});

describe('assignmentPriority over real building slots', () => {
  it('a warehouse offers only its carrier — the gatherer slots are never hand-assigned (the hunter bug)', () => {
    expect(assignmentPriority(WAREHOUSE_SLOTS)).toEqual([REAL_JOB.carrier]);
  });

  it('a mill offers its miller first, the carrier as the fallback', () => {
    expect(assignmentPriority(MILL_SLOTS)).toEqual([REAL_JOB.miller, REAL_JOB.carrier]);
  });
});

describe('assignmentPriorityFor keeps the settler`s current trade', () => {
  it('a plain/idle settler on a warehouse becomes a carrier, not a hunter', () => {
    expect(assignmentPriorityFor(undefined, WAREHOUSE_SLOTS)).toEqual([REAL_JOB.carrier]);
  });

  it('a miller re-assigned to a mill stays a miller (already the top choice)', () => {
    expect(assignmentPriorityFor(REAL_JOB.miller, MILL_SLOTS)).toEqual([REAL_JOB.miller, REAL_JOB.carrier]);
  });

  it('a carrier on a farm stays a carrier — its offered trade is promoted ahead of the farmer', () => {
    expect(assignmentPriorityFor(REAL_JOB.carrier, FARM_SLOTS)).toEqual([REAL_JOB.carrier, REAL_JOB.farmer]);
  });

  it('a current trade the building does not offer leaves the default order untouched', () => {
    // A hunter right-clicking a mill: the mill has no hunter slot, so it falls through to the default.
    expect(assignmentPriorityFor(REAL_JOB.hunter, MILL_SLOTS)).toEqual([REAL_JOB.miller, REAL_JOB.carrier]);
  });

  it('offers a collector the workshop TRADE first, its gatherer slot second', () => {
    // A real pottery offers collector + potter + carrier. Aiming a collector at a workshop means "become
    // its tradesman" in the original, so the potter slot leads; the sim's `needforjob` gate decides
    // whether this collector earned it, and its own gatherer slot is the next fallback (the building
    // becomes its delivery target), with the carrier last.
    const POTTERY_SLOTS = [
      { jobType: REAL_JOB.collector, count: 1 },
      { jobType: REAL_JOB.potter, count: 1 },
      { jobType: REAL_JOB.carrier, count: 1 },
    ];
    expect(assignmentPriorityFor(REAL_JOB.collector, POTTERY_SLOTS)).toEqual([
      REAL_JOB.potter,
      REAL_JOB.collector,
      REAL_JOB.carrier,
    ]);
  });

  it('a hunter right-clicking a warehouse is bound to its gatherer slots, its own slot first', () => {
    // The warehouse offers collector/fisher/hunter gatherer slots + a carrier. A hunter prefers the exact
    // hunter slot, then the other gatherer slots, then the carrier fallback.
    expect(assignmentPriorityFor(REAL_JOB.hunter, WAREHOUSE_SLOTS)).toEqual([
      REAL_JOB.hunter,
      REAL_JOB.collector,
      REAL_JOB.fisher,
      REAL_JOB.carrier,
    ]);
  });

  it('a gatherer on a building with no gatherer slot falls back to the default craft → carrier order', () => {
    // A mill has no gatherer slot, so a collector right-clicking it takes the default order (miller → carrier)
    // rather than staying a gatherer with nowhere to gather-in.
    expect(assignmentPriorityFor(REAL_JOB.collector, MILL_SLOTS)).toEqual([
      REAL_JOB.miller,
      REAL_JOB.carrier,
    ]);
  });

  it('a plain/idle settler is never offered a gatherer slot (only a gatherer current trade is)', () => {
    // Idle on a warehouse still becomes a carrier — the default excludes gatherers for a non-gatherer.
    expect(assignmentPriorityFor(undefined, WAREHOUSE_SLOTS)).toEqual([REAL_JOB.carrier]);
  });
});

describe('trainsRatherThanEmploys — the barracks right-click split', () => {
  // The real ir.json barracks: `kind: training`, carrier slots only.
  const BARRACKS = { kind: BUILDING_KIND.training, workers: [{ jobType: REAL_JOB.carrier, count: 4 }] };

  it('drills every trade the training house does not employ, including a settler with none', () => {
    expect(trainsRatherThanEmploys(BARRACKS, REAL_JOB.collector)).toBe(true);
    expect(trainsRatherThanEmploys(BARRACKS, REAL_JOB.miller)).toBe(true);
    expect(trainsRatherThanEmploys(BARRACKS, undefined)).toBe(true);
  });

  it('leaves a carrier to the post that keeps the barracks stocked', () => {
    expect(trainsRatherThanEmploys(BARRACKS, REAL_JOB.carrier)).toBe(false);
  });

  it('never drills at a building of another kind', () => {
    const mill = { kind: BUILDING_KIND.workplace, workers: MILL_SLOTS };
    expect(trainsRatherThanEmploys(mill, REAL_JOB.collector)).toBe(false);
    expect(trainsRatherThanEmploys(undefined, REAL_JOB.collector)).toBe(false);
  });
});
