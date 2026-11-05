import { type GlProgram, WebGLRenderer } from 'pixi.js';
import { expect, it } from 'vitest';
import { WORLD_MAGNIFY_MODES } from '../../../src/gpu/pixel-art/registry.js';
import { glProgramFor } from '../../../src/gpu/shaders/program-source.js';
import { linkRendererPrograms } from '../../../src/gpu/shaders/renderer-links.js';
import { WEATHER_AIR_SOURCE } from '../../../src/gpu/weather/atmosphere.js';
import { WORLD_BATCH_MAX_TEXTURES, worldBatchProgramSource } from '../../../src/gpu/world-batch/shader.js';
import { DEFAULT_SHADOW_STYLE } from '../../../src/gpu/world-batch/shadow-style.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

useHeadlessShaderContext();

/** A renderer limit past the slots any batch program is compiled for. */
const UNCAPPED_LIMIT = 2 * WORLD_BATCH_MAX_TEXTURES;

it('links the very programs the world batch binds, capped at its slots, each once', async () => {
  const linked: GlProgram[] = [];
  const renderer = Object.assign(Object.create(WebGLRenderer.prototype) as WebGLRenderer, {
    limits: { maxBatchableTextures: UNCAPPED_LIMIT },
    gl: { isContextLost: () => false, getExtension: () => null },
    shader: { _getProgramData: (program: GlProgram) => linked.push(program) },
  });
  await linkRendererPrograms(renderer, {
    enhancedSampling: true,
    pixelArtScaler: 'xbr',
    softShadows: true,
    environmentMotion: true,
    weather: true,
    blood: true,
  });
  for (const sampling of ['magnifying', 'unmagnified'] as const) {
    const batch = worldBatchProgramSource(
      WORLD_BATCH_MAX_TEXTURES,
      WORLD_MAGNIFY_MODES.xbr,
      DEFAULT_SHADOW_STYLE,
      sampling,
    );
    expect(linked).toContain(glProgramFor(batch));
  }
  expect(new Set(linked).size).toBe(linked.length);
  // The context has no dual-source blending, so the grade and veil keep their own passes.
  expect(linked).not.toContain(glProgramFor(WEATHER_AIR_SOURCE));
});

it('stops linking once the context is lost', async () => {
  let links = 0;
  const renderer = Object.assign(Object.create(WebGLRenderer.prototype) as WebGLRenderer, {
    limits: { maxBatchableTextures: WORLD_BATCH_MAX_TEXTURES },
    gl: { isContextLost: () => links > 0, getExtension: () => null },
    shader: { _getProgramData: () => links++ },
  });
  const linked = await linkRendererPrograms(renderer, {
    enhancedSampling: false,
    pixelArtScaler: 'xbr',
    softShadows: false,
    environmentMotion: false,
    weather: false,
    blood: false,
  });
  expect(linked).toHaveLength(1);
  expect(links).toBe(1);
});
