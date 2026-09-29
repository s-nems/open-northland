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
    fall: [360, 820],
    windResponse: 1.6,
    parallax: [1.05, 1.5],
    alpha: [0.16, 0.5],
    size: [1, 1.4],
    colour: [0.68, 0.76, 0.87],
    stormAlpha: 0.3,
  },
  snow: {
    fall: [18, 70],
    windResponse: 1.2,
    parallax: [0.95, 1.5],
    alpha: [0.9, 1],
    size: [1.8, 8],
    colour: [1.0, 1.0, 1.0],
    stormAlpha: 0,
  },
  sand: {
    fall: [6, 22],
    windResponse: 1.25,
    parallax: [1.0, 1.3],
    alpha: [0.3, 0.7],
    size: [1, 1.4],
    colour: [1.0, 0.9, 0.72],
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
  flat out vec4 vShape;
  flat out vec2 vShade;
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

/** Thin slanted streaks along the fall velocity, brightest at the head: far ones short, dim and slow,
 *  near ones long and brighter. A storm sweeps heavier sheets of rain across the screen with the wind. */
const RAIN_VERTEX = `
  // Streak length px at zoom 1, far to near.
  const vec2 STREAK_LENGTH = vec2(7.0, 40.0);
  // Brightness far to near: distant rain melts into the air.
  const vec2 BRIGHTNESS = vec2(0.78, 1.1);
  // Storm sheets: bands of heavier rain, px per band, whole cycles per time split, and how much a full
  // storm thins the rain between the bands.
  const vec2 SHEET_WAVELENGTH = vec2(460.0, 190.0);
  const vec2 SHEET_CYCLES = vec2(9.0, 23.0);
  const float SHEET_DEPTH = 0.75;
  // The bands lean down to the right, like rain blown across the view.
  const vec2 SHEET_SLANT = vec2(1.0, 0.35);
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
    float len = mix(STREAK_LENGTH.x, STREAK_LENGTH.y, depth) * (0.75 + 0.5 * aSeedB.y) * uDraw.z
      * (1.0 + 0.3 * uStorm);
    float core = 0.5 * mix(SIZE.x, SIZE.y, depth) * uDraw.z;
    float halfWidth = core + 1.0;
    float phase = uTime.y / TIME_SPLIT;
    float band = dot(centre, SHEET_SLANT);
    float sheet = 0.6 * (0.5 + 0.5 * sin(TAU * (band / SHEET_WAVELENGTH.x - SHEET_CYCLES.x * phase)))
      + 0.4 * (0.5 + 0.5 * sin(TAU * (band / SHEET_WAVELENGTH.y - SHEET_CYCLES.y * phase)));
    float sheetGain = mix(1.0, mix(1.0 - SHEET_DEPTH, 1.0 + 0.5 * SHEET_DEPTH, sheet), uStorm);
    vLocal = vec2(aPosition.x * halfWidth, aPosition.y);
    vShape = vec4(core, 0.0, 0.0, 0.0);
    vShade = vec2(0.0);
    vColour = COLOUR * mix(BRIGHTNESS.x, BRIGHTNESS.y, depth) * (0.92 + 0.16 * aSeedB.z);
    vAlpha = mix(ALPHA.x, ALPHA.y, depth) * (1.0 + STORM_ALPHA * uStorm) * sheetGain * gate;
    place(centre + dir * aPosition.y * len * 0.5 + across * aPosition.x * halfWidth);
  }
`;

const RAIN_FRAGMENT = `
  void main(void) {
    float coverage = clamp(vShape.x + 0.5 - abs(vLocal.x), 0.0, 1.0);
    float along = 0.5 * (vLocal.y + 1.0);
    float a = vAlpha * coverage * along * sqrt(along);
    finalColor = vec4(vColour * a, a);
  }
`;

/**
 * Flakes that sway, tumble and in a blizzard stretch along the wind. Far flakes are crisp whole-pixel
 * squares, a few mid flakes the original's plus sign, near flakes large soft discs. Every flake carries a
 * cool shade under it, so it reads on snow-covered ground as well as on grass.
 */
const SNOW_VERTEX = `
  // Whole sway and tumble cycles per time split, so the motion is continuous across it.
  const vec2 SWAY_CYCLES = vec2(9.0, 22.0);
  const vec2 TUMBLE_CYCLES = vec2(14.0, 40.0);
  const float SWAY_PX = 9.0;
  const float TUMBLE = 0.3;
  // Blizzard wind stretches flakes into short dashes from this speed on (px/s), up to this factor.
  const vec2 STRETCH_SPEED = vec2(120.0, 420.0);
  const float STRETCH_MAX = 1.3;
  // Flakes below this diameter px are drawn as whole crisp pixels.
  const float PIXEL_FLAKE = 3.0;
  // Share of mid-size flakes drawn as a crisp plus sign.
  const float CROSS_SHARE = 0.16;
  const float CROSS_MAX = 4.5;
  // Edge softness px of a soft flake, far to near: near flakes are out of focus.
  const vec2 SOFT_PX = vec2(0.6, 2.2);
  // The shade sits this many px under the flake.
  const float SHADE_DROP = 1.0;
  // Far flakes are this much dimmer and follow this share of a near flake's wind.
  const float FAR_BRIGHTNESS = 0.9;
  const float FAR_WIND = 0.55;
  void main(void) {
    float depth = aSeedA.z;
    vec2 box = uScreen + 2.0 * MARGIN;
    float speed = mix(FALL.x, FALL.y, depth) * speedOf(aSeedB.x);
    vec2 fallVel = vec2(0.0, speed);
    float windShare = WIND_RESPONSE * mix(FAR_WIND, 1.0, depth) * uDraw.z;
    vec2 centre = wrapped(box, fallVel, windShare, mix(PARALLAX.x, PARALLAX.y, depth));
    float phase = uTime.y / TIME_SPLIT;
    float swayCycles = floor(mix(SWAY_CYCLES.x, SWAY_CYCLES.y, aSeedB.z));
    centre.x += SWAY_PX * (0.3 + depth) * uDraw.z * sin(TAU * (swayCycles * phase + aSeedB.y));
    float gate = densityGate(centre);
    if (gate <= 0.0) { cull(); return; }
    // Flakes fall between the camera and the ground, so zooming out never shrinks them below their
    // zoom-1 size: tiny flakes would vanish into the snow cover.
    float size = mix(SIZE.x, SIZE.y, depth * depth) * (0.7 + 0.6 * aSeedB.w) * max(uDraw.z, 1.0);
    vec2 velocity = fallVel + uWind * windShare;
    vec2 dir = normalize(velocity);
    vec2 across = vec2(-dir.y, dir.x);
    vColour = COLOUR * mix(FAR_BRIGHTNESS, 1.0, depth);
    vAlpha = mix(ALPHA.x, ALPHA.y, depth) * gate;
    vShade = vec2(0.0);
    if (size < PIXEL_FLAKE) {
      // A whole-pixel square snapped to the pixel grid, with its shade row under it.
      float n = max(1.0, floor(size + 0.5));
      vLocal = 0.5 * (1.0 + aPosition) * vec2(n, n + SHADE_DROP);
      vShape = vec4(0.0, n, 0.0, 0.0);
      place(floor(centre) + vLocal);
      return;
    }
    if (size < CROSS_MAX && aSeedB.w > 1.0 - CROSS_SHARE) {
      // Upright and pixel-snapped: one-pixel arms either side of a centre pixel, shade row under.
      float arm = floor(size * 0.5 + 0.5);
      vLocal = aPosition * (arm + 0.5) + vec2(0.0, (aPosition.y + 1.0) * 0.5 * SHADE_DROP);
      vShape = vec4(1.0, arm, 0.0, 0.0);
      place(floor(centre) + 0.5 + vLocal);
      return;
    }
    float stretch = 1.0 + STRETCH_MAX * smoothstep(STRETCH_SPEED.x, STRETCH_SPEED.y, length(velocity));
    float tumbleCycles = floor(mix(TUMBLE_CYCLES.x, TUMBLE_CYCLES.y, aSeedB.y));
    float tumble = 1.0 - TUMBLE * abs(sin(TAU * (tumbleCycles * phase + aSeedB.z)));
    float soft = mix(SOFT_PX.x, SOFT_PX.y, depth);
    // Radii across and along the flight direction.
    vec2 radii = 0.5 * size * vec2(tumble, stretch);
    vec2 extent = radii + soft + SHADE_DROP + 1.0;
    vLocal = aPosition * extent;
    vShape = vec4(2.0, soft, radii);
    // Screen down in the flake's (across, along) frame.
    vShade = SHADE_DROP * vec2(across.y, dir.y);
    place(centre + across * vLocal.x + dir * vLocal.y);
  }
`;

const SNOW_FRAGMENT = `
  const vec3 SHADE_COLOUR = vec3(0.3, 0.36, 0.5);
  const float SHADE_ALPHA = 0.6;
  float plusAt(vec2 p, float arm) {
    vec2 d = abs(p);
    return (max(d.x, d.y) <= arm + 0.5 && min(d.x, d.y) < 0.5) ? 1.0 : 0.0;
  }
  // 0..1 cover of a soft ellipse with 'radii' at 'p', blurred over 'soft' px inside its edge.
  float discAt(vec2 p, vec2 radii, float soft) {
    float edge = (length(p / radii) - 1.0) * min(radii.x, radii.y);
    return 1.0 - smoothstep(-soft, 0.5, edge);
  }
  void main(void) {
    float flake;
    float shade;
    float glow = 1.0;
    if (vShape.x < 0.5) {
      flake = vLocal.y < vShape.y ? 1.0 : 0.0;
      shade = 1.0 - flake;
    } else if (vShape.x < 1.5) {
      flake = plusAt(vLocal, vShape.y);
      shade = plusAt(vLocal - vec2(0.0, 1.0), vShape.y);
    } else {
      flake = discAt(vLocal, vShape.zw, vShape.y);
      shade = discAt(vLocal - vShade, vShape.zw, vShape.y);
      // A brighter heart: soft flakes are densest in the middle.
      glow = 0.9 + 0.1 * (1.0 - clamp(length(vLocal / vShape.zw), 0.0, 1.0));
    }
    float under = shade * SHADE_ALPHA * (1.0 - flake);
    float a = (flake + under) * vAlpha;
    finalColor = vec4((vColour * glow * flake + SHADE_COLOUR * under) * vAlpha, a);
  }
`;

/** Fine sideways dust dashes plus a few slow, large, faint dust puffs; a sandstorm lengthens the dashes
 *  and thickens them, while the atmosphere's streaked dust wall carries the rest. */
const SAND_VERTEX = `
  const vec2 STREAK_LENGTH = vec2(4.0, 20.0);
  const float STREAK_SECONDS = 0.045;
  // A full sandstorm lengthens the dashes by this share.
  const float STORM_STRETCH = 0.6;
  const float PUFF_SHARE = 0.14;
  const vec2 PUFF_SIZE = vec2(36.0, 110.0);
  const float PUFF_ALPHA = 0.18;
  const float PUFF_WIND = 0.45;
  const vec3 PUFF_COLOUR = vec3(0.82, 0.68, 0.48);
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
    vShade = vec2(0.0);
    if (puff) {
      float r = 0.5 * mix(PUFF_SIZE.x, PUFF_SIZE.y, aSeedB.y) * uDraw.z * (1.0 + 0.5 * uStorm);
      vLocal = aPosition;
      vShape = vec4(1.0 + aSeedB.z, 0.0, 0.0, 0.0);
      vColour = PUFF_COLOUR;
      vAlpha = PUFF_ALPHA * (0.6 + 0.8 * depth) * (1.0 + STORM_ALPHA * uStorm) * gate;
      place(centre + aPosition * r);
      return;
    }
    vec2 velocity = fallVel + uWind * windShare;
    vec2 dir = normalize(velocity + vec2(1e-3, 0.0));
    vec2 across = vec2(-dir.y, dir.x);
    float len = clamp(length(velocity) * STREAK_SECONDS * (0.6 + 0.8 * aSeedB.y),
      STREAK_LENGTH.x * uDraw.z, STREAK_LENGTH.y * uDraw.z) * (1.0 + STORM_STRETCH * uStorm);
    float core = 0.5 * mix(SIZE.x, SIZE.y, depth) * uDraw.z;
    float halfWidth = core + 1.0;
    vLocal = vec2(aPosition.x * halfWidth, aPosition.y);
    vShape = vec4(-core, 0.0, 0.0, 0.0);
    vColour = COLOUR * (0.85 + 0.3 * aSeedB.z);
    vAlpha = mix(ALPHA.x, ALPHA.y, depth) * (1.0 + STORM_ALPHA * uStorm) * gate;
    place(centre + dir * aPosition.y * len * 0.5 + across * aPosition.x * halfWidth);
  }
`;

const SAND_FRAGMENT = `
  void main(void) {
    float a;
    float seed = vShape.x;
    if (seed > 0.0) {
      // A lumpy soft puff: the radius wobbles with the angle, seeded per puff.
      float angle = atan(vLocal.y, vLocal.x);
      float r = length(vLocal) * (1.0 + 0.18 * sin(3.0 * angle + 6.2831 * seed) + 0.1 * sin(5.0 * angle - 4.0 * seed));
      a = 1.0 - smoothstep(0.15, 1.0, r);
    } else {
      float coverage = clamp(-seed + 0.5 - abs(vLocal.x), 0.0, 1.0);
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
  // Per-kind shape parameters; see each body.
  flat in vec4 vShape;
  // Snow: the shade's offset under a soft flake, in the flake's frame.
  flat in vec2 vShade;
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
