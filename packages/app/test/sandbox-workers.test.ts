import { describe, expect, it } from 'vitest';
import { BUILDING_JOINERY, JOB_CARRIER, WORKER_SLOT_JOB_BASE } from '../src/game/sandbox/ids.js';
import { assignmentPriority, sandboxContent, workerRoleOf } from '../src/game/sandbox/index.js';
import { professionLabel } from '../src/i18n/index.js';

/**
 * The sandbox buildings must carry their worker + carrier capacity (extracted from ir.json's
 * `logicworker`), or `assignWorker` has no open slot to bind to and every right-click no-ops. Homes
 * employ nobody. Every worker-slot jobType must resolve as a content job (the cross-reference gate).
 */
describe('sandbox building worker slots', () => {
  const content = sandboxContent();
  const byType = new Map(content.buildings.map((b) => [b.typeId, b]));
  const jobIds = new Set(content.jobs.map((j) => j.typeId));

  it('gives a workshop worker + carrier slots (the smithy employs both)', () => {
    const smithy = byType.get(31); // work_smithy_00
    expect((smithy?.workers.length ?? 0) > 0).toBe(true);
    expect(smithy?.workers.some((w) => w.jobType === JOB_CARRIER)).toBe(true);
    expect(smithy?.workers.some((w) => w.jobType !== JOB_CARRIER)).toBe(true);
  });

  it('gives different capacities to different buildings (a well is carrier-only, a farm has 4 field hands)', () => {
    const cap = (typeId: number): number => byType.get(typeId)?.workers.reduce((s, w) => s + w.count, 0) ?? 0;
    expect(cap(10)).toBe(1); // well: one carrier
    expect(cap(12)).toBe(5); // farm: 4 workers + 1 carrier
    expect(cap(1)).toBe(12); // headquarters: 3 carriers + 9 hands
  });

  it('leaves residences employing nobody', () => {
    for (const typeId of [2, 3, 4, 5, 6]) expect(byType.get(typeId)?.workers.length ?? 0).toBe(0);
  });

  it('resolves every worker-slot jobType as a content job (no dangling cross-reference)', () => {
    for (const b of content.buildings) {
      for (const w of b.workers) expect(jobIds.has(w.jobType)).toBe(true);
    }
  });

  it('rebases every extracted slot job clear of the native sandbox bands — the id-collision guard', () => {
    // The original `logicworker` ids overlap the sandbox's own bands (22 = mud gatherer, 40/41 = archers,
    // 24 = carrier), so before the rebase an HQ slot silently read as a native gatherer/soldier. Every
    // extracted slot must now be the carrier or a rebased id (>= the base) — never a raw native-band id.
    for (const b of content.buildings) {
      if (b.typeId === BUILDING_JOINERY) continue; // its demo worker is a DELIBERATE native gatherer (below)
      for (const w of b.workers)
        expect(w.jobType === JOB_CARRIER || w.jobType >= WORKER_SLOT_JOB_BASE).toBe(true);
    }
    // The HQ dispatches gatherers (collector/fisher/hunter) and carriers — 9 gatherers + 3 carriers, no
    // in-workshop craftsman. The player can only hand-assign its carriers (a gatherer is never a PPM target).
    const hq = byType.get(1)?.workers ?? [];
    const headcount = (role: string): number =>
      hq.filter((w) => workerRoleOf(w.jobType) === role).reduce((sum, w) => sum + w.count, 0);
    expect(headcount('carrier')).toBe(3);
    expect(headcount('gatherer')).toBe(9);
    expect(headcount('craftsman')).toBe(0);
  });

  it('keeps the joinery demo worker a gatherer (its plank production is fed by a woodcutter)', () => {
    const joinery = byType.get(BUILDING_JOINERY);
    expect(joinery?.workers.some((w) => workerRoleOf(w.jobType) === 'gatherer')).toBe(true);
  });

  it('names each extracted craftsman by its real trade, from the SAME i18n label the picker uses', () => {
    const firstCraftName = (typeId: number): string | undefined => {
      const slot = byType.get(typeId)?.workers.find((w) => workerRoleOf(w.jobType) === 'craftsman');
      return content.jobs.find((j) => j.typeId === slot?.jobType)?.name;
    };
    expect(firstCraftName(31)).toBe('Kowal'); // smithy → smith (original job 13)
    expect(firstCraftName(35)).toBe('Druid'); // druid hut → druid (original job 30)
    // Drift guard: the slot label must be the SAME word the profession picker shows (they were once
    // transcribed twice and diverged — a joiner read "Cieśla" as a slot but "Stolarz" in the picker).
    expect(firstCraftName(31)).toBe(professionLabel('smith'));
    expect(firstCraftName(24)).toBe(professionLabel('joiner')); // work_joinery_01 → joiner (original job 9)
  });

  it('offers the Druid first on a right-click of the druid hut, and never the collector-gatherer', () => {
    // The reported bug: right-clicking the druid hut made a Zbieracz (collector) first. The collector is a
    // gatherer role, so it must be excluded from the priority, and the Druid craft leads it.
    const priority = assignmentPriority(byType.get(35)?.workers);
    expect(priority.every((jobType) => workerRoleOf(jobType) !== 'gatherer')).toBe(true);
    expect(content.jobs.find((j) => j.typeId === priority[0])?.name).toBe('Druid');
  });
});
