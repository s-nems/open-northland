import type { SceneTerrain, TerrainTextureSet } from '@open-northland/render';
import {
  Container,
  GlProgram,
  Mesh,
  MeshGeometry,
  type Renderer,
  RenderTexture,
  Shader,
  type Texture,
} from 'pixi.js';

const TILE = 128;
const PHASES = 4;
const PATTERNS = 16 * PHASES * PHASES;
const ATLAS_COLUMNS = 16;
const GUTTER = 8;
const STRIDE = TILE + GUTTER * 2;

// Review-only material coverage, interpolated on the renderer's two triangles; not decoded map rules.
export function reviewTerrain(width: number, height: number): SceneTerrain {
  const soilAt = (hx: number, hy: number): number => {
    const x = hx * 34;
    const y = hy * 19;
    const centre = 440 - 50 * Math.min(1, Math.max(0, (y - 360) / 160));
    const path = Math.abs(x - centre) < 65 && y > 260;
    const yard = x > 335 && x < 535 && y > 265 && y < 400;
    return path || yard ? 1 : 0;
  };
  const lanes = Array.from({ length: width * height }, (_, index) => {
    const row = Math.floor(index / width);
    const hx = 2 * (index % width) + (row & 1);
    const hy = 2 * row;
    const phase = ((index % width) % PHASES) + (row % PHASES) * PHASES;
    return (
      phase * 16 +
      (soilAt(hx, hy) |
        (soilAt(hx + 2, hy) << 1) |
        (soilAt(hx + 1, hy + 2) << 2) |
        (soilAt(hx - 1, hy + 2) << 3))
    );
  });
  return {
    width,
    height,
    typeIds: lanes.map(() => 2),
    ground: {
      patterns: Array.from({ length: PATTERNS }, (_, index) => `grass-soil-${index}`),
      a: lanes,
      b: lanes,
    },
  };
}

const vertex = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
out vec2 vUV;
void main() {
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const fragment = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uGrass;
uniform sampler2D uSoil;
uniform vec4 uCorners;
uniform vec2 uOrigin;
out vec4 finalColor;
void main() {
  vec2 uv = clamp((vUV * ${STRIDE}.0 - ${GUTTER}.0) / ${TILE}.0, 0.0, 1.0);
  float coverage = uv.x < uv.y
    ? uCorners.x * (1.0 - uv.y) + uCorners.z * uv.x + uCorners.w * (uv.y - uv.x)
    : uCorners.x * (1.0 - uv.x) + uCorners.y * (uv.x - uv.y) + uCorners.z * uv.y;
  vec2 world = uOrigin + vec2(uv.x - uv.y * 0.5, uv.y);
  vec2 materialUV = abs(fract(world * 0.25) * 2.0 - 1.0);
  float irregularity = sin(world.x * 18.849556) * sin(world.y * 25.132741)
    + 0.5 * sin((world.x + world.y) * 43.982297);
  coverage += irregularity * 0.12 * coverage * (1.0 - coverage) * 4.0;
  vec4 grass = texture(uGrass, materialUV);
  vec4 soil = texture(uSoil, materialUV);
  float variation = sin(world.x * 1.5707963) * sin(world.y * 1.5707963);
  grass.rgb *= 1.0 + variation * 0.06;
  finalColor = mix(grass, soil, smoothstep(0.36, 0.64, coverage));
}`;

export function reviewTerrainTextures(renderer: Renderer, grass: Texture, soil: Texture): TerrainTextureSet {
  const target = RenderTexture.create({
    width: STRIDE * ATLAS_COLUMNS,
    height: STRIDE * ATLAS_COLUMNS,
    resolution: 1,
  });
  target.source.scaleMode = 'linear';
  target.source.autoGenerateMipmaps = true;
  const container = new Container();
  const program = new GlProgram({ vertex, fragment });
  const shaders: Shader[] = [];
  for (let variant = 0; variant < PATTERNS; variant++) {
    const phase = Math.floor(variant / 16);
    const phaseRow = Math.floor(phase / PHASES);
    const shader = new Shader({
      glProgram: program,
      resources: {
        uGrass: grass.source,
        uSoil: soil.source,
        tile: {
          uOrigin: {
            value: new Float32Array([(phase % PHASES) + (phaseRow & 1) * 0.5, phaseRow]),
            type: 'vec2<f32>',
          },
          uCorners: {
            value: new Float32Array([1, 2, 4, 8].map((bit) => (variant & bit ? 1 : 0))),
            type: 'vec4<f32>',
          },
        },
      },
    });
    shaders.push(shader);
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, STRIDE, 0, STRIDE, STRIDE, 0, STRIDE]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const mesh = new Mesh({ geometry, shader });
    mesh.position.set((variant % ATLAS_COLUMNS) * STRIDE, Math.floor(variant / ATLAS_COLUMNS) * STRIDE);
    container.addChild(mesh);
  }
  renderer.render({ container, target, clear: true });
  target.source.updateMipmaps();
  container.destroy({ children: true });
  for (const shader of shaders) shader.destroy();
  program.destroy();
  return {
    pages: new Map([['grass-soil', target.source]]),
    cellFor: () => undefined,
    groundFor: (name) => {
      const match = /^grass-soil-(\d+)$/.exec(name);
      if (!match) return undefined;
      const variant = Number(match[1]);
      if (variant < 0 || variant >= PATTERNS) return undefined;
      const x = (variant % ATLAS_COLUMNS) * STRIDE + GUTTER;
      const y = Math.floor(variant / ATLAS_COLUMNS) * STRIDE + GUTTER;
      return {
        pageKey: 'grass-soil',
        coordsA: [x, y, x + TILE, y + TILE, x, y + TILE],
        coordsB: [x, y, x + TILE, y, x + TILE, y + TILE],
      };
    },
  };
}
