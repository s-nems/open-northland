import { Shader, type TextureSource, UniformGroup } from 'pixi.js';
import { type GlslProgramSource, glProgramFor } from '../shaders/program-source.js';
import { pageChain, pageSamplerDeclarations, pageSamplerResources } from '../terrain/page-samplers.js';
import {
  SHADOW_BLUR_KERNEL,
  SHADOW_BLUR_KERNEL_SUM,
  SHADOW_BLUR_RADIUS,
} from '../textures/soft-shadow-cache.js';
import { type ShadowStyle, shadowTintChannels } from '../world-batch/shadow-style.js';
import {
  DECOR_CLIP_HIDDEN_POSITION,
  DECOR_CLIP_VERTEX_DECLARATIONS,
  type DecorClipBinding,
} from './decor-clip.js';

/**
 * The mesh shader for a batch of flat-decor cast shadows. Decor quads are plain meshes, so they miss both
 * the world batch shader that shades a tall object's silhouette and the per-frame soft bake behind it.
 * This applies the same gain, ceiling and colour to the silhouette page's coverage and softens it with
 * the bake's own kernel, and reproduces the page as authored while the shadow enhancement is off.
 *
 * A quad is wider than its frame by the blur's reach, so `aFrame` (the frame's texel bounds, min then
 * max) keeps every read inside the frame: atlas neighbours sit closer than the blur reaches.
 */

const SHADOW_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec2 aUV;
  in vec4 aFrame;
  in float aPage;
  in vec2 aAnchor;
  out vec2 vUV;
  flat out vec4 vFrame;
  flat out float vPage;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  ${DECOR_CLIP_VERTEX_DECLARATIONS}
  void main(void) {
    vec2 position = aPosition;
    vec2 uv = aUV;
    vec4 bounds = aFrame;
    if (aClip.y != 0.0 && !decorClipVertex(aClip, aAnchor, position, uv, bounds)) {
      gl_Position = ${DECOR_CLIP_HIDDEN_POSITION};
      return;
    }
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(position, 1.0)).xy, 0.0, 1.0);
    vUV = uv;
    vFrame = bounds;
    vPage = aPage;
  }
`;

const glslFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

/** The kernel with a zero tap on either side: a linear blend of two neighbouring blurred texels weighs
 *  source texel `j` by `mix(padded[j + 1], padded[j], fraction)`. */
const PADDED_KERNEL = [0, ...SHADOW_BLUR_KERNEL, 0];
const FOOTPRINT_TAPS = SHADOW_BLUR_KERNEL.length + 1;

// uShadowAlpha = (gain, ceiling). The output is premultiplied, as the silhouette pages are.
// The soft coverage is the bake's blur followed by its linear magnification, evaluated per fragment: the
// blurred silhouette at the two texels around the fragment, blended by the fragment's offset between them.
const SHADOW_FRAGMENT = `#version 300 es
  precision highp float;
  precision highp int;
  in vec2 vUV;
  flat in vec4 vFrame;
  flat in float vPage;
