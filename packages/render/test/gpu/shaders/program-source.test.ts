import { expect, it } from 'vitest';
import { glProgramFor } from '../../../src/gpu/shaders/program-source.js';
import { WEATHER_AIR_SOURCE } from '../../../src/gpu/weather/atmosphere.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

useHeadlessShaderContext();

// GLSL ES 3.00 rejects an #extension after any other token, and the headless shader check runs on a
// backend without the extension, so only this test sees the merged weather pass's compiled text.
it('keeps an extension directive right under the version line, however often the program is asked for', () => {
  const first = glProgramFor(WEATHER_AIR_SOURCE).fragment;
  expect(first.startsWith('#version 300 es\n#extension GL_EXT_blend_func_extended : require\n')).toBe(true);
  expect(first.match(/#extension/g)).toHaveLength(1);
  expect(glProgramFor(WEATHER_AIR_SOURCE).fragment).toBe(first);
});
