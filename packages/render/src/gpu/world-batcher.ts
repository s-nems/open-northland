import {
  Batcher,
  type BatcherOptions,
  Buffer,
  BufferUsage,
  type DefaultBatchableMeshElement,
  type DefaultBatchableQuadElement,
  ExtensionType,
  extensions,
  Geometry,
  GlProgram,
  getBatchSamplersUniformGroup,
  Shader,
  type ViewContainer,
} from 'pixi.js';
import { PIXEL_ART_MAGNIFY_GLSL } from './pixel-art-magnify.js';
import {
  isMagnifiedTexture,
  isShadowTexture,
  pixelArtMagnifyMode,
  worldShadowStyle,
} from './pixel-art-registry.js';
import { type ShadowStyle, shadowTintChannels } from './shadow-style.js';

/** Pixi hard-codes its default batcher per instruction set; a world sprite opts into this one by name. */
const WORLD_BATCHER = 'world';

/** Renames each batchable record Pixi stores on a world sprite; shared by every wrapped sprite. */
const renameBatcher: ProxyHandler<object> = {
  set(target, key, value: unknown) {
    if (typeof value === 'object' && value !== null && 'batcherName' in value) {
      (value as { batcherName: string }).batcherName = WORLD_BATCHER;
    }
    return Reflect.set(target, key, value);
  },
};

function renamed<D extends object>(data: D): D {
  return new Proxy(data, renameBatcher as ProxyHandler<D>);
}

/**
 * Route a sprite's batches through the world batcher. Pixi mints the sprite's batchable record lazily
 * per renderer into `_gpuData`, always named `default`; the proxy renames each record as it lands
 * and is reinstalled when Pixi replaces the whole map on `unload()`.
 */
export function worldBatched<T extends ViewContainer>(sprite: T): T {
  let data = renamed(sprite._gpuData);
  Object.defineProperty(sprite, '_gpuData', {
    configurable: true,
    enumerable: true,
    get: () => data,
    set: (next: T['_gpuData'] | null) => {
      // Pixi only ever assigns a fresh map; a null would be a teardown, left as a no-op.
      if (next !== null) data = renamed(next);
    },
  });
  return sprite;
}

/** Vertex layout: Pixi's six (x, y, u, v, colour, textureIdAndRound) + element flags + frame UV box. */
export const WORLD_VERTEX_SIZE = 11;
const STRIDE = WORLD_VERTEX_SIZE * 4;
export const WORLD_ATTRIBUTE_OFFSETS = {
  aPosition: 0,
  aUV: 2 * 4,
  aColor: 4 * 4,
  aTextureIdAndRound: 5 * 4,
  aFlags: 6 * 4,
  aFrame: 7 * 4,
} as const;

/** `aFlags` bits: what the fragment shader must know about the element's texture. They share one float
 *  rather than growing every world vertex by another attribute. */
export const WORLD_FLAG_MAGNIFY = 1;
export const WORLD_FLAG_SHADOW = 2;
/** The element's page is straight-alpha, so Pixi picks its non-premultiplied blend for this element and
 *  multiplies the colour by alpha itself. */
export const WORLD_FLAG_STRAIGHT_ALPHA = 4;

/** The batcher class, its geometry and shaders are defined on first install, not at import, so a
 *  test that mocks `pixi.js` can still load this module. */
type WorldBatcherClass = new (options: BatcherOptions) => Batcher;
let worldBatcherClass: WorldBatcherClass | undefined;

