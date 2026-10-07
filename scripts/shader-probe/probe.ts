// Browser half of `npm run test:shaders`: compiles the game's shader catalogue in the page's own WebGL 2
// context. `scripts/test-shaders.mjs` drives it one program per call, so a program that hangs the
// compiler is named by the caller instead of lost inside one long evaluation.
import { GlProgram } from 'pixi.js';
import { shaderCatalog } from '../../packages/render/src/gpu/shader-catalog.js';

export interface ProbeDevice {
  readonly renderer: string;
  readonly vendor: string;
  readonly version: string;
  readonly maxTextureUnits: number;
  readonly warmUpMs: number;
  readonly programNames: readonly string[];
}

export interface CompiledProgram {
  readonly status: 'compiled';
  readonly name: string;
  readonly ms: number;
  readonly linked: boolean;
  readonly contextLost: boolean;
  readonly vertexLog: string;
  readonly fragmentLog: string;
  readonly programLog: string;
}

/** The fragment stage declares more samplers than the device has units: the game never compiles that
 *  variant there, and GL refuses to link it. */
export interface SkippedProgram {
  readonly status: 'skipped';
  readonly name: string;
  readonly ms: 0;
  readonly textureUnits: number;
}

const WARM_UP_SOURCE = {
  vertex: '#version 300 es\nin vec2 aPosition;\nvoid main() { gl_Position = vec4(aPosition, 0.0, 1.0); }',
  fragment: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
};

const SAMPLER_DECLARATION =
  /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w*sampler\w*\s+\w+\s*(?:\[\s*(\d+)\s*\])?/g;

const catalogue = shaderCatalog();
let context: WebGL2RenderingContext | null = null;

function gl(): WebGL2RenderingContext {
  if (context === null) throw new Error('describe() creates the WebGL 2 context first');
  return context;
}

function shader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const handle = gl.createShader(type);
  if (handle === null) throw new Error('createShader returned null');
  gl.shaderSource(handle, source);
  gl.compileShader(handle);
  return handle;
}

/** Compiles and links one program; reading LINK_STATUS waits for the driver, which may defer both. */
function compileAndLink(
  gl: WebGL2RenderingContext,
  name: string,
  vertex: string,
  fragment: string,
): CompiledProgram {
  const start = performance.now();
  const vertexShader = shader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = shader(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) === true;
  const ms = performance.now() - start;
  const result: CompiledProgram = {
    status: 'compiled',
    name,
    ms,
    linked,
    contextLost: gl.isContextLost(),
    vertexLog: gl.getShaderInfoLog(vertexShader) ?? '',
    fragmentLog: gl.getShaderInfoLog(fragmentShader) ?? '',
    programLog: gl.getProgramInfoLog(program) ?? '',
  };
  gl.deleteProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return result;
}

function describe(): ProbeDevice {
  const canvas = document.createElement('canvas');
  context = canvas.getContext('webgl2');
  if (context === null) throw new Error('this browser gives the page no WebGL 2 context');
  const debug = context.getExtension('WEBGL_debug_renderer_info');
  // Pixi probes the fragment precision with a context of its own on first use; that stays out of the timings.
  const { vertex, fragment } = new GlProgram({ ...WARM_UP_SOURCE, name: 'warm-up' });
  if (vertex === undefined || fragment === undefined) throw new Error("Pixi dropped the warm-up's source");
  const warmUp = compileAndLink(context, 'warm-up', vertex, fragment);
  if (!warmUp.linked) throw new Error(`the warm-up program failed to link: ${warmUp.programLog}`);
  return {
    renderer: String(context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER)),
    vendor: String(context.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR)),
    version: String(context.getParameter(context.VERSION)),
    maxTextureUnits: Number(context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS)),
    warmUpMs: warmUp.ms,
    programNames: catalogue.map((entry) => entry.name),
  };
}

function declaredSamplers(source: string): number {
  let count = 0;
  for (const match of source.matchAll(SAMPLER_DECLARATION))
    count += match[1] === undefined ? 1 : Number(match[1]);
  return count;
}

/** Compiles catalogue entry `index` as Pixi hands it to GL, after Pixi's own preprocessing. */
function compile(index: number): CompiledProgram | SkippedProgram {
  const entry = catalogue[index];
  if (entry === undefined) throw new Error(`no catalogue entry ${index}`);
  const { vertex, fragment } = new GlProgram({ ...entry.source, name: entry.name });
  if (vertex === undefined || fragment === undefined) throw new Error(`Pixi dropped ${entry.name}'s source`);
  const context = gl();
  const textureUnits = declaredSamplers(fragment);
  if (textureUnits > context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS))
    return { status: 'skipped', name: entry.name, ms: 0, textureUnits };
  return compileAndLink(context, entry.name, vertex, fragment);
}

Object.assign(globalThis, { shaderProbe: { describe, compile } });
