import { describe, expect, it } from 'vitest';
import { PIXEL_ART_MAGNIFY_GLSL } from '../../../src/gpu/pixel-art/magnify.js';
import { shaderCatalog } from '../../../src/gpu/shaders/catalog.js';
import { expandedSource, fragmentCost, functionDefinitions } from '../../support/glsl-cost.js';

/**
 * Texture operations a fragment shader may hold once every function is inlined. The catalogue's
 * dearest programs measure 1412 (`world-batch/textures32/*`, its 2x2 window loop counted four times;
 * the 16-slot variants a Direct3D 11 GPU compiles measure 724). The world batch shader that sampled a page through the whole magnify path
 * inside every branch of its sampler chain measured 16,960 at 16 slots and stalled ANGLE's Direct3D
 * compile for minutes, while Metal compiled it at once; the shape before the one chain pass, a
 * sampler chain in every magnifier tap, measured 2,080 and compiled for about 30 s on a Direct3D
 * software device. The budget sits just above the current maximum, under that shape.
 */
const FRAGMENT_TEXTURE_OP_BUDGET = 1500;

/**
 * Inlined function calls the paged ground programs may hold. Each picks its page through an eight-way
 * if-chain; only the page reads run inside it and the shading, weather cover included, runs once
 * after. Shading inside every branch measured 672 calls for `shaded-terrain` and 192 for
 * `shaded-decor`; the split shape measures 106 and 39. Each budget is about half again its figure.
 */
const PAGED_PROGRAM_CALL_BUDGETS: Readonly<Record<string, number>> = {
  'shaded-terrain': 160,
  'shaded-decor': 60,
};

/** Sampler slots in the synthetic regression, the count WebGL 2 guarantees. */
const REGRESSION_SLOTS = 16;

/** A fragment shader that picks its page through an if-chain on a varying: the world batch's
 *  `uTextures[]`, or a paged mesh's `uPage<n>`, which its functions take as a sampler parameter. */
