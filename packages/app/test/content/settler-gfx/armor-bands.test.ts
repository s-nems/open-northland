import { describe, expect, it } from 'vitest';
import { armorLayout } from '../../../src/content/settler-gfx/armor-bands.js';
import { weaponLayout } from '../../../src/content/settler-gfx/weapon-bands.js';

/** Head palette band ids start past the body's 16 bands. */
const HEAD_BAND_BASE = 16;
const TURBAN = HEAD_BAND_BASE + 6;
const SWORD_TURBAN = 9;

describe('soldier armor layouts', () => {
  it('retains garment and spear bands in numbered library variants', () => {
    expect(armorLayout('cr_hum_body_52_variant35', [])?.bands.map((band) => band.band)).toEqual([10, 5]);
    expect(weaponLayout('cr_hum_body_52_variant33')?.bands).toEqual([14]);
    expect(armorLayout('cr_hum_body_50_variant6', [])).toBeUndefined();
    expect(armorLayout('cr_hum_body_42_variant30', ['cr_hum_head_42_variant30'])?.team).toEqual([TURBAN]);
    expect(armorLayout('cr_hum_body_52_variantinvalid', [])).toBeUndefined();
  });

  it("adds the head's team bands to the body's", () => {
    expect(armorLayout('cr_hum_body_62', ['cr_hum_head_42', 'cr_hum_head_43'])?.team).toEqual([
      SWORD_TURBAN,
      TURBAN,
    ]);
  });

  it('leaves a body without a layout to the armor recipe, whatever its heads', () => {
    expect(armorLayout('cr_hum_body_05', ['cr_hum_head_42'])).toBeUndefined();
  });
});
