import { BufferImageSource, UniformGroup } from 'pixi.js';

/**
 * The terrain shader's weather-cover hook: wet ground darkens with puddles on level ground, snow
 * settles in noise-broken patches, sand dust warms the ground. An Open Northland enhancement; the
 * original leaves the ground untouched by weather. Every colour and scale here is tuned by eye.
 *
 * The cover texture is the `WeatherCover` grid, one texel per weather sector (r wet, g snow, b dust),
 * linear-filtered so its texel centres land on sector centres. `uCover` gates the whole pass: 0 draws
 * the ground exactly as before.
 */

/** Rec. 601 luma weights, the published grey the grades pivot on. */
const LUMA = 'vec3(0.299, 0.587, 0.114)';
/** Ground y is drawn squashed by the projection; noise stretches it back so patches read round. */
const ISO_Y_STRETCH = 1.8;

/** Brightness loss of fully wet ground. */
const WET_DARKEN = 0.32;
/** Saturation gain of fully wet ground. */
const WET_SATURATION = 0.25;
/** RGB multiplier of fully wet ground: a slight cool cast. */
const WET_TINT = 'vec3(0.93, 0.97, 1.05)';
/** Puddle noise feature size in world px. */
const PUDDLE_SCALE_PX = 22;
/** Noise level above which a puddle forms, and the width of its soft rim. */
const PUDDLE_THRESHOLD = 0.6;
const PUDDLE_EDGE = 0.06;
/** Wetness at which puddles begin to show. */
const PUDDLE_ONSET = 0.45;
/** How fast a slope (lane brightness off neutral) stops holding water: puddles lie on level ground. */
const PUDDLE_SLOPE_FALLOFF = 4.0;
/** A puddle darkens the soaked ground under it, then mirrors a grey-blue sky over that. */
const PUDDLE_DARKEN = 0.5;
const PUDDLE_COLOUR = 'vec3(0.46, 0.53, 0.62)';
const PUDDLE_MIRROR = 0.22;
/** Grass drinks the rain: how far a green-dominant texel suppresses puddles. */
const GRASS_PUDDLE_SUPPRESS = 0.85;
/** Green lead over red and blue at which a texel counts fully as grass. */
const GRASS_GREEN_LEAD = 0.08;
/** The bright rim a puddle's edge catches. */
const PUDDLE_RIM_GAIN = 0.18;

/** Snow patch noise feature size in world px. */
const SNOW_SCALE_PX = 34;
/** Half-width of the snow patches' soft edge in noise units. */
const SNOW_EDGE = 0.07;
/** Per-pixel grain breaking the patch edge into the ground's own pixel grid. */
const SNOW_GRAIN = 0.1;
/** Snow colour: a cool white that survives the warm post grade. */
const SNOW_COLOUR = 'vec3(0.94, 0.97, 1.08)';
/** Snow brightness follows the ground texel's luma about this pivot, so the pixel art's relief
 *  still reads through; clamped so dark ground cannot grey the snow out. */
const SNOW_TONE_PIVOT = 0.3;
const SNOW_TONE_BASE = 0.88;
const SNOW_RELIEF = 0.9;
const SNOW_TONE_MIN = 0.78;
const SNOW_TONE_MAX = 1.0;
/** How much of the terrain lighting (the lane multiplier) the snow takes: full lighting blows a
 *  lit slope's snow out to flat white. */
const SNOW_LIGHT_RESPONSE = 0.55;
/** Snow opacity from a patch's thin edge to its deep middle. */
const SNOW_THIN_OPACITY = 0.7;
const SNOW_DEEP_OPACITY = 0.95;
/** Noise units from a patch's edge to its deep middle. */
const SNOW_DEEPEN = 0.2;
/** Ground this bright and grey already is snow; cover keeps off most of it. */
const SNOWY_LUMA_LOW = 0.62;
const SNOWY_LUMA_HIGH = 0.82;
const SNOWY_SATURATION_MAX = 0.18;
const SNOWY_KEEP = 0.85;

/** Dust streaks run along the wind: long in x, short in y (world px). */
const DUST_STREAK_X_PX = 90;
const DUST_STREAK_Y_PX = 14;
/** The share of full dust the thinnest streak still carries. */
const DUST_FLOOR = 0.45;
const DUST_COLOUR = 'vec3(0.86, 0.72, 0.52)';
const DUST_OPACITY = 0.42;

const f = (value: number): string => value.toFixed(4);

/** Vertex declarations: the cover UV rides the unlifted brightness-lane UV, the noise the drawn position. */
export const COVER_VERTEX_DECLARATIONS = `
  uniform vec4 uCoverMap; // xy scale, zw offset from the brightness-lane UV to the cover UV
  out vec2 vCoverUV;
  out vec2 vGroundPos;
`;

/** Vertex body; needs `aBrightnessUV` and `aPosition`. */
export const COVER_VERTEX_BODY = `
    vCoverUV = aBrightnessUV * uCoverMap.xy + uCoverMap.zw;
    vGroundPos = aPosition;
`;

