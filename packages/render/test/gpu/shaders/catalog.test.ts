import { expect, it } from 'vitest';
import { NIGHT_LIT_OUTPUT } from '../../../src/gpu/lighting/night-mask.js';
import {
  bootShaderPrograms,
  nightMaskPrograms,
  type ShaderSelection,
} from '../../../src/gpu/shaders/catalog.js';
import { WORLD_BATCH_MAX_TEXTURES } from '../../../src/gpu/world-batch/shader.js';
import { DEFAULT_SHADOW_STYLE } from '../../../src/gpu/world-batch/shadow-style.js';

/** The batch limit WebGL 2 guarantees. */
const GUARANTEED_TEXTURES = 16;

it("selects exactly the boot programs that declare the night's lit mask output", () => {
  const selections: ShaderSelection[] = [
    { magnification: 'xbr', shadow: DEFAULT_SHADOW_STYLE, weather: true, blood: true, groundWaves: true },
    { magnification: 'off', shadow: null, weather: false, blood: false, groundWaves: false },
  ];
  const writesMask = new RegExp(`out\\s+vec4\\s+${NIGHT_LIT_OUTPUT}\\b`);
  for (const limit of [GUARANTEED_TEXTURES, WORLD_BATCH_MAX_TEXTURES]) {
    for (const selection of selections) {
      const writers = bootShaderPrograms(limit, selection).filter((program) =>
        writesMask.test(program.fragment),
      );
      expect(nightMaskPrograms(limit, selection)).toEqual(writers);
    }
  }
});
