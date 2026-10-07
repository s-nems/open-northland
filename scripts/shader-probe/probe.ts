// Browser half of `npm run test:shaders`: compiles the game's shader catalogue in the page's own WebGL 2
// context and draws once with each program, since a software renderer compiles a shader in its JIT
// at the first draw, not at link. `scripts/test-shaders.mjs` drives it one program per call, so a
// program that hangs the compiler is named by the caller instead of lost inside one long evaluation.
import { GlProgram } from 'pixi.js';
import { glProgramFor } from '../../packages/render/src/gpu/program-source.js';
import { shaderCatalog } from '../../packages/render/src/gpu/shader-catalog.js';

export interface ProbeDevice {
  readonly renderer: string;
  readonly vendor: string;
  readonly version: string;
  readonly maxTextureUnits: number;
  readonly warmUpMs: number;
  readonly warmUpDrawMs: number;
  readonly programNames: readonly string[];
}

export interface CompiledProgram {
  readonly status: 'compiled';
  readonly name: string;
  /** Compile and link. */
  readonly ms: number;
  /** The first draw call and its readback; `null` when the program did not link or was not drawn. */
  readonly drawMs: number | null;
  /** The GL error the draw and readback left, 0 for none: a refused draw returns at once and would
   *  pass for a cheap one. */
  readonly drawError: number;
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
/** A second context for `relink`, so a relink measures the browser's program cache, not the first
 *  context's own objects. */
let relinkContext: WebGL2RenderingContext | null = null;

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

/** Vertices of the one triangle a first draw rasterises; every attribute reads zeros, so the triangle
 *  is degenerate, which still builds the pipeline. */
const DRAW_VERTICES = 3;
/** Floats per vertex the shared zero buffer holds: enough for a mat4 attribute. */
const MAX_ATTRIBUTE_FLOATS = 16;

/** Components and column count of an attribute type the catalogue's programs declare. */
function attributeLayout(
  gl: WebGL2RenderingContext,
  type: GLenum,
): { readonly size: number; readonly columns: number; readonly integer: boolean } {
  switch (type) {
    case gl.FLOAT:
      return { size: 1, columns: 1, integer: false };
    case gl.FLOAT_VEC2:
      return { size: 2, columns: 1, integer: false };
    case gl.FLOAT_VEC3:
      return { size: 3, columns: 1, integer: false };
    case gl.FLOAT_VEC4:
      return { size: 4, columns: 1, integer: false };
    case gl.FLOAT_MAT3:
      return { size: 3, columns: 3, integer: false };
    case gl.FLOAT_MAT4:
      return { size: 4, columns: 4, integer: false };
    case gl.INT:
    case gl.UNSIGNED_INT:
      return { size: 1, columns: 1, integer: true };
    case gl.INT_VEC2:
    case gl.UNSIGNED_INT_VEC2:
      return { size: 2, columns: 1, integer: true };
    case gl.INT_VEC3:
    case gl.UNSIGNED_INT_VEC3:
      return { size: 3, columns: 1, integer: true };
    case gl.INT_VEC4:
    case gl.UNSIGNED_INT_VEC4:
      return { size: 4, columns: 1, integer: true };
    default:
      throw new Error(`attribute type 0x${type.toString(16)} has no layout in the shader probe`);
  }
}

function isSamplerType(gl: WebGL2RenderingContext, type: GLenum): boolean {
  return (
    type === gl.SAMPLER_2D ||
    type === gl.SAMPLER_3D ||
    type === gl.SAMPLER_CUBE ||
    type === gl.SAMPLER_2D_SHADOW ||
    type === gl.SAMPLER_2D_ARRAY ||
    type === gl.SAMPLER_2D_ARRAY_SHADOW ||
    type === gl.SAMPLER_CUBE_SHADOW ||
    type === gl.INT_SAMPLER_2D ||
    type === gl.INT_SAMPLER_3D ||
    type === gl.INT_SAMPLER_CUBE ||
    type === gl.INT_SAMPLER_2D_ARRAY ||
    type === gl.UNSIGNED_INT_SAMPLER_2D ||
    type === gl.UNSIGNED_INT_SAMPLER_3D ||
    type === gl.UNSIGNED_INT_SAMPLER_CUBE ||
    type === gl.UNSIGNED_INT_SAMPLER_2D_ARRAY
  );
}

/** Every attribute reads the shared zero buffer and every sampler gets a texture unit of its own
 *  (two sampler types on one unit would refuse the draw), so any linked program can draw once. */
function bindForDraw(gl: WebGL2RenderingContext, program: WebGLProgram): WebGLBuffer {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(DRAW_VERTICES * MAX_ATTRIBUTE_FLOATS), gl.STATIC_DRAW);
  const attributes = Number(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES));
  for (let index = 0; index < attributes; index++) {
    const info = gl.getActiveAttrib(program, index);
    if (info === null) continue;
    const location = gl.getAttribLocation(program, info.name);
    if (location < 0) continue; // a built-in such as gl_VertexID
    const layout = attributeLayout(gl, info.type);
    for (let column = 0; column < layout.columns; column++) {
      gl.enableVertexAttribArray(location + column);
      if (layout.integer) gl.vertexAttribIPointer(location + column, layout.size, gl.INT, 0, 0);
      else gl.vertexAttribPointer(location + column, layout.size, gl.FLOAT, false, 0, 0);
    }
  }
  const uniforms = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS));
  let unit = 0;
  for (let index = 0; index < uniforms; index++) {
    const info = gl.getActiveUniform(program, index);
    if (info === null || !isSamplerType(gl, info.type)) continue;
    const location = gl.getUniformLocation(program, info.name);
    if (location === null) continue;
    const units = Array.from({ length: info.size }, () => unit++);
    gl.uniform1iv(location, units);
  }
  return buffer;
}

