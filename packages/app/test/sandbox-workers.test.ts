import { describe, expect, it } from 'vitest';
import { JOB_CARRIER } from '../src/game/sandbox/ids.js';
import { sandboxContent } from '../src/game/sandbox/index.js';

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
});