${pageSamplerDeclarations()}
  uniform vec4 uColor;
  uniform vec3 uShadowTint;
  uniform vec2 uShadowAlpha;
  uniform float uShadowSoft;
  out vec4 finalColor;

  const int TAPS = ${FOOTPRINT_TAPS};
  const int RADIUS = ${SHADOW_BLUR_RADIUS};
  const float KERNEL_SUM = ${glslFloat(SHADOW_BLUR_KERNEL_SUM)};
  const float PADDED_KERNEL[${PADDED_KERNEL.length}] = float[${PADDED_KERNEL.length}](${PADDED_KERNEL.map(glslFloat).join(', ')});

  float tapWeight(int tap, float fraction) {
    return mix(PADDED_KERNEL[tap + 1], PADDED_KERNEL[tap], fraction) / KERNEL_SUM;
  }

  // The page's size in texels and its authored coverage at the fragment. dx and dy are vUV's
  // derivatives, taken before the page chain (see pageChain).
  void readPage(sampler2D page, vec2 dx, vec2 dy, out vec2 size, out float authored) {
    // Atlas pages load at resolution 1, so the page's pixel size is the size the UVs were divided by.
    size = vec2(textureSize(page, 0));
    authored = textureGrad(page, vUV, dx, dy).a;
  }

  // The window's texels weighed and summed, the only blur work inside the page chain: Direct3D inlines
  // the chain's statement once per page, so the weights are worked out once before it. A skipped tap is
  // guarded rather than continued past, which compiled twice as fast there.
  float blurPage(sampler2D page, ivec2 first, float columnWeights[TAPS], float rowWeights[TAPS]) {
    ivec2 lowest = ivec2(vFrame.xy);
    ivec2 highest = ivec2(vFrame.zw) - 1;
    float coverage = 0.0;
    for (int row = 0; row < TAPS; row++) {
      int y = first.y + row;
      if (y >= lowest.y && y <= highest.y) {
        float rowCoverage = 0.0;
        for (int column = 0; column < TAPS; column++) {
          int x = first.x + column;
          if (x >= lowest.x && x <= highest.x) {
            rowCoverage += columnWeights[column] * texelFetch(page, ivec2(x, y), 0).a;
          }
        }
        coverage += rowWeights[row] * rowCoverage;
      }
    }
    return coverage;
  }

  void main(void) {
    vec2 uvDx = dFdx(vUV);
    vec2 uvDy = dFdy(vUV);
    vec2 size;
    float authored;
${pageChain('readPage(uPage$, uvDx, uvDy, size, authored);')}
    vec2 texel = vUV * size;
    bool inFrame = all(greaterThanEqual(texel, vFrame.xy)) && all(lessThan(texel, vFrame.zw));
    float coverage = inFrame ? authored : 0.0;
    if (uShadowSoft > 0.5) {
      vec2 centred = texel - 0.5;
      vec2 base = floor(centred);
      vec2 fraction = centred - base;
      float columnWeights[TAPS];
      float rowWeights[TAPS];
      for (int tap = 0; tap < TAPS; tap++) {
        columnWeights[tap] = tapWeight(tap, fraction.x);
        rowWeights[tap] = tapWeight(tap, fraction.y);
      }
      ivec2 first = ivec2(base) - RADIUS;
${pageChain('coverage = blurPage(uPage$, first, columnWeights, rowWeights);')}
    }
    float alpha = min(coverage * uShadowAlpha.x, uShadowAlpha.y);
    finalColor = vec4(uShadowTint * alpha, alpha) * uColor;
  }
`;

export const DECOR_SHADOW_SOURCE: GlslProgramSource = {
  name: 'decor-shadow',
  vertex: SHADOW_VERTEX,
  fragment: SHADOW_FRAGMENT,
};

/** One group per layer, shared by every decor shadow mesh, so a style change is a single write. */
export type DecorShadowUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uShadowTint: Float32Array;
    readonly uShadowAlpha: Float32Array;
    uShadowSoft: number;
  };
};

/** Starts as the authored silhouette: pure black at the page's own coverage, hard-edged. */
export function makeDecorShadowUniforms(): DecorShadowUniforms {
  return new UniformGroup({
    uShadowTint: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
    uShadowAlpha: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uShadowSoft: { value: 0, type: 'f32' },
  }) as DecorShadowUniforms;
}

/** `null` restores the authored silhouette. */
export function writeDecorShadowStyle(group: DecorShadowUniforms, style: ShadowStyle | null): void {
  group.uniforms.uShadowTint.set(shadowTintChannels(style?.tint ?? 0));
  group.uniforms.uShadowAlpha.set([style?.alphaGain ?? 1, style?.maxAlpha ?? 1]);
  group.uniforms.uShadowSoft = style === null ? 0 : 1;
  group.update();
}

export function makeDecorShadowShader(
  pages: readonly TextureSource[],
  style: DecorShadowUniforms,
  clips: DecorClipBinding,
): Shader {
  const samplers = pageSamplerResources(pages);
  return new Shader({
    glProgram: glProgramFor(DECOR_SHADOW_SOURCE),
    resources: {
      ...samplers,
      uSampler: (samplers.uPage0 as TextureSource).style,
      shadowStyle: style,
      decorClipVars: clips.uniforms,
      uDecorFrames: clips.table.source,
    },
  });
}
