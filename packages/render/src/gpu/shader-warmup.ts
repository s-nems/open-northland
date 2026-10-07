import { checkMaxIfStatementsInShader } from 'pixi.js';
import type { WorldMagnification } from './pixel-art-registry.js';
import { type GlslProgramSource, glProgramFor } from './program-source.js';
import { bootShaderPrograms } from './shader-catalog.js';
import { DEFAULT_SHADOW_STYLE, type ShadowStyle } from './shadow-style.js';
import { WORLD_BATCH_MAX_TEXTURES } from './world-batch-shader.js';
import type { WorldEnhancements } from './world-renderer/frame.js';

/**
 * Links the programs a world will draw with in a context of its own, ahead of the renderer. The browser
 * caches linked programs by their text across contexts and, on disk, across runs, so the renderer's own
 * link of the same text is answered from the cache instead of compiling: on Direct3D that compile is
 * seconds per program, and with `KHR_parallel_shader_compile` the driver runs it on its own threads
 * while the caller keeps loading. Without the extension each link blocks this thread, one program per
 * turn so a progress label can paint between them.
 */
export interface ShaderWarmup {
  /** Settles once every program is linked or has failed; a failure is reported, never thrown, since the
   *  renderer reports its own. */
  readonly done: Promise<readonly WarmedProgram[]>;
}

export interface WarmedProgram {
  readonly name: string;
  readonly linked: boolean;
  /** Wall time from the request to the link's completion; parallel compiles overlap. */
  readonly ms: number;
}

/** The world batch variant a setting pair selects; the renderer applies the same reading. */
export interface WorldShaderSettings {
  readonly magnification: WorldMagnification;
  readonly shadow: ShadowStyle | null;
}

export function worldShaderSettings(
  enhancements: Pick<WorldEnhancements, 'enhancedSampling' | 'pixelArtScaler' | 'softShadows'>,
): WorldShaderSettings {
  return {
    magnification: enhancements.enhancedSampling ? enhancements.pixelArtScaler : 'off',
    shadow: enhancements.softShadows ? DEFAULT_SHADOW_STYLE : null,
  };
}

/** How often a pending parallel link is asked whether it has completed. */
const COMPLETION_POLL_MS = 16;

const KHR_PARALLEL_SHADER_COMPILE = 'KHR_parallel_shader_compile';
/** `COMPLETION_STATUS_KHR` of the extension; the GL enum, so no typed extension object is needed. */
const COMPLETION_STATUS_KHR = 0x91b1;

interface PendingLink {
  readonly name: string;
  readonly program: WebGLProgram;
  readonly shaders: readonly WebGLShader[];
  readonly startedAt: number;
}

/** The calls the warm-up makes on its context, so a test can drive it without a GPU. */
export type LinkingContext = Pick<
  WebGL2RenderingContext,
  | 'VERTEX_SHADER'
  | 'FRAGMENT_SHADER'
  | 'LINK_STATUS'
  | 'createProgram'
  | 'createShader'
  | 'shaderSource'
  | 'compileShader'
  | 'attachShader'
  | 'linkProgram'
  | 'getProgramParameter'
  | 'deleteShader'
  | 'deleteProgram'
>;

export function startShaderWarmup(
  enhancements: Pick<WorldEnhancements, 'enhancedSampling' | 'pixelArtScaler' | 'softShadows'>,
  onProgress?: (linked: number, total: number) => void,
): ShaderWarmup {
  const settings = worldShaderSettings(enhancements);
  const gl =
    typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('webgl2', { antialias: false, depth: false });
  // No WebGL 2 here: the renderer will say so itself.
  if (gl === null) return { done: Promise.resolve([]) };
  // The limit the renderer will find for its own context: WebGL 2 guarantees the if-chain at 16, and
  // Pixi halves the limit where a larger chain fails to compile.
  const limit = checkMaxIfStatementsInShader(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), gl);
  const programs = bootShaderPrograms(
    Math.min(limit, WORLD_BATCH_MAX_TEXTURES),
    settings.magnification,
    settings.shadow,
  );
  const parallel = gl.getExtension(KHR_PARALLEL_SHADER_COMPILE) !== null;
  const done = linkPrograms(gl, programs, parallel, onProgress).finally(() =>
    gl.getExtension('WEBGL_lose_context')?.loseContext(),
  );
  return { done };
}

/** Links `programs` on `gl`; `parallel` says the context offers `KHR_parallel_shader_compile`. */
export function linkPrograms(
  gl: LinkingContext,
  programs: readonly GlslProgramSource[],
  parallel: boolean,
  onProgress: (linked: number, total: number) => void = () => undefined,
): Promise<readonly WarmedProgram[]> {
  return (parallel ? linkInParallel : linkOneByOne)(gl, programs, onProgress);
}

/** Requests every link up front, then waits for the driver's threads to finish them all. */
async function linkInParallel(
  gl: LinkingContext,
  programs: readonly GlslProgramSource[],
  onProgress: (linked: number, total: number) => void,
): Promise<readonly WarmedProgram[]> {
  let pending = programs.map((source) => requestLink(gl, source));
  const warmed: WarmedProgram[] = [];
  while (pending.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, COMPLETION_POLL_MS));
    const still: PendingLink[] = [];
    for (const link of pending) {
      if (gl.getProgramParameter(link.program, COMPLETION_STATUS_KHR) === true)
        warmed.push(finishLink(gl, link));
      else still.push(link);
    }
    pending = still;
    if (warmed.length > 0) onProgress(warmed.length, programs.length);
  }
  return warmed;
}

/** One blocking link per turn, so the label a caller wrote can paint before the next one. */
async function linkOneByOne(
  gl: LinkingContext,
  programs: readonly GlslProgramSource[],
  onProgress: (linked: number, total: number) => void,
): Promise<readonly WarmedProgram[]> {
  const warmed: WarmedProgram[] = [];
  for (const source of programs) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    warmed.push(finishLink(gl, requestLink(gl, source)));
    onProgress(warmed.length, programs.length);
  }
  return warmed;
}

/** Compiles and links the text Pixi will hand the renderer for `source`; the driver may defer both. */
function requestLink(gl: LinkingContext, source: GlslProgramSource): PendingLink {
  const { vertex, fragment } = glProgramFor(source);
  if (vertex === undefined || fragment === undefined) throw new Error(`Pixi dropped ${source.name}'s source`);
  const program = gl.createProgram();
  if (program === null) throw new Error(`createProgram failed for ${source.name}`);
  const compile = (type: GLenum, text: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error(`createShader failed for ${source.name}`);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  };
  const shaders = [compile(gl.VERTEX_SHADER, vertex), compile(gl.FRAGMENT_SHADER, fragment)];
  gl.linkProgram(program);
  return { name: source.name, program, shaders, startedAt: performance.now() };
}

/** Reads the link's outcome, which waits for a deferred link, and frees the objects. */
function finishLink(gl: LinkingContext, link: PendingLink): WarmedProgram {
  const linked = gl.getProgramParameter(link.program, gl.LINK_STATUS) === true;
  const ms = performance.now() - link.startedAt;
  for (const shader of link.shaders) gl.deleteShader(shader);
  gl.deleteProgram(link.program);
  return { name: link.name, linked, ms };
}
