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
  type Texture,
  UniformGroup,
  type ViewContainer,
} from 'pixi.js';
import { PIXEL_ART_MAGNIFY_GLSL } from './pixel-art-magnify.js';

import { isMagnifiedTexture, onPixelArtMagnifyMode, pixelArtMagnifyMode } from './pixel-art-registry.js';

/** One shared uniform: every renderer on the page magnifies the same way. Created on first shader
 *  use so importing this module touches no GPU object. */
let magnifyUniforms: UniformGroup | undefined;

function magnifyGroup(): UniformGroup {
  if (magnifyUniforms === undefined) {
    const group = new UniformGroup({ uWorldMagnify: { value: pixelArtMagnifyMode(), type: 'f32' } });
    onPixelArtMagnifyMode((mode) => {
      if (group.uniforms.uWorldMagnify === mode) return;
      group.uniforms.uWorldMagnify = mode;
      group.update();
    });
    magnifyUniforms = group;
  }
  return magnifyUniforms;
}

/** Pixi hard-codes its default batcher per instruction set; a world sprite opts into this one by name. */
const WORLD_BATCHER = 'world';

/**
 * Route a sprite's batches through the world batcher. Pixi mints the sprite's batchable record lazily
 * per renderer into `_gpuData`, always named `default`; the proxy renames each record as it lands.
 */
export function worldBatched<T extends ViewContainer>(sprite: T): T {
  sprite._gpuData = new Proxy(sprite._gpuData, {
    set(target, key, value: unknown) {
      if (typeof value === 'object' && value !== null && 'batcherName' in value) {
        (value as { batcherName: string }).batcherName = WORLD_BATCHER;
      }
      return Reflect.set(target, key, value);
    },
  });
  return sprite;
}

/** x, y, u, v, colour, textureIdAndRound (Pixi's six) + magnify flag + the frame's UV box. */
const VERTEX_SIZE = 11;
const STRIDE = VERTEX_SIZE * 4;

type WorldBatcherClass = new (options: BatcherOptions) => Batcher;
let worldBatcherClass: WorldBatcherClass | undefined;