export const COVER_FRAGMENT_DECLARATIONS = `
  uniform sampler2D uCoverTex;
  uniform float uCover;
  in vec2 vCoverUV;
  in vec2 vGroundPos;

  float coverHash(ivec2 p) {
    uvec2 q = uvec2(p) * uvec2(1597334673u, 3812015801u);
    uint n = (q.x ^ q.y) * 1597334673u;
    return float(n >> 8) * (1.0 / 16777216.0);
  }
  float coverNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 t = fract(p);
    t = t * t * (3.0 - 2.0 * t);
    ivec2 c = ivec2(i);
    float a = coverHash(c);
    float b = coverHash(c + ivec2(1, 0));
    float d = coverHash(c + ivec2(0, 1));
    float e = coverHash(c + ivec2(1, 1));
    return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
  }
  float coverFbm(vec2 p) {
    return 0.65 * coverNoise(p) + 0.35 * coverNoise(p * 2.7 + 17.0);
  }

  // rgb is premultiplied by alpha; lane is the fragment's brightness multiplier (1 = level ground).
  vec3 weatherCover(vec3 rgb, float alpha, float lane, vec3 cover) {
    vec2 px = floor(vGroundPos) + 0.5;
    vec2 p = vec2(px.x, px.y * ${f(ISO_Y_STRETCH)});
    float grey = dot(rgb, ${LUMA});
    float luma = grey / max(alpha, 1.0 / 255.0);
    if (cover.r > 0.0) {
      float wet = cover.r;
      rgb = mix(vec3(grey), rgb, 1.0 + ${f(WET_SATURATION)} * wet)
        * (1.0 - ${f(WET_DARKEN)} * wet) * mix(vec3(1.0), ${WET_TINT}, wet);
      float level = 1.0 - clamp(abs(lane - 1.0) * ${f(PUDDLE_SLOPE_FALLOFF)}, 0.0, 1.0);
      float grass = smoothstep(0.0, ${f(GRASS_GREEN_LEAD)}, (rgb.g - max(rgb.r, rgb.b)) / max(alpha, 1.0 / 255.0));
      level *= 1.0 - ${f(GRASS_PUDDLE_SUPPRESS)} * grass;
      float n = coverFbm(p / ${f(PUDDLE_SCALE_PX)}) * level;
      float onset = smoothstep(${f(PUDDLE_ONSET)}, 1.0, wet);
      float puddle = smoothstep(${f(PUDDLE_THRESHOLD)}, ${f(PUDDLE_THRESHOLD + PUDDLE_EDGE)}, n) * onset;
      float rim = puddle * (1.0 - puddle) * 4.0;
      // The mirrored sky brightens toward the puddle's far (upper) side, like a low sky reflection.
      float sky = 0.8 + 0.4 * coverNoise(p / ${f(PUDDLE_SCALE_PX / 2)});
      vec3 soaked = rgb * (1.0 - ${f(PUDDLE_DARKEN)} * puddle);
      rgb = mix(soaked, ${PUDDLE_COLOUR} * sky * alpha, puddle * ${f(PUDDLE_MIRROR)})
        + rim * ${f(PUDDLE_RIM_GAIN)} * alpha;
    }
    if (cover.g > 0.0) {
      vec3 straight = rgb / max(alpha, 1.0 / 255.0);
      float saturation = max(straight.r, max(straight.g, straight.b)) - min(straight.r, min(straight.g, straight.b));
      float snowy = smoothstep(${f(SNOWY_LUMA_LOW)}, ${f(SNOWY_LUMA_HIGH)}, luma)
        * (1.0 - smoothstep(0.0, ${f(SNOWY_SATURATION_MAX)}, saturation));
      float n = coverFbm(p / ${f(SNOW_SCALE_PX)}) + (coverHash(ivec2(px)) - 0.5) * ${f(SNOW_GRAIN)};
      float threshold = mix(1.0 + ${f(SNOW_EDGE)}, -${f(SNOW_EDGE)}, cover.g);
      float mask = smoothstep(threshold - ${f(SNOW_EDGE)}, threshold + ${f(SNOW_EDGE)}, n)
        * (1.0 - ${f(SNOWY_KEEP)} * snowy);
      float depth = mix(${f(SNOW_THIN_OPACITY)}, ${f(SNOW_DEEP_OPACITY)},
        smoothstep(threshold, threshold + ${f(SNOW_DEEPEN)}, n));
      float tone = clamp(${f(SNOW_TONE_BASE)} + ${f(SNOW_RELIEF)} * (luma - ${f(SNOW_TONE_PIVOT)}),
        ${f(SNOW_TONE_MIN)}, ${f(SNOW_TONE_MAX)});
      // The caller multiplies by the lane afterwards, so divide it back out of the snow's own share.
      float lit = mix(1.0, lane, ${f(SNOW_LIGHT_RESPONSE)}) / max(lane, 0.05);
      rgb = mix(rgb, ${SNOW_COLOUR} * tone * lit * alpha, mask * depth);
    }
    if (cover.b > 0.0) {
      float n = coverNoise(vec2(p.x / ${f(DUST_STREAK_X_PX)}, p.y / ${f(DUST_STREAK_Y_PX * ISO_Y_STRETCH)}));
      float dust = cover.b * mix(${f(DUST_FLOOR)}, 1.0, n);
      rgb = mix(rgb, ${DUST_COLOUR} * (0.75 + 0.45 * luma) * alpha, dust * ${f(DUST_OPACITY)});
    }
    return rgb;
  }
`;

/** The terrain's shared cover switch and UV mapping, one group per map bound into every shaded mesh. */
export type GroundCoverUniforms = UniformGroup & {
  readonly uniforms: { uCover: number; readonly uCoverMap: Float32Array };
};

export function makeGroundCoverUniforms(): GroundCoverUniforms {
  return new UniformGroup({
    uCover: { value: 0, type: 'f32' },
    uCoverMap: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
  }) as GroundCoverUniforms;
}

/** A cover texture of `width` by `height` sectors, all clear. */
export function makeGroundCoverTexture(width: number, height: number): BufferImageSource {
  return new BufferImageSource({
    resource: new Uint8Array(Math.max(1, width) * Math.max(1, height) * 4),
    width: Math.max(1, width),
    height: Math.max(1, height),
    // The cover is a smooth field between sector centres, not pixel art.
    scaleMode: 'linear',
    addressMode: 'clamp-to-edge',
  });
}
