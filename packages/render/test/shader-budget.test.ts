import { describe, expect, it } from 'vitest';
import { PIXEL_ART_MAGNIFY_GLSL } from '../src/gpu/pixel-art-magnify.js';
import { shaderCatalog } from '../src/gpu/shader-catalog.js';
import { fragmentCost } from './support/glsl-cost.js';

/**
 * Texture operations a fragment shader may hold once every function is inlined. The catalogue's
 * dearest programs measure 722 (`world-batch/textures32/*`; the 16-slot variants a Direct3D 11 GPU
 * compiles measure 370). The world batch shader that sampled a page through the whole magnify path
 * inside every branch of its sampler chain measured 16,960 at 16 slots and stalled ANGLE's Direct3D
 * compile for minutes, while Metal compiled it at once; the shape before the one chain pass, a
 * sampler chain in every magnifier tap, measured 2,080 and compiled for about 30 s on a Direct3D
 * software device. The budget is about twice the current maximum.
 */
const FRAGMENT_TEXTURE_OP_BUDGET = 1500;

/** Sampler slots in the synthetic regression, the count WebGL 2 guarantees. */
const REGRESSION_SLOTS = 16;

const catalogue = shaderCatalog();

describe('shader catalogue', () => {
  it('names every program once', () => {
    const names = catalogue.map((entry) => entry.name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  it('gives every program a vertex and a fragment stage', () => {
    const empty = catalogue
      .filter((entry) => entry.vertex.trim() === '' || entry.fragment.trim() === '')
      .map((entry) => entry.name);
    expect(empty).toEqual([]);
  });
});

describe('fragment texture-operation budget', () => {
  it(`keeps every inlined fragment shader within ${FRAGMENT_TEXTURE_OP_BUDGET} texture operations`, () => {
    const costs = catalogue.map((entry) => ({ name: entry.name, ...fragmentCost(entry.fragment) }));
    const table = costs.map((cost) => `${cost.name}: ${cost.textureOps}`).join('\n');
    const over = costs
      .filter((cost) => cost.textureOps > FRAGMENT_TEXTURE_OP_BUDGET)
      .map((cost) => cost.name);
    expect(over, `over budget ${FRAGMENT_TEXTURE_OP_BUDGET}:\n${table}`).toEqual([]);
    // A loop the estimator cannot bound counts once and would hide its real cost.
    expect(costs.flatMap((cost) => cost.unknownLoopBounds.map((loop) => `${cost.name}: ${loop}`))).toEqual(
      [],
    );
  });

  it('rejects the whole magnify path sampled inside every branch of a sampler chain', () => {
    expect(fragmentCost(pageInEveryBranchShader(REGRESSION_SLOTS)).textureOps).toBeGreaterThan(
      FRAGMENT_TEXTURE_OP_BUDGET,
    );
  });
});

/**
 * The shape that froze the Direct3D compile: main picks the page through an if-chain and every branch
 * calls the full sampling path, xBR, sharp and minified bilinear taps, each tap resolving its palette
 * colour through the LUT's own sampler chain. The shared magnify block takes no sampler parameter, so
 * `page` is out of scope there and the source would not compile; the estimator reads only call shape.
 */
function pageInEveryBranchShader(slots: number): string {
  const chain = (slot: string, call: (index: number) => string): string =>
    Array.from(
      { length: slots },
      (_, i) => `${i > 0 ? 'else ' : ''}if (${slot} < ${i}.5) { ${call(i)} }`,
    ).join('\n  ');
  return `#version 300 es
precision highp float;
in vec2 vUV;
flat in float vTextureId;
flat in float vLutSlot;
out vec4 finalColor;
uniform sampler2D uTextures[${slots}];
uniform float uMode;
uniform float uPaletted;
vec2 texSize;

vec4 fetchLut(ivec2 px) {
  ${chain('vLutSlot', (i) => `return texelFetch(uTextures[${i}], px, 0);`)}
  return vec4(0.0);
}

vec4 palettedTexel(sampler2D page, ivec2 px) {
  vec4 texel = texelFetch(page, px, 0);
  return vec4(fetchLut(ivec2(int(texel.r * 255.0), 0)).rgb * texel.a, texel.a);
}

#define MAGNIFY_FETCH(px) palettedTexel(page, px)
${PIXEL_ART_MAGNIFY_GLSL}

vec4 magnified(sampler2D page, vec2 p, float texelsPerPixel) {
  return uMode > 2.5 ? magnifyXbr(p, texelsPerPixel) : magnifySharp(p, texelsPerPixel);
}

vec4 pageColour(sampler2D page, vec2 p, float texelsPerPixel, vec2 footprint) {
  if (texelsPerPixel < 1.0) return magnified(page, p, texelsPerPixel);
  if (uPaletted < 0.5) return texture(page, vUV);
  return 0.25 * (magnifyBilinear(p - footprint) + magnifyBilinear(p + footprint)
               + magnifyBilinear(p + vec2(footprint.x, -footprint.y))
               + magnifyBilinear(p + vec2(-footprint.x, footprint.y)));
}

void main(void) {
  texSize = vec2(textureSize(uTextures[0], 0));
  vec2 p = vUV * texSize;
  float texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
  vec2 footprint = fwidth(p);
  vec4 outColor;
  ${chain('vTextureId', (i) => `outColor = pageColour(uTextures[${i}], p, texelsPerPixel, footprint);`)}
  finalColor = outColor;
}`;
}
