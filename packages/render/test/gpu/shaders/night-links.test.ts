import { type GlProgram, WebGLRenderer } from 'pixi.js';
import { expect, it } from 'vitest';
import { NIGHT_LIT_LOCATION } from '../../../src/gpu/lighting/night-mask.js';
import { nightMaskPrograms } from '../../../src/gpu/shaders/catalog.js';
import { drawNightMaskPrograms, nightMaskSources } from '../../../src/gpu/shaders/night-links.js';
import { glProgramFor } from '../../../src/gpu/shaders/program-source.js';
import { shaderSelection, type WarmupSettings } from '../../../src/gpu/shaders/warmup.js';
import { WORLD_BATCH_MAX_TEXTURES } from '../../../src/gpu/world-batch/shader.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

useHeadlessShaderContext();

const COLOR_ATTACHMENT0 = 0x8ce0;
const NONE = 0;
const SIGNALED = 0x9119;
const UNSIGNALED = 0x9118;
/** Polls the fence answers unsignalled before the GPU has run the draws. */
const POLLS_BEFORE_SIGNAL = 2;

const settings: WarmupSettings = {
  enhancedSampling: true,
  pixelArtScaler: 'xbr',
  softShadows: true,
  environmentMotion: false,
  weather: false,
  blood: false,
};

/**
 * A WebGL 2 context holding what the draws leave behind: each draw with its program, attachments and
 * draw buffers, and the objects still alive. A call outside the ones listed throws, so a blocking
 * query such as `getError` or `readPixels` fails the test.
 */
function recordingContext(lost = () => false) {
  const live = new Set<object>();
  const attachments = new Map<object, Map<number, object | null>>();
  const draws: { program: object | null; attached: (object | null)[]; buffers: number[] }[] = [];
  let framebuffer: object | null = null;
  let program: object | null = null;
  let buffers: number[] = [COLOR_ATTACHMENT0];
  let polls = 0;
  const made = (): object => {
    const object = {};
    live.add(object);
    return object;
  };
  const freed = (object: object | null): void => {
    if (object !== null) live.delete(object);
  };
  const calls: Record<string, (...args: never[]) => unknown> = {
    isContextLost: lost,
    createTexture: made,
    createFramebuffer: made,
    fenceSync: made,
    deleteTexture: freed,
    deleteFramebuffer: freed,
    deleteSync: freed,
    bindTexture: () => undefined,
    texStorage2D: () => undefined,
    viewport: () => undefined,
    bindVertexArray: () => undefined,
    flush: () => undefined,
    bindFramebuffer: (_target: number, bound: object | null) => {
      framebuffer = bound;
      if (bound !== null && !attachments.has(bound)) attachments.set(bound, new Map());
    },
    framebufferTexture2D: (_target: number, attachment: number, _textarget: number, texture: object) => {
      if (framebuffer !== null) attachments.get(framebuffer)?.set(attachment, texture);
    },
    drawBuffers: (next: number[]) => {
      buffers = [...next];
    },
    useProgram: (next: object | null) => {
      program = next;
    },
    drawArrays: () => {
      const target = framebuffer === null ? undefined : attachments.get(framebuffer);
      const attached = buffers.map((buffer) => (buffer === NONE ? null : (target?.get(buffer) ?? null)));
      draws.push({ program, attached, buffers: [...buffers] });
    },
    getSyncParameter: () => (++polls > POLLS_BEFORE_SIGNAL ? SIGNALED : UNSIGNALED),
  };
  const gl = new Proxy(
    {
      TEXTURE_2D: 0x0de1,
      RGBA8: 0x8058,
      R8: 0x8229,
      FRAMEBUFFER: 0x8d40,
      COLOR_ATTACHMENT0,
      TRIANGLES: 0x0004,
      SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
      SYNC_STATUS: 0x9114,
      SIGNALED,
    },
    {
      get(constants, key) {
        if (typeof key === 'string' && key in constants) return constants[key as keyof typeof constants];
        const call = typeof key === 'string' ? calls[key] : undefined;
        if (call === undefined) throw new Error(`unexpected gl.${String(key)}`);
        return call;
      },
    },
  );
  return { gl, live, draws, polls: () => polls };
}

function rendererOn(gl: unknown) {
  const programs = new Map<GlProgram, object>();
  let resets = 0;
  const renderer = Object.assign(Object.create(WebGLRenderer.prototype) as WebGLRenderer, {
    limits: { maxBatchableTextures: WORLD_BATCH_MAX_TEXTURES },
    gl,
    shader: {
      _getProgramData: (glProgram: GlProgram) => {
        const linked = programs.get(glProgram) ?? {};
        programs.set(glProgram, linked);
        return { program: linked };
      },
    },
    resetState: () => {
      resets++;
    },
  });
  return { renderer, programs, resets: () => resets };
}

it('draws each night program once with the mask beside the colour, frees its target and resets Pixi', async () => {
  const context = recordingContext();
  const { renderer, programs, resets } = rendererOn(context.gl);
  const drawn = await drawNightMaskPrograms(renderer, nightMaskSources(renderer, settings));
  const expected = nightMaskPrograms(WORLD_BATCH_MAX_TEXTURES, shaderSelection(settings)).map((source) =>
    programs.get(glProgramFor(source)),
  );
  expect(context.draws.map((draw) => draw.program)).toEqual(expected);
  for (const draw of context.draws) {
    expect(draw.buffers).toEqual([COLOR_ATTACHMENT0, COLOR_ATTACHMENT0 + NIGHT_LIT_LOCATION]);
    expect(draw.attached.every((texture) => texture !== null)).toBe(true);
  }
  expect(drawn).toMatchObject({ programs: expected.length, outcome: 'ran' });
  // Settled only once the GPU had passed the draws' fence.
  expect(context.polls()).toBe(POLLS_BEFORE_SIGNAL + 1);
  expect(context.live.size).toBe(0);
  expect(resets()).toBe(1);
});

it('draws nothing on a lost context, and ends the wait when the context goes mid-way', async () => {
  const lost = recordingContext(() => true);
  const lostRenderer = rendererOn(lost.gl).renderer;
  expect(await drawNightMaskPrograms(lostRenderer, nightMaskSources(lostRenderer, settings))).toBeNull();
  expect(lost.draws).toHaveLength(0);
  let gone = false;
  const losing = recordingContext(() => gone);
  const losingRenderer = rendererOn(losing.gl).renderer;
  const pending = drawNightMaskPrograms(losingRenderer, nightMaskSources(losingRenderer, settings));
  gone = true;
  expect(await pending).toMatchObject({ outcome: 'lost' });
  expect(losing.polls()).toBe(0);
  expect(losing.live.size).toBe(0);
});
