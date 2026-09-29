import { GlProgram } from 'pixi.js';
import {
  PARTICLE_WRAP_MARGIN_PX,
  WEATHER_NODES_PER_WORLD_X,
  WEATHER_NODES_PER_WORLD_Y,
} from '../../data/weather/precipitation.js';
import type { WeatherKind } from '../../data/weather/types.js';

/**
 * The airborne precipitation shaders: one instanced quad per particle, placed entirely on the GPU from
 * game time, the integrated wind and the camera. Each particle reads the regional amount of its kind
 * from the weather field texture at its own screen point and shows only while its rank is under that
 * amount, so rain stops at a region's edge instead of following the screen. All look constants are
 * tuned by eye; the original drew single-pixel dashes and plus signs (see the weather spec).
 */

/** Game seconds and wind displacement reach the shader split into a coarse and a fine part, each wrapped
 *  on its own, so float32 keeps sub-pixel motion however long a game runs. Sway and tumble cycle a whole
 *  number of times per coarse step, so they stay continuous across it. */
export const PRECIPITATION_TIME_SPLIT_SECONDS = 64;
export const PRECIPITATION_WIND_SPLIT_PX = 4096;

/** Per-kind look. Speeds in screen px per game second at zoom 1, far (0) to near (1) depth. */
interface PrecipitationLook {
  readonly fall: readonly [number, number];
  /** Share of the wind a particle follows. */
  readonly windResponse: number;
  /** Camera parallax: 1 moves with the ground, above 1 is a particle nearer the viewer. */
  readonly parallax: readonly [number, number];
  readonly alpha: readonly [number, number];
  /** Rain and sand: streak width px; snow: flake diameter px. */
  readonly size: readonly [number, number];
  readonly colour: readonly [number, number, number];
  /** Storm adds this share of alpha. */
  readonly stormAlpha: number;
}

const LOOKS: Readonly<Record<WeatherKind, PrecipitationLook>> = {
  rain: {
    fall: [300, 720],
    windResponse: 1.6,
    parallax: [1.05, 1.45],
    alpha: [0.38, 0.72],
    size: [1, 1.6],
    colour: [0.74, 0.82, 0.92],
    stormAlpha: 0.35,
  },
  snow: {
    fall: [20, 64],
    windResponse: 1.2,
    parallax: [1.0, 1.35],
    alpha: [0.55, 0.95],
    size: [1.6, 5.2],
    colour: [0.97, 0.98, 1.0],
    stormAlpha: 0.1,
  },
  sand: {
    fall: [6, 22],
    windResponse: 1.25,
    parallax: [1.0, 1.3],
    alpha: [0.45, 0.8],
    size: [1, 1.5],
    colour: [0.94, 0.8, 0.58],
    stormAlpha: 0,
  },
};

const glslFloat = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));
const vec2Of = (pair: readonly [number, number]): string =>
  `vec2(${glslFloat(pair[0])}, ${glslFloat(pair[1])})`;

function lookDefines(look: PrecipitationLook): string {
  return `
  const vec2 FALL = ${vec2Of(look.fall)};
  const float WIND_RESPONSE = ${glslFloat(look.windResponse)};
  const vec2 PARALLAX = ${vec2Of(look.parallax)};
  const vec2 ALPHA = ${vec2Of(look.alpha)};
  const vec2 SIZE = ${vec2Of(look.size)};
  const vec3 COLOUR = vec3(${look.colour.map(glslFloat).join(', ')});
  const float STORM_ALPHA = ${glslFloat(look.stormAlpha)};`;
}