/**
 * Pixi's default batcher plus two vertex attributes: whether the element's texture is registered for
 * magnification, and its frame's UV box. Defined on first install, not at import, so a test that mocks
 * `pixi.js` can still load this module.
 */
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
      super({
        attributes: {
          aPosition: { buffer: attributeBuffer, format: 'float32x2', stride: STRIDE, offset: 0 },
          aUV: { buffer: attributeBuffer, format: 'float32x2', stride: STRIDE, offset: 2 * 4 },
          aColor: { buffer: attributeBuffer, format: 'unorm8x4', stride: STRIDE, offset: 4 * 4 },
          aTextureIdAndRound: { buffer: attributeBuffer, format: 'uint16x2', stride: STRIDE, offset: 5 * 4 },
          aMagnify: { buffer: attributeBuffer, format: 'float32', stride: STRIDE, offset: 6 * 4 },
          aFrame: { buffer: attributeBuffer, format: 'float32x4', stride: STRIDE, offset: 7 * 4 },
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
  in float aMagnify;
  in vec4 aFrame;
  out vec4 vColor;
  out vec2 vUV;
  out float vTextureId;
  out float vMagnify;
  out vec4 vFrame;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform vec4 uWorldColorAlpha;
  uniform vec2 uResolution;

  void main(void) {
    vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uWorldColorAlpha;
    vUV = aUV;
    vTextureId = aTextureIdAndRound.y;
    vMagnify = aMagnify;
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

  function fragmentSource(maxTextures: number): string {
    return /* glsl */ `#version 300 es
  precision highp float;
  in vec4 vColor;
  in vec2 vUV;
  in float vTextureId;
  in float vMagnify;
  in vec4 vFrame;
  out vec4 finalColor;
  uniform sampler2D uTextures[${maxTextures}];
  uniform float uWorldMagnify; // 0 sampler filter / 1 sharp / 2 xbr

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
    vec2 uv = (vec2(px) + 0.5) / vec2(textureSizeOf());
    if (any(lessThan(uv, vFrame.xy)) || any(greaterThanEqual(uv, vFrame.zw))) return vec4(0.0);
    return fetchTexel(px);
  }

  #define MAGNIFY_FETCH(px) frameTexel(px)
  ${PIXEL_ART_MAGNIFY_GLSL}

  void main(void) {
    vec4 outColor;
    if (vMagnify > 0.5 && uWorldMagnify > 0.5) {
      vec2 p = vUV * vec2(textureSizeOf());
      float texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
      if (texelsPerPixel < 1.0) {
        outColor = uWorldMagnify > 1.5 ? magnifyXbr(p, texelsPerPixel) : magnifySharp(p, texelsPerPixel);
      } else {
        outColor = sampleTexture(vUV);
      }
    } else {
      outColor = sampleTexture(vUV);
    }
    finalColor = outColor * vColor;
  }`;
  }

  class WorldBatchShader extends Shader {
    constructor(readonly maxTextures: number) {
      super({
        glProgram: new GlProgram({
          name: 'world-batch',
          vertex: VERTEX,
          fragment: fragmentSource(maxTextures),
        }),
        resources: {
          batchSamplers: getBatchSamplersUniformGroup(maxTextures),
          worldMagnify: magnifyGroup(),
        },
      });
    }
  }

  let worldShader: WorldBatchShader | null = null;

  function frameBox(texture: Texture): readonly [number, number, number, number] {
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = texture.uvs;
    return [
      Math.min(x0, x1, x2, x3),
      Math.min(y0, y1, y2, y3),
      Math.max(x0, x1, x2, x3),
      Math.max(y0, y1, y2, y3),
    ];
  }

  class WorldBatcher extends Batcher {
    static extension = { type: [ExtensionType.Batcher], name: WORLD_BATCHER } as const;

    override geometry = new WorldBatchGeometry();
    override shader: WorldBatchShader;
    override name = WorldBatcher.extension.name;
    override vertexSize = VERTEX_SIZE;

    constructor(options: BatcherOptions) {
      super(options);
      worldShader ??= new WorldBatchShader(options.maxTextures);
      this.shader = worldShader;
    }

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
      const magnify = isMagnifiedTexture(element.texture) ? 1 : 0;
      const frame = frameBox(element.texture);
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
        float32View[index++] = magnify;
        float32View[index++] = frame[0];
        float32View[index++] = frame[1];
        float32View[index++] = frame[2];
        float32View[index++] = frame[3];
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
      const magnify = isMagnifiedTexture(texture) ? 1 : 0;
      const frame = frameBox(texture);
      const corners: readonly (readonly [number, number, number, number])[] = [
        [minX, minY, uvs.x0, uvs.y0],
        [maxX, minY, uvs.x1, uvs.y1],
        [maxX, maxY, uvs.x2, uvs.y2],
        [minX, maxY, uvs.x3, uvs.y3],
      ];
      for (const [x, y, u, v] of corners) {
        float32View[index++] = a * x + c * y + tx;
        float32View[index++] = d * y + b * x + ty;
        float32View[index++] = u;
        float32View[index++] = v;
        uint32View[index++] = argb;
        uint32View[index++] = textureIdAndRound;
        float32View[index++] = magnify;
        float32View[index++] = frame[0];
        float32View[index++] = frame[1];
        float32View[index++] = frame[2];
        float32View[index++] = frame[3];
      }
    }

    _updateMaxTextures(maxTextures: number): void {
      if (this.shader.maxTextures === maxTextures) return;
      worldShader = new WorldBatchShader(maxTextures);
      this.shader = worldShader;
    }
  }

  return WorldBatcher;
}

/** Register the `world` batcher; call before the first world sprite is batched. Idempotent. */
export function installWorldBatcher(): void {
  worldBatcherClass ??= defineWorldBatcher();
  extensions.add(worldBatcherClass);
}
