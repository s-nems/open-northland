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
import {
  MATERIAL_COLUMNS,
  MATERIAL_GUTTER,
  MATERIAL_STRIDE,
  MATERIAL_TILE,
  MATERIAL_TILES,
  TRANSITION_CORNERS,
} from './material-layout.js';
import type { OwnTerrainMaterial } from './materials.js';
import { MOUNTAIN_GUTTER, MOUNTAIN_HEIGHT, MOUNTAIN_WIDTH } from './mountain-layout.js';

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
uniform sampler2D uMaterial;
uniform sampler2D uSoil;
uniform vec3 uTint;
uniform vec3 uCorners;
uniform vec4 uSettings;
uniform vec2 uPatch;
out vec4 finalColor;
vec3 meadowPatch(vec2 uv) {
  vec2 offset = vec2(mod(uPatch.y, 2.0), floor(uPatch.y / 2.0));
  vec3 patchColour = texture(uMaterial, (uv + offset) * 0.5).rgb;
  // A shared narrow edge strip joins all four independently painted interiors.
  vec2 edge = 0.5 * (1.0 - smoothstep(vec2(0.0), vec2(0.06), min(uv, 1.0 - uv)));
  vec3 top = mix(texture(uMaterial, uv).rgb,
    texture(uMaterial, vec2(1.0 - uv.x, uv.y)).rgb, edge.x);
  vec3 bottom = mix(texture(uMaterial, vec2(uv.x, 1.0 - uv.y)).rgb,
    texture(uMaterial, 1.0 - uv).rgb, edge.x);
  vec3 edgeColour = mix(top, bottom, edge.y);
  float distanceToEdge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  return mix(edgeColour, patchColour, smoothstep(0.0, 0.10, distanceToEdge));
}
void main() {
  if (uSettings.x > 2.5) {
    // Blend opposite macro edges once at load time; interior ridges keep their generated pixels.
    vec2 uv = fract((vUV * vec2(${MOUNTAIN_WIDTH + MOUNTAIN_GUTTER * 2}.0, ${MOUNTAIN_HEIGHT + MOUNTAIN_GUTTER * 2}.0)
      - ${MOUNTAIN_GUTTER}.0) / vec2(${MOUNTAIN_WIDTH}.0, ${MOUNTAIN_HEIGHT}.0));
    vec2 edge = 0.5 * (1.0 - smoothstep(vec2(0.0), vec2(0.06), min(uv, 1.0 - uv)));
    vec3 top = mix(texture(uMaterial, uv).rgb,
      texture(uMaterial, vec2(1.0 - uv.x, uv.y)).rgb, edge.x);
    vec3 bottom = mix(texture(uMaterial, vec2(uv.x, 1.0 - uv.y)).rgb,
      texture(uMaterial, 1.0 - uv).rgb, edge.x);
    finalColor = vec4(mix(top, bottom, edge.y) * uTint, 1.0);
    return;
  }
  vec2 uv = clamp((vUV * ${MATERIAL_STRIDE}.0 - ${MATERIAL_GUTTER}.0) / ${MATERIAL_TILE}.0, 0.0, 1.0);
  bool laneA = uSettings.x > 1.5 ? uv.x < uv.y : uSettings.x < 0.5;
  vec3 weights = laneA
    ? vec3(1.0 - uv.y, uv.x, uv.y - uv.x)
    : vec3(1.0 - uv.x, uv.x - uv.y, uv.y);
  float coverage = clamp(dot(weights, uCorners), 0.0, 1.0);
  float interior = max(0.0, 27.0 * weights.x * weights.y * weights.z);
  float irregularity = cos(uv.x * 25.132741) * cos(uv.y * 25.132741)
    + 0.35 * cos(uv.x * 50.265482) * cos(uv.y * 50.265482);
  coverage += irregularity * 0.075 * coverage * (1.0 - coverage) * 4.0;
  float alpha = smoothstep(0.28, 0.72, coverage);
  vec2 materialUV = abs(uv * 2.0 - 1.0);
  vec3 colour = texture(uMaterial, materialUV).rgb;
  if (uPatch.x > 0.5) colour = meadowPatch(uv);
  float wear = uSettings.z * uSettings.y * interior * (0.6 + 0.4 * sin(uv.x * 12.566371) * sin(uv.y * 12.566371));
  colour = mix(colour, texture(uSoil, materialUV).rgb, wear);
  colour *= uTint * (1.0 + uSettings.w * interior);
  finalColor = vec4(colour * alpha, alpha);
}`;

export function bakeOwnMaterial(
  renderer: Renderer,
  texture: Texture,
  soil: Texture,
  material: OwnTerrainMaterial,
): Texture {
  const mountain = material.layout === 'mountain';
  const target = RenderTexture.create({
    width: mountain ? MOUNTAIN_WIDTH + 2 * MOUNTAIN_GUTTER : MATERIAL_COLUMNS * MATERIAL_STRIDE,
    height: mountain
      ? MOUNTAIN_HEIGHT + 2 * MOUNTAIN_GUTTER
      : Math.ceil(MATERIAL_TILES / MATERIAL_COLUMNS) * MATERIAL_STRIDE,
    resolution: 1,
  });
  target.source.scaleMode = 'linear';
  target.source.autoGenerateMipmaps = true;
  const program = new GlProgram({ vertex, fragment });
  const geometry = new MeshGeometry({
    positions: new Float32Array([
      0,
      0,
      MATERIAL_STRIDE,
      0,
      MATERIAL_STRIDE,
      MATERIAL_STRIDE,
      0,
      MATERIAL_STRIDE,
    ]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  const container = new Container();
  const shaders: Shader[] = [];
  for (let tile = 0; tile < (mountain ? 1 : MATERIAL_TILES); tile++) {
    const overlay = tile >= 4;
    const pair = (tile - 4) % 6;
    const lane = overlay && (tile - 4) % 12 >= 6 ? 'b' : 'a';
    const corners = overlay ? TRANSITION_CORNERS[lane][pair] : [1, 1, 1];
    const variant = overlay ? Math.floor((tile - 4) / 12) : tile;
    const shader = new Shader({
      glProgram: program,
      resources: {
        uMaterial: texture.source,
        uSoil: soil.source,
        tile: {
          uTint: { value: new Float32Array(material.tint), type: 'vec3<f32>' },
          uCorners: { value: new Float32Array(corners ?? [1, 1, 1]), type: 'vec3<f32>' },
          uPatch: {
            value: new Float32Array([material.sampling === 'patches' ? 1 : 0, variant]),
            type: 'vec2<f32>',
          },
          uSettings: {
            value: new Float32Array([
              mountain ? 3 : overlay ? (lane === 'a' ? 0 : 1) : 2,
              overlay ? 0 : variant / 3,
              material.wear,
              overlay ? variant * 0.025 : (variant - 1.5) * 0.02,
            ]),
            type: 'vec4<f32>',
          },
        },
      },
    });
    shaders.push(shader);
    const mesh = new Mesh({ geometry, shader });
    if (mountain) mesh.scale.set(target.width / MATERIAL_STRIDE, target.height / MATERIAL_STRIDE);
    mesh.position.set(
      (tile % MATERIAL_COLUMNS) * MATERIAL_STRIDE,
      Math.floor(tile / MATERIAL_COLUMNS) * MATERIAL_STRIDE,
    );
    container.addChild(mesh);
  }
  renderer.render({ container, target, clear: true });
  target.source.updateMipmaps();
  container.destroy({ children: true });
  geometry.destroy();
  for (const shader of shaders) shader.destroy();
  program.destroy();
  return target;
}