/** Shared head: attributes, uniforms, wrap motion and the regional density gate. */
const VERTEX_HEAD = `#version 300 es
  precision highp float;
  in vec2 aPosition;
  // x, y in the wrap box (0..1), depth (0 far .. 1 near), instance index.
  in vec4 aSeedA;
  // Four independent 0..1 draws.
  in vec4 aSeedB;
  out vec2 vLocal;
  out float vAlpha;
  flat out float vShape;
  flat out vec3 vColour;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  uniform vec2 uScreen;
  // Camera pan px, zoom.
  uniform vec3 uCamera;
  // Game seconds split: coarse (a whole number of splits), fine.
  uniform vec2 uTime;
  // Integrated wind px split: coarse xy, fine xy.
  uniform vec4 uWindTravel;
  // Current wind px/s.
  uniform vec2 uWind;
  uniform float uStorm;
  uniform sampler2D uFieldPrev;
  uniform sampler2D uFieldCur;
  // Node span x, y of the field texture, cross-fade 0 previous .. 1 current.
  uniform vec3 uField;
  uniform vec3 uChannel;
  // 1 / full amount, intensity gamma.
  uniform vec2 uIntensity;
  // Particles drawn, strongest intensity on screen, zoom size scale.
  uniform vec3 uDraw;

  const float TAU = 6.28318530718;
  const float MARGIN = ${glslFloat(PARTICLE_WRAP_MARGIN_PX)};
  const float TIME_SPLIT = ${glslFloat(PRECIPITATION_TIME_SPLIT_SECONDS)};
  const vec2 NODES_PER_WORLD = vec2(${glslFloat(WEATHER_NODES_PER_WORLD_X)}, ${glslFloat(WEATHER_NODES_PER_WORLD_Y)});
  // Speed spread between particles of one depth.
  const float SPEED_JITTER = 0.18;
  // Density gate softness in intensity units: particles near the threshold fade instead of popping.
  const float GATE_SOFT = 0.08;

  float speedOf(float jitter) {
    return mix(1.0 - SPEED_JITTER, 1.0 + SPEED_JITTER, jitter) * uDraw.z;
  }

  // Wrapped position of a particle moving at velocity factor 'fallVel' and wind share 'windShare'.
  vec2 wrapped(vec2 box, vec2 fallVel, float windShare, float parallax) {
    vec2 travel = mod(fallVel * uTime.x, box) + fallVel * uTime.y
      + mod(uWindTravel.xy * windShare, box) + uWindTravel.zw * windShare
      + mod(uCamera.xy * parallax, box);
    return mod(aSeedA.xy * box + travel, box) - MARGIN;
  }

  // 0..1 visibility of the particle at screen point 'p' for its rank among the drawn particles.
  float densityGate(vec2 p) {
    vec2 node = (p - uCamera.xy) / uCamera.z * NODES_PER_WORLD;
    vec2 uv = node / uField.xy;
    float amount = dot(mix(textureLod(uFieldPrev, uv, 0.0).rgb, textureLod(uFieldCur, uv, 0.0).rgb, uField.z), uChannel);
    float intensity = amount > 0.0 ? min(1.0, pow(amount * uIntensity.x, uIntensity.y)) : 0.0;
    float rank = (aSeedA.w + 0.5) / uDraw.x;
    return smoothstep(rank, rank + GATE_SOFT, intensity / max(uDraw.y, 1e-4));
  }

  void place(vec2 screen) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(screen, 1.0)).xy, 0.0, 1.0);
  }

  void cull() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

/** Thin slanted streaks along the fall velocity, brightest at the head. */
const RAIN_VERTEX = `
  // Streak length is the distance travelled in this many seconds, within bounds (px at zoom 1).
  const float STREAK_SECONDS = 0.04;
  const vec2 STREAK_LENGTH = vec2(7.0, 34.0);
  void main(void) {
    float depth = aSeedA.z;
    vec2 box = uScreen + 2.0 * MARGIN;
    float speed = mix(FALL.x, FALL.y, depth) * speedOf(aSeedB.x);
    vec2 fallVel = vec2(0.0, speed);
    float windShare = WIND_RESPONSE * speed / FALL.y;
    vec2 centre = wrapped(box, fallVel, windShare, mix(PARALLAX.x, PARALLAX.y, depth));
    float gate = densityGate(centre);
    if (gate <= 0.0) { cull(); return; }
    vec2 velocity = fallVel + uWind * windShare;
    vec2 dir = normalize(velocity);
    vec2 across = vec2(-dir.y, dir.x);
    float len = clamp(length(velocity) * STREAK_SECONDS * (0.7 + 0.6 * aSeedB.y),
      STREAK_LENGTH.x * uDraw.z, STREAK_LENGTH.y * uDraw.z) * (1.0 + 0.4 * uStorm);
    float core = 0.5 * mix(SIZE.x, SIZE.y, depth) * uDraw.z;
    float halfWidth = core + 1.0;
    vLocal = vec2(aPosition.x * halfWidth, aPosition.y);
    vShape = core;
    vColour = COLOUR * (0.9 + 0.2 * aSeedB.z);
    vAlpha = mix(ALPHA.x, ALPHA.y, depth) * (1.0 + STORM_ALPHA * uStorm) * gate;
    place(centre + dir * aPosition.y * len * 0.5 + across * aPosition.x * halfWidth);
  }
`;

const RAIN_FRAGMENT = `
  void main(void) {
    float coverage = clamp(vShape + 0.5 - abs(vLocal.x), 0.0, 1.0);
    float along = 0.5 * (vLocal.y + 1.0);
    float a = vAlpha * coverage * along * along;
    finalColor = vec4(vColour * a, a);
  }