function defineWorldBatcher(): WorldBatcherClass {
  class WorldBatchGeometry extends Geometry {
    constructor() {
      const attributeBuffer = new Buffer({
        data: new Float32Array(1),
        label: 'world-batch-attributes',
        usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        shrinkToFit: false,
      });
      const indexBuffer = new Buffer({
        data: new Uint32Array(1),
        label: 'world-batch-indices',
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
        shrinkToFit: false,
      });
      const o = WORLD_ATTRIBUTE_OFFSETS;
      super({
        attributes: {
          aPosition: { buffer: attributeBuffer, format: 'float32x2', stride: STRIDE, offset: o.aPosition },
          aUV: { buffer: attributeBuffer, format: 'float32x2', stride: STRIDE, offset: o.aUV },
          aColor: { buffer: attributeBuffer, format: 'unorm8x4', stride: STRIDE, offset: o.aColor },
          aTextureIdAndRound: {
            buffer: attributeBuffer,
            format: 'uint16x2',
            stride: STRIDE,
            offset: o.aTextureIdAndRound,
          },
          aFlags: { buffer: attributeBuffer, format: 'float32', stride: STRIDE, offset: o.aFlags },
          aFrame: { buffer: attributeBuffer, format: 'float32x4', stride: STRIDE, offset: o.aFrame },
        },
        indexBuffer,
      });
    }
  }

  const VERTEX = /* glsl */ `#version 300 es
  precision highp float;
  in vec2 aPosition;
  in vec2 aUV;
  in vec4 aColor;
  in vec2 aTextureIdAndRound;
  in float aFlags;
  in vec4 aFrame;
  out vec4 vColor;
  out vec2 vUV;
  out float vTextureId;
  flat out float vFlags;
  out vec4 vFrame;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform vec4 uWorldColorAlpha;
  uniform vec2 uResolution;

  void main(void) {
    vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uWorldColorAlpha;
    vUV = aUV;
    vTextureId = aTextureIdAndRound.y;
    vFlags = aFlags;
    vFrame = aFrame;
    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    if (aTextureIdAndRound.x == 1.0) {
      gl_Position.xy = (floor(((gl_Position.xy * 0.5 + 0.5) * uResolution) + 0.5) / uResolution) * 2.0 - 1.0;
    }
  }`;

  /** GLSL ES 3.0 indexes sampler arrays only by constants, so every lookup is an if-chain. */
  function textureChain(maxTextures: number, call: (index: number) => string): string {
    const lines: string[] = [];
    for (let i = 0; i < maxTextures; i++) {
      const guard = i < maxTextures - 1 ? `if (vTextureId < ${i}.5) ` : '';
      lines.push(`  ${i > 0 ? 'else ' : ''}${guard}{ ${call(i)} }`);
    }
    return lines.join('\n');
  }

  /** A GLSL float literal: a whole number still needs its decimal point. */
  const glslFloat = (value: number): string => value.toFixed(6);

  /** Replaces a silhouette's own pure black with the style's colour, at its gained coverage. */
  function shadowShadingGlsl(shadow: ShadowStyle | null): { declarations: string; output: string } {
    if (shadow === null) return { declarations: '', output: 'finalColor = outColor * vColor;' };
    const [red, green, blue] = shadowTintChannels(shadow.tint).map(glslFloat);
    return {
      declarations: /* glsl */ `
  const float SHADOW_ALPHA_GAIN = ${glslFloat(shadow.alphaGain)};
  const float SHADOW_MAX_ALPHA = ${glslFloat(shadow.maxAlpha)};
  const vec3 SHADOW_TINT = vec3(${red}, ${green}, ${blue});`,
      // A silhouette carries coverage only, so the element's own colour contributes nothing but its
      // alpha. The premultiply is ours except on a straight-alpha page, whose blend does it instead.
      output: /* glsl */ `if (hasFlag(WORLD_FLAG_SHADOW)) {
      float shadowAlpha = min(outColor.a * SHADOW_ALPHA_GAIN, SHADOW_MAX_ALPHA) * vColor.a;
      float shadowPremultiply = hasFlag(WORLD_FLAG_STRAIGHT_ALPHA) ? 1.0 : shadowAlpha;
      finalColor = vec4(SHADOW_TINT * shadowPremultiply, shadowAlpha);
    } else {
      finalColor = outColor * vColor;
    }`,
    };
  }

  function fragmentSource(maxTextures: number, mode: number, shadow: ShadowStyle | null): string {
    const shading = shadowShadingGlsl(shadow);
    return /* glsl */ `#version 300 es
  precision highp float;
  in vec4 vColor;
  in vec2 vUV;
  in float vTextureId;
  flat in float vFlags;
  in vec4 vFrame;
  out vec4 finalColor;
  uniform sampler2D uTextures[${maxTextures}];
  // 0 off (Pixi's default sampling) / 1 sampler filter + frame-clamped minification / 2 sharp / 3 xbr
  const float WORLD_MAGNIFY = ${mode}.0;
  const float WORLD_FLAG_MAGNIFY = ${WORLD_FLAG_MAGNIFY}.0;
  const float WORLD_FLAG_SHADOW = ${WORLD_FLAG_SHADOW}.0;
  const float WORLD_FLAG_STRAIGHT_ALPHA = ${WORLD_FLAG_STRAIGHT_ALPHA}.0;${shading.declarations}
  vec2 texSize; // the bound page's size, resolved once per fragment

  bool hasFlag(float bit) {
    return mod(floor(vFlags / bit), 2.0) >= 0.5;
  }

  vec4 sampleTexture(vec2 uv) {
  ${textureChain(maxTextures, (i) => `return texture(uTextures[${i}], uv);`)}
  }

  ivec2 textureSizeOf() {
  ${textureChain(maxTextures, (i) => `return textureSize(uTextures[${i}], 0);`)}
  }

  vec4 fetchTexel(ivec2 px) {
  ${textureChain(maxTextures, (i) => `return texelFetch(uTextures[${i}], px, 0);`)}
  }

  // The frame boundary is transparent, not the packed neighbour a two-texel tap could reach.
  vec4 frameTexel(ivec2 px) {
    vec2 uv = (vec2(px) + 0.5) / texSize;
    if (any(lessThan(uv, vFrame.xy)) || any(greaterThanEqual(uv, vFrame.zw))) return vec4(0.0);
    return fetchTexel(px);
  }

  #define MAGNIFY_FETCH(px) frameTexel(px)
  ${PIXEL_ART_MAGNIFY_GLSL}

  void main(void) {
    texSize = vec2(textureSizeOf());
    // Derivatives before any branch: they are only defined in uniform control flow.
    vec2 p = vUV * texSize;
    float texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
    vec2 uvFootprint = fwidth(vUV);
    vec4 outColor;
    if (!hasFlag(WORLD_FLAG_MAGNIFY) || WORLD_MAGNIFY < 0.5) {
      outColor = sampleTexture(vUV);
    } else if (texelsPerPixel < 1.0) {
      outColor = WORLD_MAGNIFY > 2.5 ? magnifyXbr(p, texelsPerPixel)
               : WORLD_MAGNIFY > 1.5 ? magnifySharp(p, texelsPerPixel)
               : sampleTexture(vUV);
    } else {
      // Minified: a 2x2 footprint over the sampler's own filter reduces sparkle, clamped to the frame.
      // Not a mipmap substitute at extreme zoom-out: sampling cost is deliberately bounded.
      vec2 footprint = max(uvFootprint - 1.0 / texSize, vec2(0.0)) * 0.25;
      vec2 low = vFrame.xy + 0.5 / texSize;
      vec2 high = vFrame.zw - 0.5 / texSize;
      outColor = 0.25 * (sampleTexture(clamp(vUV - footprint, low, high))
                       + sampleTexture(clamp(vUV + vec2(footprint.x, -footprint.y), low, high))
                       + sampleTexture(clamp(vUV + vec2(-footprint.x, footprint.y), low, high))
                       + sampleTexture(clamp(vUV + footprint, low, high)));
    }
    ${shading.output}
  }`;
  }

  // Pixi uploads a batch shader's own uniforms only on that Shader object's first bind, so the
  // magnification mode and the shadow shading are compile-time constants instead: one program per
  // combination, shared by every batcher on the page. The shadow values come from a session-fixed
  // setting, so the map holds one or two programs in practice.
  const shaders = new Map<string, Shader>();

  function shadowKey(shadow: ShadowStyle | null): string {
    return shadow === null ? 'off' : `${shadow.alphaGain}/${shadow.maxAlpha}/${shadow.tint.toString(16)}`;
  }

  function shaderFor(maxTextures: number, mode: number, shadow: ShadowStyle | null): Shader {
    const shading = shadowKey(shadow);
    const key = `${maxTextures}:${mode}:${shading}`;
    let shader = shaders.get(key);
    if (shader === undefined) {
      shader = new Shader({
        glProgram: new GlProgram({
          name: `world-batch-${mode}-${shading}`,
          vertex: VERTEX,
          fragment: fragmentSource(maxTextures, mode, shadow),
        }),
        resources: { batchSamplers: getBatchSamplersUniformGroup(maxTextures) },
      });
      shaders.set(key, shader);
    }
    return shader;
  }

  /** The per-element flags the fragment shader branches on; the shadow lookups are skipped entirely
   *  while no shadow shading is compiled in. */
  function elementFlags(texture: DefaultBatchableQuadElement['texture']): number {
    const magnify = isMagnifiedTexture(texture) ? WORLD_FLAG_MAGNIFY : 0;
    if (worldShadowStyle() === null || !isShadowTexture(texture)) return magnify;
    const straight = texture.source.alphaMode === 'no-premultiply-alpha' ? WORLD_FLAG_STRAIGHT_ALPHA : 0;
    return magnify | WORLD_FLAG_SHADOW | straight;
  }

  /** The frame's UV box, written straight into the vertex stream (no per-element allocation). */
  const frame = new Float32Array(4);
  function writeFrame(texture: DefaultBatchableQuadElement['texture']): void {
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = texture.uvs;
    frame[0] = Math.min(x0, x1, x2, x3);
    frame[1] = Math.min(y0, y1, y2, y3);
    frame[2] = Math.max(x0, x1, x2, x3);
    frame[3] = Math.max(y0, y1, y2, y3);
  }

  /** Pixi's default batcher plus two vertex attributes: whether the element's texture is registered
   *  for magnification, and its frame's UV box. */
  class WorldBatcher extends Batcher {
    static extension = { type: [ExtensionType.Batcher], name: WORLD_BATCHER } as const;

    override geometry = new WorldBatchGeometry();
    override name = WorldBatcher.extension.name;
    override vertexSize = WORLD_VERTEX_SIZE;
    /** Served by the prototype accessor below; `declare` keeps it off the instance. */
    declare shader: Shader;

    packAttributes(
      element: DefaultBatchableMeshElement,
      float32View: Float32Array,
      uint32View: Uint32Array,
      index: number,
      textureId: number,
    ): void {
      const textureIdAndRound = (textureId << 16) | (element.roundPixels & 0xffff);
      const { a, b, c, d, tx, ty } = element.transform;
      const { positions, uvs } = element;
      const argb = element.color;
      const flags = elementFlags(element.texture);
      writeFrame(element.texture);
      const end = element.attributeOffset + element.attributeSize;
      for (let i = element.attributeOffset; i < end; i++) {
        const i2 = i * 2;
        const x = positions[i2] ?? 0;
        const y = positions[i2 + 1] ?? 0;
        float32View[index++] = a * x + c * y + tx;
        float32View[index++] = d * y + b * x + ty;
        float32View[index++] = uvs[i2] ?? 0;
        float32View[index++] = uvs[i2 + 1] ?? 0;
        uint32View[index++] = argb;
        uint32View[index++] = textureIdAndRound;
        float32View[index++] = flags;
        float32View.set(frame, index);
        index += 4;
      }
    }

    packQuadAttributes(
      element: DefaultBatchableQuadElement,
      float32View: Float32Array,
      uint32View: Uint32Array,
      index: number,
      textureId: number,
    ): void {
      const texture = element.texture;
      const { a, b, c, d, tx, ty } = element.transform;
      const { minX, minY, maxX, maxY } = element.bounds;
      const uvs = texture.uvs;
      const argb = element.color;
      const textureIdAndRound = (textureId << 16) | (element.roundPixels & 0xffff);
      const flags = elementFlags(texture);
      writeFrame(texture);
      const write = (x: number, y: number, u: number, v: number): void => {
        float32View[index++] = a * x + c * y + tx;
        float32View[index++] = d * y + b * x + ty;
        float32View[index++] = u;
        float32View[index++] = v;
        uint32View[index++] = argb;
        uint32View[index++] = textureIdAndRound;
        float32View[index++] = flags;
        float32View.set(frame, index);
        index += 4;
      };
      write(minX, minY, uvs.x0, uvs.y0);
      write(maxX, minY, uvs.x1, uvs.y1);
      write(maxX, maxY, uvs.x2, uvs.y2);
      write(minX, maxY, uvs.x3, uvs.y3);
    }

    /** The shaders are shared across batchers and outlive any one of them. */
    override destroy(): void {
      super.destroy();
    }
  }

  // `shader` is read per batch execution; resolving it from the current mode there means a live
  // setting change takes effect on the next frame. Pixi's base class never assigns the property.
  Object.defineProperty(WorldBatcher.prototype, 'shader', {
    get(this: WorldBatcher) {
      return shaderFor(this.maxTextures, pixelArtMagnifyMode(), worldShadowStyle());
    },
    set() {}, // Pixi's base class never assigns it; the mode owns the choice
  });

  return WorldBatcher;
}

/** Register the `world` batcher; call before the first world sprite is batched. Idempotent. */
export function installWorldBatcher(): WorldBatcherClass {
  worldBatcherClass ??= defineWorldBatcher();
  extensions.add(worldBatcherClass);
  return worldBatcherClass;
}
