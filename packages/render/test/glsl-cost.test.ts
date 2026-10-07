import { describe, expect, it } from 'vitest';
import { fragmentCost } from './support/glsl-cost.js';

describe('fragmentCost', () => {
  it('counts every texture operation in main', () => {
    const glsl = `#version 300 es
uniform sampler2D a;
out vec4 color;
void main(void) {
  // texture(a, vec2(0.0)) in a comment does not count
  /* nor texelFetch(a, ivec2(0), 0) here */
  color = texture(a, vec2(0.5)) + texelFetch(a, ivec2(0), 0) + vec4(vec2(textureSize(a, 0)), 0.0, 0.0);
}`;
    expect(fragmentCost(glsl)).toEqual({ textureOps: 3, inlinedFunctionCalls: 0, unknownLoopBounds: [] });
  });

  it('inlines nested function calls at every call site', () => {
    const glsl = `
uniform sampler2D a;
vec4 tap(vec2 uv) { return texture(a, uv); }
vec4 pair(vec2 uv) { return tap(uv) + tap(uv + 1.0); }
void main() { vec4 c = pair(vec2(0.0)) + pair(vec2(1.0)) + tap(vec2(2.0)); }`;
    // main: two pairs (2 taps each) and one tap.
    expect(fragmentCost(glsl)).toEqual({ textureOps: 5, inlinedFunctionCalls: 7, unknownLoopBounds: [] });
  });

  it('expands function-like and object-like macros, honouring #undef', () => {
    const glsl = `
uniform sampler2D a;
#define FETCH(px) texelFetch(a, px, 0)
#define PAIR(x, y) FETCH(ivec2(x, y)) + FETCH(ivec2(y, x))
#define EXTRA texture(a, vec2(0.0))
void main() {
  vec4 c = PAIR(1, (2 + 3)) + EXTRA;
#undef EXTRA
  vec4 EXTRA = c;
}`;
    expect(fragmentCost(glsl).textureOps).toBe(3);
  });

  it('multiplies a function by every branch of an if-chain that calls it', () => {
    const branches = Array.from(
      { length: 4 },
      (_, i) => `if (slot < ${i}.5) { c = heavy(uTextures[${i}]); }`,
    );
    const glsl = `
uniform sampler2D uTextures[4];
vec4 heavy(sampler2D page) { return texture(page, vec2(0.0)) + texture(page, vec2(1.0)); }
void main() {
  vec4 c;
  float slot = 1.0;
  ${branches.join('\n  else ')}
}`;
    expect(fragmentCost(glsl)).toEqual({ textureOps: 8, inlinedFunctionCalls: 4, unknownLoopBounds: [] });
  });

  it('multiplies a literal-bound loop body by its trip count, nested loops included', () => {
    const glsl = `
uniform sampler2D a;
void main() {
  vec4 sum = vec4(0.0);
  for (int j = -1; j <= 2; j++) {
    for (int i = 0; i < 3; i += 1) sum += texture(a, vec2(float(i), float(j)));
  }
  for (int k = 6; k > 0; k -= 2) { sum += texelFetch(a, ivec2(k), 0); }
}`;
    // 4 x 3 bicubic-style taps, then 3 down-stepping fetches.
    expect(fragmentCost(glsl).textureOps).toBe(15);
  });

  it('reads a loop bound from a const int', () => {
    const glsl = `
uniform sampler2D a;
const int TAPS = 6;
float tap(int column) { return texelFetch(a, ivec2(column, 0), 0).a; }
void main() {
  float sum = 0.0;
  for (int row = 0; row < TAPS; row++) { sum += tap(row); }
}`;
    expect(fragmentCost(glsl)).toEqual({ textureOps: 6, inlinedFunctionCalls: 6, unknownLoopBounds: [] });
  });

  it('counts a loop with an unknown bound once and reports it', () => {
    const glsl = `
uniform sampler2D a;
uniform int uCount;
void main() {
  vec4 sum = vec4(0.0);
  for (int i = 0; i < uCount; i++) { sum += texture(a, vec2(float(i))); }
}`;
    expect(fragmentCost(glsl)).toEqual({
      textureOps: 1,
      inlinedFunctionCalls: 0,
      unknownLoopBounds: ['for (int i = 0; i < uCount; i++)'],
    });
  });

  it('lets an overload call another body of its own name', () => {
    const glsl = `
uniform sampler2D a;
float luma(vec3 c) { return c.r + texture(a, c.xy).a; }
float luma(vec4 c) { return luma(c.rgb) * c.a; }
void main() { float y = luma(vec4(1.0)); }`;
    expect(fragmentCost(glsl).textureOps).toBe(1);
  });

  it('ends an unbraced loop body at its braced block, not the first semicolon inside it', () => {
    const glsl = `
uniform sampler2D a;
void main() {
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 4; i++) if (i > 1) { sum += texture(a, vec2(0.0)); sum += texture(a, vec2(1.0)); }
}`;
    expect(fragmentCost(glsl).textureOps).toBe(8);
  });

  it('refuses a recursive call, which GLSL forbids', () => {
    const glsl = `
float down(float x) { return down(x - 1.0); }
void main() { float y = down(1.0); }`;
    expect(() => fragmentCost(glsl)).toThrow(/recursive call to down/);
  });
});
