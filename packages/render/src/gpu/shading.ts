import { GlProgram, Shader, type TextureSource } from 'pixi.js';
import { BRIGHTNESS_NEUTRAL } from '../data/brightness.js';

/**
 * The custom mesh shaders for the brightness-shaded ground and decor — the stock textured-mesh draw
 * plus the baked `embr` multiplier (`data/brightness.ts`). Needed because Pixi's built-in mesh shader
 * has no per-vertex/per-fragment shading lane, and a per-mesh `tint` cannot vary across a chunk —
 * while the lane both darkens (slope shadow, the border fade to 0) and BRIGHTENS (values > 127, up to
 * ≈2×; the measured curve), so the multiplier must ride unclamped and the framebuffer write clamps.
 *
 * Two variants share one idea, two sampling grains:
 *  - **field** ({@link makeShadedTerrainShader}) — the GROUND mesh samples the whole lane per
 *    FRAGMENT from an R8 texture at each vertex's own cell-centre coordinate
 *    (`data/terrain.ts` {@link import('../data/terrain.js').nodeLaneUV}, interpolated across the
 *    triangle). The texture's own bilinear between those texel centres reproduces the original's
 *    smooth per-pixel banding (the map-border fade, the rock hill) instead of a per-vertex zigzag
 *    along triangle edges.
 *  - **per-vertex** ({@link makeShadedDecorShader}) — a DECOR quad batch carries one constant
 *    multiplier per quad (`aBrightness`, its anchor cell's value); a flat decal has no cell-space
 *    UV lattice to interpolate, and the anchor-constant is the recorded approximation.
 *
 * Batching stays intact: these swap the shader of the existing one-mesh-per-page-per-chunk draws —
 * same mesh count, same draw calls, no per-sprite filters (packages/render/AGENTS.md). Unlike
 * `PalettedSprite`, these meshes DO ride the scene-graph camera transform: for a custom mesh shader
 * Pixi's `GlMeshAdaptor` binds the renderer's global uniforms (`uProjectionMatrix`,
 * `uWorldTransformMatrix`) and the mesh-pipe locals (`uTransformMatrix`, `uColor`) onto the shader's
 * groups, so declaring them as loose uniforms is enough (the official Pixi v8 mesh-and-shaders
 * pattern). The explicit "#version 300 es" matters: GlProgram only runs its ES-300 preprocessing
 * (version header, precision insertion) when the fragment source already carries the directive.
 */

/** GLSL for `mvp` + UV pass-through shared by both variants (the extra varying differs). */
const matrixBlock = `
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
`;

const FIELD_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec2 aUV;
  in vec2 aBrightnessUV;

  out vec2 vUV;
  out vec2 vBrightnessUV;
  ${matrixBlock}
  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vBrightnessUV = aBrightnessUV;
  }
`;

// texel.r is the raw lane byte / 255; the measured curve is byte / BRIGHTNESS_NEUTRAL — one constant
// rescale. uColor is the mesh-pipe group colour (premultiplied tint·alpha) the stock shader applies.
const FIELD_FRAGMENT = `#version 300 es
  in vec2 vUV;
  in vec2 vBrightnessUV;

  uniform sampler2D uTexture;
  uniform sampler2D uBrightnessTex;
  uniform vec4 uColor;

  out vec4 finalColor;

  void main(void) {
    vec4 texel = texture(uTexture, vUV);
    float lane = texture(uBrightnessTex, vBrightnessUV).r * ${(255 / BRIGHTNESS_NEUTRAL).toFixed(8)};
    // Unclamped multiply: > 1 brightens (the lane's 128..255 half); the FB write clamps per channel.
    finalColor = vec4(texel.rgb * lane, texel.a) * uColor;
  }
`;

const VERTEX_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec2 aUV;
  in float aBrightness;

  out vec2 vUV;
  out float vBrightness;
  ${matrixBlock}
  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vBrightness = aBrightness;
  }
`;

const VERTEX_FRAGMENT = `#version 300 es
  in vec2 vUV;
  in float vBrightness;

  uniform sampler2D uTexture;
  uniform vec4 uColor;

  out vec4 finalColor;

  void main(void) {
    vec4 texel = texture(uTexture, vUV);
    finalColor = vec4(texel.rgb * vBrightness, texel.a) * uColor;
  }
`;

/** The compiled GL programs, shared process-wide (a Shader per mesh only binds resources). */
let fieldProgram: GlProgram | undefined;
let vertexProgram: GlProgram | undefined;

/**
 * A {@link Shader} for the shaded GROUND mesh: draws `uTexture = source` with the per-fragment lane
 * multiplier sampled from `brightnessTex` (the map's `embr` bytes as an R8 texture, linear-filtered +
 * edge-clamped — the GPU twin of `makeCellSampler`) at the geometry's `aBrightnessUV`. One per
 * mesh/page; the compiled program is shared. WebGL-only, like
 * {@link import('./paletted-sprite.js').PalettedSprite} — the renderer preference is `webgl`
 * (`pixi-app.ts`).
 */
export function makeShadedTerrainShader(source: TextureSource, brightnessTex: TextureSource): Shader {
  fieldProgram ??= new GlProgram({ vertex: FIELD_VERTEX, fragment: FIELD_FRAGMENT });
  return new Shader({
    glProgram: fieldProgram,
    resources: { uTexture: source, uSampler: source.style, uBrightnessTex: brightnessTex },
  });
}

/**
 * A {@link Shader} for a shaded DECOR quad batch: draws `uTexture = source` with the constant
 * per-quad `aBrightness` multiplier (each quad's anchor-cell value). One per mesh/page; the compiled
 * program is shared.
 */
export function makeShadedDecorShader(source: TextureSource): Shader {
  vertexProgram ??= new GlProgram({ vertex: VERTEX_VERTEX, fragment: VERTEX_FRAGMENT });
  return new Shader({
    glProgram: vertexProgram,
    resources: { uTexture: source, uSampler: source.style },
  });
}

/**
 * Pad a row-major per-cell byte lane so each row is a multiple of `alignment` texels, REPLICATING the
 * last column into the padding. WebGL uploads with the default UNPACK_ALIGNMENT of 4 (Pixi never
 * lowers it), so an unpadded odd-width R8 grid would shear row by row; the replica columns keep the
 * right-edge clamp semantics identical to the CPU sampler (`data/cell-field.ts` `makeCellSampler`).
 * Pure — exported so the shear regression stays headlessly testable.
 */
export function padLaneRows(
  values: readonly number[],
  width: number,
  height: number,
  alignment: number,
): { readonly data: Uint8Array; readonly paddedWidth: number } {
  const paddedWidth = Math.ceil(width / alignment) * alignment;
  const data = new Uint8Array(paddedWidth * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < paddedWidth; c++) {
      data[r * paddedWidth + c] = values[r * width + Math.min(c, width - 1)] ?? 0;
    }
  }
  return { data, paddedWidth };
}
