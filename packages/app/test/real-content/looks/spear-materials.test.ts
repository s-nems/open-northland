import { createHumanPaletteColours, createHumanPaletteIdentity } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { CIVILIZATIONS } from '../../../src/catalog/civilizations.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SPEAR_WOODEN } from '../../../src/catalog/jobs.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { tribeLooks } from '../../../src/content/settler-gfx/index.js';
import { humanPaletteBook } from '../../../src/content/sprite-sheet/human-palettes.js';
import { hasRealIr, rawIrUnderTest } from '../helpers.js';

/** The band the viking spear job-change recipes paint, which its body draws the spear in. */
const VIKING_SPEAR_BAND = 14;
const BAND_BYTES = 16 * 3;
const SEED = 7;
const MATERIAL_RAMPS = [
  [JOB_SOLDIER_SPEAR_WOODEN, 'hair brown'],
  [JOB_SOLDIER_SPEAR, 'colors grey'],
] as const;

function hexBytes(hex: string): number[] {
  return Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

describe.runIf(hasRealIr())('spear materials', () => {
  it("paint every civilization's spear brown when wooden and grey when iron", () => {
    const ir = rawIrUnderTest() as ContentIr;
    const book = humanPaletteBook(ir);
    if (book === undefined) throw new Error('the IR carries no composable human palettes');
    const ramps = (ir.humanPalettes as { ramps: Record<string, string> }).ramps;
    for (const tribe of CIVILIZATIONS) {
      // Every playable spearman draws the iron look; Byzantium's wooden one borrows it.
      const look = tribeLooks(ir, tribe).get('warrior-spear-iron')?.[0];
      if (look === undefined) throw new Error(`tribe ${tribe} draws no spearman`);
      const bands = look.palette.weapon?.bands ?? [VIKING_SPEAR_BAND];
      for (const [job, ramp] of MATERIAL_RAMPS) {
        const out = createHumanPaletteColours();
        book.compose(
          Object.assign(createHumanPaletteIdentity(look.palette), {
            jobChange: book.jobChangeRecipe(tribe, job),
            weaponRamp: look.palette.weapon?.rampByJob[job],
            seed: SEED,
          }),
          out,
        );
        for (const band of bands) {
          const at = band * BAND_BYTES;
          expect(
            [...out.body.subarray(at, at + BAND_BYTES)],
            `tribe ${tribe} job ${job} band ${band}`,
          ).toEqual(hexBytes(ramps[ramp] ?? ''));
        }
      }
    }
  });
});
