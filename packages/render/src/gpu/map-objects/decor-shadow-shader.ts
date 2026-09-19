import { GlProgram, Shader, type TextureSource, UniformGroup } from 'pixi.js';
import { type ShadowStyle, shadowTintChannels } from '../shadow-style.js';
import { SHADOW_BLUR_KERNEL, SHADOW_BLUR_KERNEL_SUM, SHADOW_BLUR_RADIUS } from '../soft-shadow-cache.js';

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
  out vec2 vUV;
  flat out vec4 vFrame;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vFrame = aFrame;
  }
`;

const glslFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

/** The kernel with a zero tap on either side: a linear blend of two neighbouring blurred texels weighs
 *  source texel `j` by `mix(padded[j + 1], padded[j], fraction)`. */
const PADDED_KERNEL = [0, ...SHADOW_BLUR_KERNEL, 0];
const FOOTPRINT_TAPS = SHADOW_BLUR_KERNEL.length + 1;

// uShadowAlpha = (gain, ceiling). The output is premultiplied, as the silhouette pages are.
// softCoverage is the bake's blur followed by its linear magnification, evaluated per fragment: the
// blurred silhouette at the two texels around the fragment, blended by the fragment's offset between them.
const SHADOW_FRAGMENT = `#version 300 es
  precision highp float;
  precision highp int;
  in vec2 vUV;
  flat in vec4 vFrame;
  uniform sampler2D uTexture;
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

  float softCoverage(vec2 texel) {
    vec2 centred = texel - 0.5;
    vec2 base = floor(centred);
    vec2 fraction = centred - base;
    ivec2 first = ivec2(base) - RADIUS;
    ivec2 lowest = ivec2(vFrame.xy);
    ivec2 highest = ivec2(vFrame.zw) - 1;
    float coverage = 0.0;
    for (int row = 0; row < TAPS; row++) {
      int y = first.y + row;
      if (y < lowest.y || y > highest.y) continue;
      float rowCoverage = 0.0;
      for (int column = 0; column < TAPS; column++) {
        int x = first.x + column;
        if (x < lowest.x || x > highest.x) continue;
        rowCoverage += tapWeight(column, fraction.x) * texelFetch(uTexture, ivec2(x, y), 0).a;
      }
      coverage += tapWeight(row, fraction.y) * rowCoverage;
    }
    return coverage;
  }

  void main(void) {
    // Atlas pages load at resolution 1, so the page's pixel size is the size the UVs were divided by.
    vec2 texel = vUV * vec2(textureSize(uTexture, 0));
    float authored = texture(uTexture, vUV).a;
    bool inFrame = all(greaterThanEqual(texel, vFrame.xy)) && all(lessThan(texel, vFrame.zw));
    float coverage = uShadowSoft > 0.5 ? softCoverage(texel) : (inFrame ? authored : 0.0);
    float alpha = min(coverage * uShadowAlpha.x, uShadowAlpha.y);
    finalColor = vec4(uShadowTint * alpha, alpha) * uColor;
  }
`;

let program: GlProgram | undefined;

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

export function makeDecorShadowShader(source: TextureSource, style: DecorShadowUniforms): Shader {
  program ??= new GlProgram({ vertex: SHADOW_VERTEX, fragment: SHADOW_FRAGMENT });
  return new Shader({
    glProgram: program,
    resources: { uTexture: source, uSampler: source.style, shadowStyle: style },
  });
}
