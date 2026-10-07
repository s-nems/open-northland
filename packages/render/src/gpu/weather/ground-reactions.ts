import { BufferImageSource, Geometry, Mesh, Shader, Texture, UniformGroup } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import {
  RAIN_SATURATING_AMOUNT,
  SAND_SATURATING_AMOUNT,
  SNOW_SATURATING_AMOUNT,
} from '../../data/weather/cover.js';
import { WEATHER_SECTOR_NODES, type WeatherField, weatherFieldTexels } from '../../data/weather/field.js';
import { type GlslProgramSource, glProgramFor } from '../program-source.js';
import {
  type GroundBudget,
  RIPPLE_SLOTS,
  SPLASH_SLOTS,
  type WeatherActivity,
  WISP_SLOTS,
} from './ground-budget.js';
import type { GroundMask } from './ground-mask.js';
import { MAP_EDGE_GLSL, NODES_PER_CELL } from './weather-reach.js';

/**
 * The ground reactions as one static mesh of quads whose vertex shader places, ages and gates every
 * quad from uniforms: no per-frame CPU loop and no per-particle state. A slot's life is a hash of
 * (slot, cycle) against game seconds, so pause freezes it and a replay repeats it. A slot rolls a world
 * spot each cycle, wrapped into the view so it holds still while the camera pans, finds the ground under that drawn spot (lifted terrain resolved by two
 * fixed-point steps through the lift mask), and hides unless the weather field there wins its roll:
 * splashes on land, rings on water, wisps where snow or sand lies. Every shape, size, life and
 * colour below is tuned by eye; the whole layer is an Open Northland enhancement.
 */

const SLOT_TOTAL = SPLASH_SLOTS + RIPPLE_SLOTS + WISP_SLOTS;

/** Seconds a slot lives per cycle. */
const SPLASH_LIFE_S = 0.35;
const RIPPLE_LIFE_S = 1.2;
const WISP_LIFE_S = 3.4;
/** Quad sizes in world px. A splash is wider than its crown so wind can lean the droplets. */
const SPLASH_SIZE = [14, 10] as const;
const RIPPLE_SIZE = [18, 10] as const;
const WISP_SIZE = [84, 14] as const;
/** A spot counts as water above this surface fraction, so rings keep off the shore line. */
const WATER_MIN_SURFACE = 0.9;
/** How far wisps travel downwind per second of life, as a share of the wind (ground drag). */
const WISP_WIND_SHARE = 0.9;
/** Wisps drift even in still air, this fast in world px per second. */
const WISP_MIN_DRIFT = 14;
/** Game seconds wrap here so the f32 clock keeps its precision; a multiple of every life. */
const TIME_WRAP_S = 3570;

const f = (value: number): string => value.toFixed(4);

