import { describe, expect, it } from 'vitest';
import { JOB_CARRIER, JOB_COLLECTOR, rebaseSlotJob } from '../src/game/sandbox/ids/index.js';
import { assignmentPriority, assignmentPriorityFor, workerRoleOf } from '../src/game/sandbox/worker-roles.js';

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

  it('never keeps a gatherer current trade — a collector on a workshop that has a collector slot still gets the craft', () => {
    // A real pottery offers collector + potter + carrier. A settler who is already a collector must NOT be
    // re-bound to that gatherer slot (the "never hand-assign a gatherer" rule), so the current-trade
    // promotion is skipped and the default order (potter → carrier) stands. This also removes the
    // sandbox↔real divergence: a gatherer is never promoted whichever id space its slots come in.
    const POTTERY_SLOTS = [
      { jobType: REAL_JOB.collector, count: 1 },
      { jobType: REAL_JOB.potter, count: 1 },
      { jobType: REAL_JOB.carrier, count: 1 },
    ];
    expect(assignmentPriorityFor(REAL_JOB.collector, POTTERY_SLOTS)).toEqual([
      REAL_JOB.potter,
      REAL_JOB.carrier,
    ]);
    // And a hunter right-clicking the warehouse still becomes a carrier, not kept a hunter.
    expect(assignmentPriorityFor(REAL_JOB.hunter, WAREHOUSE_SLOTS)).toEqual([REAL_JOB.carrier]);
  });
});
