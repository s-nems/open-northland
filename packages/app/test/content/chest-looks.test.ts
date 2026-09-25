import { describe, expect, it } from 'vitest';
import { OPEN_CHEST_ATOMIC } from '../../src/catalog/atomics.js';
import { JOB_DRUID } from '../../src/catalog/jobs.js';
import {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  type CharacterSpecId,
} from '../../src/content/settler-gfx/index.js';
import type { WorldTribes } from '../../src/game/world-tribes.js';
import { characterTablesUnderTest, hasRealIr } from './helpers.js';

/**
 * Every adult look of every civilization plays the chest bend over the REAL decoded content, composed
 * the way the sheet composes it: a wooden chest takes any adult trade and a magical one a druid or hero,
 * so a look without the clip is a settler standing motionless at the chest. Heroes and the other
 * civilizations author no viking clip names; they resolve through their own `[gfxanimatomic]` rows and
 * the `baseJob` chain, which is what this pins.
 */

/** The `TRIBE_TYPE_HUMAN_*` civilizations, viking leading as the base. */
const CIVILIZATIONS: WorldTribes = [1, 2, 3, 4, 7];
const FRANK = 2;

/** The one adult look the source ships no bend for: the frank heroine draws `cr_hum_body_74`, whose
 *  pool holds only its walk, wait and attack, and no frank record binds action 91 to that job. */
const UNBENDABLE: ReadonlySet<`${number}/${CharacterSpecId}`> = new Set([`${FRANK}/hero-bow`]);

describe.runIf(hasRealIr())('the chest bend across the civilizations', () => {
  const tables = characterTablesUnderTest(CIVILIZATIONS);
  if (tables === null) return;

  it('binds the chest atomic on every adult look of every civilization', () => {
    for (const [tribe, table] of tables) {
      expect(table, `tribe ${tribe}`).toBeDefined();
      for (const [job, specId] of Object.entries(ADULT_CHARACTER_BY_JOB)) {
        if (UNBENDABLE.has(`${tribe}/${specId}`)) continue;
        const chest = table?.byJob[Number(job)]?.binding.byAtomic?.[OPEN_CHEST_ATOMIC];
        expect(chest, `tribe ${tribe} job ${job} (${specId})`).toBeDefined();
      }
    }
  });

  it('bends the druid, who draws the civilian look, on every civilization', () => {
    for (const [tribe, table] of tables) {
      const druid = table?.byJob[JOB_DRUID] ?? table?.default;
      expect(druid?.binding.byAtomic?.[OPEN_CHEST_ATOMIC], `tribe ${tribe}`).toBeDefined();
    }
  });

  it('keeps the unbendable list exact', () => {
    for (const [tribe, table] of tables) {
      for (const [specId] of CHARACTER_SPEC_ENTRIES) {
        if (!UNBENDABLE.has(`${tribe}/${specId}`)) continue;
        const job = Number(Object.entries(ADULT_CHARACTER_BY_JOB).find(([, id]) => id === specId)?.[0]);
        const look = table?.byJob[job];
        expect(look, `${tribe}/${specId} draws`).toBeDefined();
        expect(look?.binding.byAtomic?.[OPEN_CHEST_ATOMIC], `${tribe}/${specId}`).toBeUndefined();
      }
    }
  });
});
