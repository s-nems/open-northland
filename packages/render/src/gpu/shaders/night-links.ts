import { type Renderer, WebGLRenderer } from 'pixi.js';
import { NIGHT_LIT_LOCATION } from '../lighting/night-mask.js';
import { nightMaskPrograms } from './catalog.js';
import { type GlslProgramSource, glProgramFor, supportsProgram } from './program-source.js';
import { shaderSelection, type WarmupSettings } from './warmup.js';

/** The night-mask programs a renderer drew ahead of its first night. */
export interface NightMaskDraws {
  readonly programs: number;
  /** Wall time from the draws to the GPU having run them: seconds where they compiled, and where the
   *  program cache held the variants up to half a second of driver work on a Radeon Vega 7. */
  readonly ms: number;
  /** The GPU had not run them when the wait ended; they still finish, but a later call may wait on them. */
  readonly timedOut: boolean;
}

/** How often the draws' fence is asked whether the GPU has passed it. */
const FENCE_POLL_MS = 16;
/** How long the fence is waited for: four cold Direct3D compiles took 10 s on a Ryzen 7 4800HS. */
const FENCE_LIMIT_MS = 60_000;
/** Texels per side of the throwaway target: the draws only need to run, not to cover anything. */
const TARGET_SIZE = 1;
/** Vertices of the one degenerate triangle each program draws. */
const TRIANGLE_VERTICES = 3;

/** The programs that write the night's lit mask for `settings` on `renderer`, as its boot links them;
 *  none where it is not WebGL. */
export function nightMaskSources(renderer: Renderer, settings: WarmupSettings): readonly GlslProgramSource[] {
  if (!(renderer instanceof WebGLRenderer)) return [];
  return nightMaskPrograms(renderer.limits.maxBatchableTextures, shaderSelection(settings)).filter((source) =>
    supportsProgram(renderer.gl, source),
  );
}

/**
 * Draws each of `sources` once, in the renderer's own context, into a target laid out as the night's
 * (colour, then the mask at {@link NIGHT_LIT_LOCATION}) with both draw buffers on. Direct3D builds a
 * program's pixel shader for its first output at link and the variant writing both outputs at the first
 * draw that needs it, a synchronous compile of seconds on the GPU process's main thread that would
 * freeze the first night. Drawn here, it compiles behind the loading card, and the browser's program
 * cache keeps the variant for later boots. The sources must be linked already, as the renderer's boot
 * links them. Resolves once the GPU has run the draws, asked through a fence that never blocks this
 * thread; null where nothing was drawn.
 */
export async function drawNightMaskPrograms(
  renderer: Renderer,
  sources: readonly GlslProgramSource[],
): Promise<NightMaskDraws | null> {
  if (!(renderer instanceof WebGLRenderer) || sources.length === 0 || renderer.gl.isContextLost())
    return null;
  const gl = renderer.gl;
  const programs = sources.map((source) => renderer.shader._getProgramData(glProgramFor(source)).program);
  const startedAt = performance.now();
  const colour = gl.createTexture();
  const mask = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  let fence: WebGLSync | null = null;
  try {
    for (const [texture, format] of [
      [colour, gl.RGBA8],
      [mask, gl.R8],
    ] as const) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, TARGET_SIZE, TARGET_SIZE);
    }
    // An attachment still bound to a unit a sampler reads would fail every draw as a feedback loop.
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const maskAttachment = gl.COLOR_ATTACHMENT0 + NIGHT_LIT_LOCATION;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, maskAttachment, gl.TEXTURE_2D, mask, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, maskAttachment]);
    gl.viewport(0, 0, TARGET_SIZE, TARGET_SIZE);
    // No attribute arrays: every input reads its constant value.
    gl.bindVertexArray(null);
    for (const program of programs) {
      gl.useProgram(program);
      gl.drawArrays(gl.TRIANGLES, 0, TRIANGLE_VERTICES);
    }
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(null);
    // Freed once the draws that use them have run.
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(colour);
    gl.deleteTexture(mask);
    renderer.resetState();
  }
  const timedOut = !(await fencePassed(gl, fence));
  if (fence !== null) gl.deleteSync(fence);
  return { programs: programs.length, ms: performance.now() - startedAt, timedOut };
}

/** Whether the GPU passed `fence` within {@link FENCE_LIMIT_MS}; a lost context ends the wait as
 *  passed, since it runs nothing more. WebGL reports a fence's status between tasks without blocking. */
function fencePassed(gl: WebGL2RenderingContext, fence: WebGLSync | null): Promise<boolean> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const poll = (): void => {
      if (
        fence === null ||
        gl.isContextLost() ||
        gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED
      ) {
        resolve(true);
        return;
      }
      if (performance.now() - startedAt > FENCE_LIMIT_MS) {
        resolve(false);
        return;
      }
      setTimeout(poll, FENCE_POLL_MS);
    };
    setTimeout(poll, FENCE_POLL_MS);
  });
}
