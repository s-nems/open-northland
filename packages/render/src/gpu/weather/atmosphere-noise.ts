import { BufferImageSource, Geometry, Mesh, type Renderer, RenderTexture, Shader } from 'pixi.js';
import { type GlslProgramSource, glProgramFor } from '../shaders/program-source.js';

/**
 * The value-noise lattice behind the cloud shadows and the mist, read from a texture instead of hashed
 * per pixel. The lattice is hashed once on the GPU with the shader's own `sin` hash, so every device
 * keeps the noise it drew before, then read back and stored as float32 with each texel holding its
 * cell's four corners: one fetch per noise lookup, the cell interpolation unchanged.
 */

/** The noise tiles every this many lattice cells, so the wrapped drift offset is seamless. */
export const ATMOSPHERE_NOISE_PERIOD = 256;

/** A lattice value travels through the RGBA8 readback as a 24-bit fraction in three bytes. */
const BYTE = 256;
const FRACTION_ONE = BYTE * BYTE * BYTE;
const TEXEL_BYTES = 4;
/** Corners per texel: the cell itself, then its right, lower and diagonal neighbours. */
const CORNERS = 4;

const BAKE_VERTEX = `#version 300 es
  in vec2 aPosition;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  }
`;

const BAKE_FRAGMENT = `#version 300 es
  precision highp float;
  // A fragment int defaults to mediump, which some drivers run in 16 bits: the 24-bit fraction needs more.
  precision highp int;
  out vec4 finalColor;
  const float PERIOD = ${ATMOSPHERE_NOISE_PERIOD}.0;
  float hash(vec2 cell) {
    cell = mod(cell, PERIOD);
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  }
  void main(void) {
    uint n = min(uint(hash(floor(gl_FragCoord.xy)) * ${FRACTION_ONE}.0), ${FRACTION_ONE - 1}u);
    finalColor = vec4(vec3(uvec3(n >> 16u, n >> 8u, n) & 255u) / 255.0, 1.0);
  }
`;

export const ATMOSPHERE_NOISE_BAKE_SOURCE: GlslProgramSource = {
  name: 'weather-noise-bake',
  vertex: BAKE_VERTEX,
  fragment: BAKE_FRAGMENT,
};

/**
 * The lattice texels from the bake's readback, `pixels` row-major from framebuffer row 0 as
 * `readPixels` returns them: texel (x, y) holds cells (x, y), (x + 1, y), (x, y + 1) and (x + 1, y + 1),
 * wrapped on the period.
 */
export function latticeCorners(pixels: ArrayLike<number>): Float32Array {
  const period = ATMOSPHERE_NOISE_PERIOD;
  const value = (x: number, y: number): number => {
    const i = ((y % period) * period + (x % period)) * TEXEL_BYTES;
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    return ((r * BYTE + g) * BYTE + b) / FRACTION_ONE;
  };
  const out = new Float32Array(period * period * CORNERS);
  for (let y = 0; y < period; y++) {
    for (let x = 0; x < period; x++) {
      const o = (y * period + x) * CORNERS;
      out[o] = value(x, y);
      out[o + 1] = value(x + 1, y);
      out[o + 2] = value(x, y + 1);
      out[o + 3] = value(x + 1, y + 1);
    }
  }
  return out;
}

/** Hashes the lattice on `renderer`'s GPU and returns it as the texture the atmosphere samples. */
export function bakeAtmosphereNoise(renderer: Renderer): BufferImageSource {
  const period = ATMOSPHERE_NOISE_PERIOD;
  const target = RenderTexture.create({ width: period, height: period, resolution: 1, antialias: false });
  const mesh = new Mesh({
    geometry: new Geometry({
      attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    }),
    shader: new Shader({ glProgram: glProgramFor(ATMOSPHERE_NOISE_BAKE_SOURCE), resources: {} }),
  });
  mesh.scale.set(period, period);
  try {
    renderer.render({ container: mesh, target, clear: true });
    const { pixels } = renderer.extract.pixels(target);
    return new BufferImageSource({
      resource: latticeCorners(pixels),
      width: period,
      height: period,
      format: 'rgba32float',
      // Read with texelFetch only; float32 is not filterable everywhere.
      scaleMode: 'nearest',
      // The fourth corner is a value, not coverage.
      alphaMode: 'no-premultiply-alpha',
    });
  } finally {
    mesh.geometry.destroy(true);
    mesh.shader?.destroy();
    mesh.destroy();
    target.destroy(true);
  }
}