const VERTEX = `#version 300 es
  in vec2 aPosition;
  in float aSlot;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  uniform vec4 uView;
  uniform float uTime;
  uniform vec3 uCounts;
  uniform vec3 uActivity;
  uniform vec2 uWind;
  uniform vec2 uFieldScale;
  uniform vec2 uGroundTexel;
  uniform float uMaxLift;
  // Map size in half-cell nodes.
  uniform vec2 uMapNodes;
  uniform sampler2D uFieldTex;
  uniform sampler2D uGroundTex;
  out vec2 vLocal;
  out float vAge;
  flat out int vKind;
  flat out float vSeed;

  float hash(uint a, uint b) {
    uint n = a * 747796405u + b * 2891336453u + 1013904223u;
    n = ((n >> ((n >> 28u) + 4u)) ^ n) * 277803737u;
    n = (n >> 22u) ^ n;
    return float(n >> 8) * (1.0 / 16777216.0);
  }

  vec2 groundAt(vec2 p) {
    float row = p.y / ${f(TILE_HALF_H)};
    float odd = mod(floor(row + 0.5), 2.0);
    vec2 cell = vec2(p.x / ${f(2 * TILE_HALF_W)} - 0.5 * odd, row);
    return textureLod(uGroundTex, (cell + 0.5) * uGroundTexel, 0.0).rg;
  }

  ${MAP_EDGE_GLSL}

  void hide() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vKind = -1;
  }

  void main(void) {
    int slot = int(aSlot + 0.5);
    int kind;
    int index;
    float life;
    vec2 size;
    if (slot < ${SPLASH_SLOTS}) {
      kind = 0; index = slot; life = ${f(SPLASH_LIFE_S)}; size = vec2(${SPLASH_SIZE.join('.0, ')}.0);
    } else if (slot < ${SPLASH_SLOTS + RIPPLE_SLOTS}) {
      kind = 1; index = slot - ${SPLASH_SLOTS}; life = ${f(RIPPLE_LIFE_S)}; size = vec2(${RIPPLE_SIZE.join('.0, ')}.0);
    } else {
      kind = 2; index = slot - ${SPLASH_SLOTS + RIPPLE_SLOTS}; life = ${f(WISP_LIFE_S)}; size = vec2(${WISP_SIZE.join('.0, ')}.0);
    }
    if (float(index) >= uCounts[kind]) { hide(); return; }
    uint id = uint(slot);
    float t = uTime / life + hash(id, 0u);
    uint cycle = uint(floor(t));
    float age = fract(t);
    // The spot repeats every view size across the world; reducing the view offset first keeps both mod
    // operands view-sized, so f32 holds its precision on large maps.
    vec2 spot = vec2(hash(id, cycle * 3u + 1u), hash(id, cycle * 3u + 2u)) * uView.zw;
    vec2 drawn = uView.xy + mod(spot - mod(uView.xy, uView.zw), uView.zw);
    // The drawn spot shows the ground whose unlifted row lies its lift further down the screen.
    float y = drawn.y;
    for (int i = 0; i < 2; i++) y = drawn.y + groundAt(vec2(drawn.x, y)).g * uMaxLift;
    vec2 ground = groundAt(vec2(drawn.x, y));
    vec3 field = textureLod(uFieldTex, vec2(drawn.x, y) * uFieldScale, 0.0).rgb;
    float roll = hash(id, cycle * 3u + 3u);
    bool water = ground.r > ${f(WATER_MIN_SURFACE)};
    float keep;
    vec2 centre = drawn;
    if (kind == 2) {
      float share = field.g / max(field.g + field.b, 1e-4);
      bool snow = hash(id, cycle * 5u + 7u) < share;
      kind = snow ? 2 : 3;
      keep = snow
        ? min(1.0, field.g / ${f(SNOW_SATURATING_AMOUNT)}) * uActivity.y
        : min(1.0, field.b / ${f(SAND_SATURATING_AMOUNT)}) * uActivity.z;
      vec2 drift = uWind * ${f(WISP_WIND_SHARE)};
      float speed = length(drift);
      if (speed < ${f(WISP_MIN_DRIFT)}) drift = speed > 0.0 ? drift / speed * ${f(WISP_MIN_DRIFT)} : vec2(${f(WISP_MIN_DRIFT)}, 0.0);
      centre += drift * life * (age - 0.5);
      if (water) keep = 0.0;
    } else {
      keep = min(1.0, field.r / ${f(RAIN_SATURATING_AMOUNT)}) * uActivity.x;
      if ((kind == 1) != water) keep = 0.0;
    }
    // No reactions over the void past the map; the fog wash above hides the unexplored ground.
    keep *= mapEdge(vec2(drawn.x / ${f(TILE_HALF_W)}, 2.0 * y / ${f(TILE_HALF_H)}), uMapNodes);
    if (roll >= keep) { hide(); return; }
    vKind = kind;
    vAge = age;
    vSeed = hash(id, cycle * 3u + 4u);
    vLocal = (aPosition - 0.5) * size;
    // Whole world px, like the pixel art underneath.
    vec2 pos = floor(centre) + vLocal;
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(pos, 1.0)).xy, 0.0, 1.0);
  }
`;