`;

/** Flakes that sway and tumble; far ones are single crisp pixels, a few near ones the original's plus. */
const SNOW_VERTEX = `
  // Whole sway and tumble cycles per time split, so the motion is continuous across it.
  const vec2 SWAY_CYCLES = vec2(9.0, 22.0);
  const vec2 TUMBLE_CYCLES = vec2(14.0, 40.0);
  const float SWAY_PX = 7.0;
  const float TUMBLE = 0.55;
  // Blizzard wind stretches flakes into short dashes from this speed on (px/s), up to this factor.
  const vec2 STRETCH_SPEED = vec2(120.0, 420.0);
  const float STRETCH_MAX = 0.9;
  // Flakes below this size are drawn as whole crisp pixels.
  const float PIXEL_FLAKE = 2.2;
  // Share of near flakes drawn as a plus sign.
  const float CROSS_SHARE = 0.18;
  void main(void) {
    float depth = aSeedA.z;
    vec2 box = uScreen + 2.0 * MARGIN;
    float speed = mix(FALL.x, FALL.y, depth) * speedOf(aSeedB.x);
    vec2 fallVel = vec2(0.0, speed);
    float windShare = WIND_RESPONSE * mix(0.6, 1.0, depth) * uDraw.z;
    vec2 centre = wrapped(box, fallVel, windShare, mix(PARALLAX.x, PARALLAX.y, depth));
    float phase = uTime.y / TIME_SPLIT;
    float swayCycles = floor(mix(SWAY_CYCLES.x, SWAY_CYCLES.y, aSeedB.z));
    centre.x += SWAY_PX * (0.4 + depth) * uDraw.z * sin(TAU * (swayCycles * phase + aSeedB.y));
    float gate = densityGate(centre);
    if (gate <= 0.0) { cull(); return; }
    float size = mix(SIZE.x, SIZE.y, depth * depth) * (0.65 + 0.7 * aSeedB.w) * uDraw.z;
    vec2 velocity = fallVel + uWind * windShare;
    vec2 dir = normalize(velocity);
    vec2 across = vec2(-dir.y, dir.x);
    float stretch = 1.0 + STRETCH_MAX * smoothstep(STRETCH_SPEED.x, STRETCH_SPEED.y, length(velocity));
    float tumbleCycles = floor(mix(TUMBLE_CYCLES.x, TUMBLE_CYCLES.y, aSeedB.y));
    float tumble = 1.0 - TUMBLE * abs(sin(TAU * (tumbleCycles * phase + aSeedB.z)));
    bool pixel = size < PIXEL_FLAKE;
    bool plus = !pixel && depth > 0.5 && aSeedB.w > 1.0 - CROSS_SHARE;
    vShape = pixel ? 0.0 : (plus ? 2.0 : 1.0);
    vColour = COLOUR;
    vAlpha = mix(ALPHA.x, ALPHA.y, depth) * (1.0 + STORM_ALPHA * uStorm) * gate;
    vLocal = aPosition;
    if (pixel) {
      // A whole-pixel square snapped to the pixel grid: crisp like the original's dots.
      vec2 cell = floor(centre) + 0.5 * (1.0 + aPosition) * max(1.0, floor(size + 0.5));
      place(cell);
      return;
    }
    if (plus) {
      // Upright and pixel-snapped, three px arms either side of a centre pixel at the largest size.
      float arm = floor(size * 0.5 + 0.5) + 0.5;
      place(floor(centre) + 0.5 + aPosition * arm);
      return;
    }
    float r = 0.5 * size + 0.75;
    place(centre + dir * aPosition.y * r * stretch + across * aPosition.x * r * tumble);
  }
`;

const SNOW_FRAGMENT = `
  void main(void) {
    float a;
    if (vShape < 0.5) {
      a = 1.0;
    } else if (vShape > 1.5) {
      vec2 d = abs(vLocal);
      float armWidth = 0.34;
      a = (d.x < armWidth || d.y < armWidth) ? 1.0 : 0.0;
    } else {
      a = 1.0 - smoothstep(0.45, 0.95, length(vLocal));
    }
    a *= vAlpha;
    finalColor = vec4(vColour * a, a);
  }
