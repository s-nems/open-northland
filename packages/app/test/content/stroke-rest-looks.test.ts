import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR, JOB_FARMER } from '../../src/catalog/jobs.js';
import type { WorldTribes } from '../../src/game/world-tribes.js';
import { characterTablesUnderTest, hasRealIr } from './helpers.js';

/**
 * The short idle slots a gathering stroke's rest is drawn from resolve to their own clips on the REAL
 * decoded content: the wait ladder's records are each an action of their own, so the rest draws the
 * civilization's fidget rather than freezing on the wait loop's first frame.
 */

/** The `TRIBE_TYPE_HUMAN_*` civilizations, viking leading as the base. */
const CIVILIZATIONS: WorldTribes = [1, 2, 3, 4, 7];

describe.runIf(hasRealIr())('the stroke rest slots across the civilizations', () => {
  const tables = characterTablesUnderTest(CIVILIZATIONS);
  if (tables === null) return;

  it('binds every rest slot on the collector and the farmer look of every civilization', () => {
    for (const [tribe, table] of tables) {
      for (const job of [JOB_COLLECTOR, JOB_FARMER]) {
        const look = table?.byJob[job] ?? table?.default;
        expect(look, `tribe ${tribe} job ${job}`).toBeDefined();
        for (const atomicId of systems.STROKE_REST_ATOMIC_IDS) {
          expect(
            look?.binding.byAtomic?.[atomicId],
            `tribe ${tribe} job ${job} slot ${atomicId}`,
          ).toBeDefined();
        }
      }
    }
  });
});