const SPLASH_COLOUR = 'vec3(0.84, 0.9, 0.97)';
const RIPPLE_COLOUR = 'vec3(0.82, 0.9, 0.96)';
const SNOW_WISP_COLOUR = 'vec3(1.0, 1.0, 1.0)';
const SAND_WISP_COLOUR = 'vec3(0.98, 0.88, 0.68)';
const SPLASH_ALPHA = 0.4;
/** The spreading ring is fainter than the droplets. */
const SPLASH_RING_ALPHA = 0.7;
/** Share of a splash's life its droplets fly. */
const SPLASH_DROP_LIFE = 0.5;
/** A splash's widest foot ring and the height its middle and outer droplets reach (px): a small
 *  flick of the ground, not a burst. */
const SPLASH_RING_RADIUS_PX = 2.6;
const SPLASH_DROP_RISE_PX = 3.5;
const SPLASH_SIDE_RISE_PX = 2;
/** Droplets drift downwind by the wind (world px/s) times this over their flight, capped (px). */
const SPLASH_WIND_LEAN_S = 0.02;
const SPLASH_MAX_LEAN_PX = 1.5;
/** A water ring's widest radius (px). */
const RIPPLE_RADIUS_PX = 8;
const RIPPLE_ALPHA = 0.4;
const SNOW_WISP_ALPHA = 0.28;
const SAND_WISP_ALPHA = 0.32;
/** A wisp's sideways wave (radians per px along it, amplitude px), thickness and fray frequency. */
const WISP_WAVE_PER_PX = 0.09;
const WISP_WAVE_PX = 2.2;
const WISP_THICKNESS_PX = 1.8;
const WISP_FRAY_PER_PX = 0.14;
/** Ground-plane squash of a ring: the projection draws ground at about half its depth. */
const RING_SQUASH = 2.0;

const FRAGMENT = `#version 300 es
  precision highp float;
  uniform vec2 uWind;
  in vec2 vLocal;
  in float vAge;
  flat in int vKind;
  flat in float vSeed;
  out vec4 finalColor;

  // A squashed ring, its band measured in px across the ring so its top and bottom arcs stay as thick
  // as its sides instead of breaking up on the pixel grid.
  float ring(vec2 p, float radius) {
    vec2 q = p * vec2(1.0, ${f(RING_SQUASH)});
    float d = length(q);
    float slope = length(vec2(q.x, q.y * ${f(RING_SQUASH)})) / max(d, 1e-3);
    return 1.0 - smoothstep(0.35, 1.0, abs(d - radius) / max(slope, 1.0));
  }

  void main(void) {
    if (vKind < 0) discard;
    vec2 p = floor(vLocal) + 0.5;
    float a = vAge;
    vec3 colour;
    float alpha;
    if (vKind == 0) {
      // A crown: a ring spreading at the foot, and two or three droplets thrown up that fall back.
      vec2 foot = p - vec2(0.0, 2.0);
      float body = ring(foot, mix(0.5, ${f(SPLASH_RING_RADIUS_PX)}, a)) * (1.0 - a);
      float drops = 0.0;
      if (a < ${f(SPLASH_DROP_LIFE)}) {
        float d = a / ${f(SPLASH_DROP_LIFE)};
        float lean = clamp(uWind.x * ${f(SPLASH_WIND_LEAN_S)}, -${f(SPLASH_MAX_LEAN_PX)}, ${f(SPLASH_MAX_LEAN_PX)});
        for (int k = 0; k < 3; k++) {
          // The middle droplet leaps highest, the outer two arc low and wide.
          float side = float(k - 1);
          float rise = side == 0.0 ? ${f(SPLASH_DROP_RISE_PX)} : ${f(SPLASH_SIDE_RISE_PX)} + vSeed;
          vec2 drop = vec2((side * (3.0 + vSeed) + (vSeed - 0.5) + lean) * d, 2.0 - rise * 4.0 * d * (1.0 - d));
          drops += 1.0 - step(0.75, length(p - drop));
        }
      }
      alpha = max(body * ${f(SPLASH_RING_ALPHA)}, min(1.0, drops) * (1.0 - a)) * ${f(SPLASH_ALPHA)};
      colour = ${SPLASH_COLOUR};
    } else if (vKind == 1) {
      float outer = ring(p, mix(1.0, ${f(RIPPLE_RADIUS_PX)}, a));
      float inner = a > 0.3 ? ring(p, mix(1.0, ${f(RIPPLE_RADIUS_PX)}, a - 0.3)) * 0.6 : 0.0;
      alpha = max(outer, inner) * pow(1.0 - a, 1.4) * ${f(RIPPLE_ALPHA)};
      colour = ${RIPPLE_COLOUR};
    } else {
      // A wisp: a long thin streak along the wind that fades in and out, frayed along its length.
      vec2 half_ = vec2(${f(WISP_SIZE[0] / 2)}, ${f(WISP_SIZE[1] / 2)});
      float along = 1.0 - pow(abs(p.x) / half_.x, 2.0);
      float wave = sin(p.x * ${f(WISP_WAVE_PER_PX)} + vSeed * 6.2831 + a * 6.0) * ${f(WISP_WAVE_PX)};
      float across = exp(-pow((p.y - wave) / (${f(WISP_THICKNESS_PX)} + vSeed), 2.0));
      float fray = 0.6 + 0.4 * sin(p.x * ${f(WISP_FRAY_PER_PX)} + vSeed * 40.0 - a * 4.0);
      alpha = max(0.0, along) * across * fray * sin(3.14159 * a);
      bool snow = vKind == 2;
      alpha *= snow ? ${f(SNOW_WISP_ALPHA)} : ${f(SAND_WISP_ALPHA)};
      colour = snow ? ${SNOW_WISP_COLOUR} : ${SAND_WISP_COLOUR};
    }
    if (alpha <= 0.004) discard;
    finalColor = vec4(colour * alpha, alpha);
  }
`;

