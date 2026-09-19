import { GlProgram, Shader, type TextureSource, UniformGroup } from 'pixi.js';
import { type ShadowStyle, shadowTintChannels } from '../shadow-style.js';

/**
 * The mesh shader for a batch of flat-decor cast shadows. Decor quads are plain meshes, so they miss the
 * world batch shader that shades a tall object's silhouette; this applies the same gain, ceiling and
 * colour to the silhouette page's coverage, and reproduces the page as authored while the shadow
 * enhancement is off.
 */

const SHADOW_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec2 aUV;
  out vec2 vUV;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
  }
`;

// uShadowAlpha = (gain, ceiling). The output is premultiplied, as the silhouette pages are.
const SHADOW_FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vUV;
  uniform sampler2D uTexture;
  uniform vec4 uColor;
  uniform vec3 uShadowTint;
  uniform vec2 uShadowAlpha;
  out vec4 finalColor;
  void main(void) {
    float alpha = min(texture(uTexture, vUV).a * uShadowAlpha.x, uShadowAlpha.y);
    finalColor = vec4(uShadowTint * alpha, alpha) * uColor;
  }
`;

let program: GlProgram | undefined;

/** One group per layer, shared by every decor shadow mesh, so a style change is a single write. */
export type DecorShadowUniforms = UniformGroup & {
  readonly uniforms: { readonly uShadowTint: Float32Array; readonly uShadowAlpha: Float32Array };
};

/** Starts as the authored silhouette: pure black at the page's own coverage. */
export function makeDecorShadowUniforms(): DecorShadowUniforms {
  return new UniformGroup({
    uShadowTint: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
    uShadowAlpha: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
  }) as DecorShadowUniforms;
}

/** `null` restores the authored silhouette. */
export function writeDecorShadowStyle(group: DecorShadowUniforms, style: ShadowStyle | null): void {
  group.uniforms.uShadowTint.set(shadowTintChannels(style?.tint ?? 0));
  group.uniforms.uShadowAlpha.set([style?.alphaGain ?? 1, style?.maxAlpha ?? 1]);
  group.update();
}

export function makeDecorShadowShader(source: TextureSource, style: DecorShadowUniforms): Shader {
  program ??= new GlProgram({ vertex: SHADOW_VERTEX, fragment: SHADOW_FRAGMENT });
  return new Shader({
    glProgram: program,
    resources: { uTexture: source, uSampler: source.style, shadowStyle: style },
  });
}