/** One draw call and a readback that waits for it: where a driver builds the pipeline, and a software
 *  renderer's JIT compiles the shader. */
function firstDraw(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): { readonly ms: number; readonly error: number } {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.useProgram(program);
  const buffer = bindForDraw(gl, program);
  // A stale error from an earlier call would be blamed on this draw.
  while (gl.getError() !== gl.NO_ERROR);
  const start = performance.now();
  gl.drawArrays(gl.TRIANGLES, 0, DRAW_VERTICES);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const ms = performance.now() - start;
  const error = gl.getError();
  gl.useProgram(null);
  gl.bindVertexArray(null);
  gl.deleteVertexArray(vao);
  gl.deleteBuffer(buffer);
  return { ms, error };
}

/** Compiles, links and, when `draw` is set, draws once with one program; reading LINK_STATUS waits
 *  for the driver, which may defer both compile and link. */
function compileAndLink(
  gl: WebGL2RenderingContext,
  name: string,
  vertex: string,
  fragment: string,
  draw: boolean,
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
  const drawn = linked && draw ? firstDraw(gl, program) : null;
  const result: CompiledProgram = {
    status: 'compiled',
    name,
    ms,
    drawMs: drawn === null ? null : drawn.ms,
    drawError: drawn === null ? 0 : drawn.error,
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
  const warmUp = compileAndLink(context, 'warm-up', vertex, fragment, true);
  if (!warmUp.linked || warmUp.drawMs === null)
    throw new Error(`the warm-up program failed to link: ${warmUp.programLog}`);
  if (warmUp.drawError !== context.NO_ERROR)
    throw new Error(`the warm-up draw left GL error 0x${warmUp.drawError.toString(16)}`);
  return {
    renderer: String(context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER)),
    vendor: String(context.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR)),
    version: String(context.getParameter(context.VERSION)),
    maxTextureUnits: Number(context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS)),
    warmUpMs: warmUp.ms,
    warmUpDrawMs: warmUp.drawMs,
    programNames: catalogue.map((entry) => entry.name),
  };
}

function declaredSamplers(source: string): number {
  let count = 0;
  for (const match of source.matchAll(SAMPLER_DECLARATION))
    count += match[1] === undefined ? 1 : Number(match[1]);
  return count;
}

/** Compiles catalogue entry `index` as Pixi hands it to GL, after Pixi's own preprocessing: the one
 *  program instance per source the game itself uses, so a relink sees the text the renderer links. */
function compileIn(
  context: WebGL2RenderingContext,
  index: number,
  draw: boolean,
): CompiledProgram | SkippedProgram {
  const entry = catalogue[index];
  if (entry === undefined) throw new Error(`no catalogue entry ${index}`);
  const { vertex, fragment } = glProgramFor(entry);
  if (vertex === undefined || fragment === undefined) throw new Error(`Pixi dropped ${entry.name}'s source`);
  const textureUnits = declaredSamplers(fragment);
  if (textureUnits > context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS))
    return { status: 'skipped', name: entry.name, ms: 0, textureUnits };
  return compileAndLink(context, entry.name, vertex, fragment, draw);
}

function compile(index: number): CompiledProgram | SkippedProgram {
  return compileIn(gl(), index, true);
}

/** Links entry `index` again in a second context, without a draw: fast where the browser's program
 *  cache holds the first link, which is what the game's shader warm-up relies on. */
function relink(index: number): CompiledProgram | SkippedProgram {
  relinkContext ??= document.createElement('canvas').getContext('webgl2');
  if (relinkContext === null) throw new Error('no second WebGL 2 context for the relink');
  return compileIn(relinkContext, index, false);
}

Object.assign(globalThis, { shaderProbe: { describe, compile, relink } });