export const GROUND_REACTIONS_SOURCE: GlslProgramSource = {
  name: 'weather-ground-reactions',
  vertex: VERTEX,
  fragment: FRAGMENT,
};

type ReactionUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uView: Float32Array;
    uTime: number;
    readonly uCounts: Float32Array;
    readonly uActivity: Float32Array;
    readonly uWind: Float32Array;
    readonly uFieldScale: Float32Array;
    readonly uGroundTexel: Float32Array;
    uMaxLift: number;
    readonly uMapNodes: Float32Array;
  };
};

function quadGeometry(): Geometry {
  const positions = new Float32Array(SLOT_TOTAL * 8);
  const slots = new Float32Array(SLOT_TOTAL * 4);
  const indices = new Uint32Array(SLOT_TOTAL * 6);
  const corners = [0, 0, 1, 0, 1, 1, 0, 1];
  for (let s = 0; s < SLOT_TOTAL; s++) {
    positions.set(corners, s * 8);
    slots.fill(s, s * 4, s * 4 + 4);
    const v = s * 4;
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3], s * 6);
  }
  return new Geometry({
    attributes: {
      aPosition: { buffer: positions, format: 'float32x2' },
      aSlot: { buffer: slots, format: 'float32' },
    },
    indexBuffer: indices,
  });
}

/** This frame's view of the world, in world px. */
export interface GroundView {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/** The ground reaction mesh; {@link WeatherGround} drives it. */
export class GroundReactions {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly uniforms: ReactionUniforms;
  private fieldTex: BufferImageSource;
  private groundTex: BufferImageSource;

  constructor() {
    this.uniforms = new UniformGroup({
      uView: { value: new Float32Array(4), type: 'vec4<f32>' },
      uTime: { value: 0, type: 'f32' },
      uCounts: { value: new Float32Array(3), type: 'vec3<f32>' },
      uActivity: { value: new Float32Array(3), type: 'vec3<f32>' },
      uWind: { value: new Float32Array(2), type: 'vec2<f32>' },
      uFieldScale: { value: new Float32Array(2), type: 'vec2<f32>' },
      uGroundTexel: { value: new Float32Array(2), type: 'vec2<f32>' },
      uMaxLift: { value: 0, type: 'f32' },
      uMapNodes: { value: new Float32Array(2), type: 'vec2<f32>' },
    }) as ReactionUniforms;
    this.fieldTex = blankTexture('rgba8unorm');
    this.groundTex = blankTexture('rg8unorm');
    const shader = new Shader({
      glProgram: glProgramFor(GROUND_REACTIONS_SOURCE),
      resources: { reactionVars: this.uniforms, uFieldTex: this.fieldTex, uGroundTex: this.groundTex },
    });
    this.mesh = new Mesh({ geometry: quadGeometry(), shader, texture: Texture.WHITE });
    this.mesh.visible = false;
  }