const SAMPLER_CHAIN = /\buTextures\s*\[|\buniform\s+sampler2D\s+uPage0\b/;
/** GLSL ES 3.00 reads whose level comes from implicit derivatives, with the sampler they read. */
const IMPLICIT_LOD_READ =
  /\b(?:texture|textureOffset|textureProj|textureProjOffset)\s*\(\s*([A-Za-z_]\w*)\s*(\[)?/g;
const DERIVATIVE = /\b(?:dFdx|dFdy|fwidth)\s*\(/;
/** A read of a chain's page by name: the world batch's slots or a paged mesh's `uPage<n>`. */
const PAGE_READ = /\buTextures\s*\[|\buPage\d+\b/;

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

  it('keeps the paged ground programs shading once after their page chain', () => {
    const over = Object.entries(PAGED_PROGRAM_CALL_BUDGETS).flatMap(([name, budget]) => {
      const entry = catalogue.find((program) => program.name === name);
      if (entry === undefined) return [`${name}: missing from the catalogue`];
      const calls = fragmentCost(entry.fragment).inlinedFunctionCalls;
      return calls > budget ? [`${name}: ${calls} inlined calls, budget ${budget}`] : [];
    });
    expect(over).toEqual([]);
  });

  it('rejects the whole magnify path sampled inside every branch of a sampler chain', () => {
    expect(fragmentCost(pageInEveryBranchShader(REGRESSION_SLOTS)).textureOps).toBeGreaterThan(
      FRAGMENT_TEXTURE_OP_BUDGET,
    );
  });
});

describe('sampler chains', () => {
  // Direct3D's compiler may move a gradient operation out of the chain's branches, and an
  // implicit-derivative read with it, which fetches every page for each fragment.
  it('read a page only with derivatives taken before the chain, an explicit level or texelFetch', () => {
    const violations = catalogue.flatMap((entry) =>
      chainViolations(entry.fragment).map((violation) => `${entry.name}: ${violation}`),
    );
    expect(violations).toEqual([]);
  });

  it('catches a read through a macro or a renamed parameter, and a derivative in a page function, in a chain branch or in a helper the branch calls', () => {
    const fetch =
      '#define FETCH(page, uv) texture(page, uv)\nvec4 shade(sampler2D page) { return FETCH(page, vUV); }';
    const derivative = 'vec4 shade(sampler2D page) { return textureGrad(page, vUV, dFdx(vUV), dFdy(vUV)); }';
    const helper =
      'vec2 foot() { return dFdx(vUV); }\nvec4 shade(sampler2D page, vec2 dy) { return textureGrad(page, vUV, foot(), dy); }';
    const clean = 'vec4 shade(sampler2D page, vec2 dx, vec2 dy) { return textureGrad(page, vUV, dx, dy); }';
    const before = 'vec2 dx = dFdx(vUV); vec2 dy = dFdy(vUV);';
    expect(chainViolations(pagedShader(fetch, 'shade(uPage$)'))).toEqual(['implicit read of page']);
    expect(chainViolations(pagedShader(derivative, 'shade(uPage$)'))).toEqual(['derivative in shade']);
    expect(chainViolations(pagedShader(clean, 'textureGrad(uPage$, vUV, dFdx(vUV), dFdy(vUV))'))).toEqual([
      'derivative in a chain branch',
    ]);
    expect(chainViolations(pagedShader(helper, 'shade(uPage$, dy)', 'vec2 dy = dFdy(vUV);'))).toEqual([
      'derivative in foot',
    ]);
    expect(chainViolations(pagedShader(clean, 'shade(uPage$, dx, dy)', before))).toEqual([]);
  });
});

/**
 * Implicit-derivative reads of a chain's page, directly or through a function's sampler parameter, and
 * derivatives taken inside a function that takes a page, inside a chain's branch (a block that reads a
 * page itself) or inside any function such a branch reaches, in the source as compiled.
 */
function chainViolations(glsl: string): string[] {
  const code = expandedSource(glsl);
  if (!SAMPLER_CHAIN.test(code)) return [];
  const functions = functionDefinitions(code);
  const byName = new Map(functions.map((definition) => [definition.name, definition]));
  const pageFunctions = functions.filter((definition) => /\bsampler2D\b/.test(definition.parameters));
  const parameters = new Set(
    pageFunctions.flatMap((definition) =>
      Array.from(definition.parameters.matchAll(/\bsampler2D\s+(\w+)/g), (match) => match[1]),
    ),
  );
  const reads = Array.from(code.matchAll(IMPLICIT_LOD_READ), ([, name = '', indexed]) =>
    (name === 'uTextures' && indexed !== undefined) || /^uPage\d+$/.test(name) || parameters.has(name)
      ? [`implicit read of ${name}`]
      : [],
  ).flat();
  const violations = new Set(reads);
  const branches = functions.flatMap((definition) =>
    braceBlocks(definition.body).filter((block) => PAGE_READ.test(ownStatements(block))),
  );
  if (branches.some((block) => DERIVATIVE.test(block))) violations.add('derivative in a chain branch');
  const visited = new Set<string>();
  const visit = (body: string): void => {
    for (const [, callee = ''] of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const definition = byName.get(callee);
      if (definition === undefined || visited.has(callee)) continue;
      visited.add(callee);
      if (DERIVATIVE.test(definition.body)) violations.add(`derivative in ${callee}`);
      visit(definition.body);
    }
  };
  for (const block of branches) visit(block);
  for (const definition of pageFunctions)
    if (DERIVATIVE.test(definition.body)) violations.add(`derivative in ${definition.name}`);
  return [...violations];
}

/** Every balanced `{ ... }` block of `text`, nested ones included, with its braces. */
function braceBlocks(text: string): string[] {
  const blocks: string[] = [];
  const opens: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') opens.push(i);
    else if (text[i] === '}') {
      const open = opens.pop();
      if (open !== undefined) blocks.push(text.slice(open, i + 1));
    }
  }
  return blocks;
}

/** A block's text without its nested blocks: what the block does itself. */
function ownStatements(block: string): string {
  let depth = 0;
  let own = '';
  for (const char of block) {
    if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (depth === 1) own += char;
  }
  return own;
}

/** A two-page fragment shader whose chain runs `call` (with `$` for the page index) on each page, after
 *  `prelude` in main. */
function pagedShader(declarations: string, call: string, prelude = ''): string {
  return `#version 300 es
precision highp float;
uniform sampler2D uPage0;
uniform sampler2D uPage1;
flat in float vPage;
in vec2 vUV;
out vec4 finalColor;
${declarations}
void main(void) {
  ${prelude}
  if (vPage < 0.5) { finalColor = ${call.replace('$', '0')}; }
  else { finalColor = ${call.replace('$', '1')}; }
}`;
}

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
