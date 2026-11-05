import { SystemRunner, WebGLRenderer } from 'pixi.js';
import { expect, it } from 'vitest';
import {
  DUAL_SOURCE_BLEND,
  enableShaderExtensions,
  glProgramFor,
} from '../../../src/gpu/shaders/program-source.js';
import { WEATHER_AIR_SOURCE } from '../../../src/gpu/weather/atmosphere.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

useHeadlessShaderContext();

// GLSL ES 3.00 rejects an #extension after any other token, and the headless shader check runs on a
// backend without the extension, so only this test sees the merged weather pass's compiled text.
it('keeps an extension directive right under the version line, however often the program is asked for', () => {
  const first = glProgramFor(WEATHER_AIR_SOURCE).fragment;
  if (first === undefined) throw new Error('expected the merged pass’s fragment text');
  expect(first.startsWith('#version 300 es\n#extension GL_EXT_blend_func_extended : require\n')).toBe(true);
  expect(first.match(/#extension/g)).toHaveLength(1);
  expect(glProgramFor(WEATHER_AIR_SOURCE).fragment).toBe(first);
});

it('enables the extensions the catalogue needs on the first context and on a restored one', () => {
  const enabled: string[] = [];
  const context = (): WebGL2RenderingContext =>
    ({ getExtension: (name: string) => enabled.push(name) }) as unknown as WebGL2RenderingContext;
  const contextChange = new SystemRunner('contextChange');
  const renderer = Object.assign(Object.create(WebGLRenderer.prototype) as WebGLRenderer, {
    gl: context(),
    runners: { contextChange },
  });
  enableShaderExtensions(renderer);
  expect(enabled).toEqual([DUAL_SOURCE_BLEND]);
  contextChange.emit(context());
  expect(enabled).toEqual([DUAL_SOURCE_BLEND, DUAL_SOURCE_BLEND]);
});