  setField(field: WeatherField): void {
    this.fieldTex = this.replace(
      this.fieldTex,
      'uFieldTex',
      new BufferImageSource({
        resource: weatherFieldTexels(field),
        width: field.sectorsX,
        height: field.sectorsY,
        scaleMode: 'linear',
        addressMode: 'clamp-to-edge',
      }),
    );
    // World px of the unlifted ground to field UV: node = (x / HALF_W, 2y / HALF_H).
    const scale = this.uniforms.uniforms.uFieldScale;
    scale[0] = 1 / (TILE_HALF_W * field.sectorsX * WEATHER_SECTOR_NODES);
    scale[1] = 2 / (TILE_HALF_H * field.sectorsY * WEATHER_SECTOR_NODES);
    this.uniforms.update();
  }

  setGround(mask: GroundMask): void {
    this.groundTex = this.replace(
      this.groundTex,
      'uGroundTex',
      new BufferImageSource({
        resource: mask.data,
        width: mask.texWidth,
        height: Math.max(1, mask.height),
        format: 'rg8unorm',
        scaleMode: 'linear',
        addressMode: 'clamp-to-edge',
      }),
    );
    const u = this.uniforms.uniforms;
    u.uGroundTexel[0] = 1 / mask.texWidth;
    u.uGroundTexel[1] = 1 / Math.max(1, mask.height);
    u.uMaxLift = mask.maxLift;
    u.uMapNodes[0] = mask.width * NODES_PER_CELL;
    u.uMapNodes[1] = mask.height * NODES_PER_CELL;
    this.uniforms.update();
  }

  /** Point this frame's reactions at `view`; an empty budget hides the mesh. */
  draw(
    view: GroundView,
    budget: GroundBudget,
    activity: WeatherActivity,
    windX: number,
    windY: number,
    gameSeconds: number,
  ): void {
    const running = budget.splashes + budget.ripples + budget.wisps > 0;
    this.mesh.visible = running;
    if (!running) return;
    const u = this.uniforms.uniforms;
    u.uView[0] = view.minX;
    u.uView[1] = view.minY;
    u.uView[2] = view.width;
    u.uView[3] = view.height;
    u.uTime = ((gameSeconds % TIME_WRAP_S) + TIME_WRAP_S) % TIME_WRAP_S;
    u.uCounts[0] = budget.splashes;
    u.uCounts[1] = budget.ripples;
    u.uCounts[2] = budget.wisps;
    u.uActivity[0] = activity.rain;
    u.uActivity[1] = activity.snow;
    u.uActivity[2] = activity.sand;
    u.uWind[0] = windX;
    u.uWind[1] = windY;
    this.uniforms.update();
  }

  hide(): void {
    this.mesh.visible = false;
  }

  destroy(): void {
    const { geometry, shader } = this.mesh;
    this.mesh.destroy();
    geometry.destroy();
    shader?.destroy();
    this.fieldTex.destroy();
    this.groundTex.destroy();
  }

  private replace(previous: BufferImageSource, name: string, next: BufferImageSource): BufferImageSource {
    const resources = this.mesh.shader?.resources;
    if (resources !== undefined) resources[name] = next;
    previous.destroy();
    return next;
  }
}

function blankTexture(format: 'rgba8unorm' | 'rg8unorm'): BufferImageSource {
  const bytes = format === 'rgba8unorm' ? 4 : 2;
  // Two texels wide so an RG8 row meets the 4-byte unpack alignment.
  return new BufferImageSource({ resource: new Uint8Array(2 * bytes), width: 2, height: 1, format });
}