`;

/** Fast sideways dashes plus a few slow, large dust puffs. */
const SAND_VERTEX = `
  const float STREAK_SECONDS = 0.05;
  const vec2 STREAK_LENGTH = vec2(6.0, 30.0);
  const float PUFF_SHARE = 0.09;
  const vec2 PUFF_SIZE = vec2(22.0, 70.0);
  const float PUFF_ALPHA = 0.14;
  const float PUFF_WIND = 0.45;
  const vec3 PUFF_COLOUR = vec3(0.8, 0.66, 0.46);
  // Vertical wobble of a dash, whole cycles per time split.
  const vec2 WOBBLE_CYCLES = vec2(20.0, 50.0);
  const float WOBBLE_PX = 5.0;
  void main(void) {
    float depth = aSeedA.z;
    vec2 box = uScreen + 2.0 * MARGIN;
    bool puff = aSeedB.w < PUFF_SHARE;
    float speed = mix(FALL.x, FALL.y, depth) * speedOf(aSeedB.x);
    vec2 fallVel = vec2(0.0, speed);
    float windShare = WIND_RESPONSE * (puff ? PUFF_WIND : mix(0.7, 1.15, depth) * (0.8 + 0.4 * aSeedB.x)) * uDraw.z;
    vec2 centre = wrapped(box, fallVel, windShare, mix(PARALLAX.x, PARALLAX.y, depth));
    float phase = uTime.y / TIME_SPLIT;
    centre.y += WOBBLE_PX * uDraw.z * sin(TAU * (floor(mix(WOBBLE_CYCLES.x, WOBBLE_CYCLES.y, aSeedB.z)) * phase + aSeedB.y));
    float gate = densityGate(centre);
    if (gate <= 0.0) { cull(); return; }
    vLocal = aPosition;
    if (puff) {
      float r = 0.5 * mix(PUFF_SIZE.x, PUFF_SIZE.y, aSeedB.y) * uDraw.z * (1.0 + 0.5 * uStorm);
      vShape = 1.0 + aSeedB.z;
      vColour = PUFF_COLOUR;
      vAlpha = PUFF_ALPHA * (0.6 + 0.8 * depth) * (1.0 + STORM_ALPHA * uStorm) * gate;
      place(centre + aPosition * r);
      return;
    }
    vec2 velocity = fallVel + uWind * windShare;
    vec2 dir = normalize(velocity + vec2(1e-3, 0.0));
    vec2 across = vec2(-dir.y, dir.x);
    float len = clamp(length(velocity) * STREAK_SECONDS * (0.6 + 0.8 * aSeedB.y),
      STREAK_LENGTH.x * uDraw.z, STREAK_LENGTH.y * uDraw.z);
    float core = 0.5 * mix(SIZE.x, SIZE.y, depth) * uDraw.z;
    float halfWidth = core + 1.0;
    vLocal = vec2(aPosition.x * halfWidth, aPosition.y);
    vShape = -core;
    vColour = COLOUR * (0.85 + 0.3 * aSeedB.z);
    vAlpha = mix(ALPHA.x, ALPHA.y, depth) * (1.0 + STORM_ALPHA * uStorm) * gate;
    place(centre + dir * aPosition.y * len * 0.5 + across * aPosition.x * halfWidth);
  }
`;

const SAND_FRAGMENT = `
  void main(void) {
    float a;
    if (vShape > 0.0) {
      // A lumpy soft puff: the radius wobbles with the angle, seeded per puff.
      float angle = atan(vLocal.y, vLocal.x);
      float r = length(vLocal) * (1.0 + 0.18 * sin(3.0 * angle + 6.2831 * vShape) + 0.1 * sin(5.0 * angle - 4.0 * vShape));
      a = 1.0 - smoothstep(0.15, 1.0, r);
    } else {
      float coverage = clamp(-vShape + 0.5 - abs(vLocal.x), 0.0, 1.0);
      a = coverage * (1.0 - vLocal.y * vLocal.y);
    }
    a *= vAlpha;
    finalColor = vec4(vColour * a, a);
  }
`;

const FRAGMENT_HEAD = `#version 300 es
  precision highp float;
  in vec2 vLocal;
  in float vAlpha;
  flat in float vShape;
  flat in vec3 vColour;
  out vec4 finalColor;
`;

const BODIES: Readonly<Record<WeatherKind, { readonly vertex: string; readonly fragment: string }>> = {
  rain: { vertex: RAIN_VERTEX, fragment: RAIN_FRAGMENT },
  snow: { vertex: SNOW_VERTEX, fragment: SNOW_FRAGMENT },
  sand: { vertex: SAND_VERTEX, fragment: SAND_FRAGMENT },
};

const programs = new Map<WeatherKind, GlProgram>();

/** The compiled program for `kind`, shared by every sky. */
export function precipitationProgram(kind: WeatherKind): GlProgram {
  let program = programs.get(kind);
  if (program === undefined) {
    const body = BODIES[kind];
    program = new GlProgram({
      vertex: VERTEX_HEAD + lookDefines(LOOKS[kind]) + body.vertex,
      fragment: FRAGMENT_HEAD + body.fragment,
      name: `weather-${kind}`,
    });
    programs.set(kind, program);
  }
  return program;
}
