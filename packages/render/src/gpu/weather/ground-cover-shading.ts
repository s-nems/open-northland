import { BufferImageSource, UniformGroup } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';

/**
 * The terrain shader's weather-cover hook: wet ground darkens with a faint sheen and shallow puddles on
 * level ground, snow settles in noise-broken patches, sand dust warms the ground; flat decor takes a
 * snow dusting that matches the patch it stands in. An Open Northland enhancement; the original leaves
 * the ground untouched by weather. Every colour and scale here is tuned by eye.
 *
 * The cover texture is the `WeatherCover` grid, one texel per weather sector (r wet, g snow, b dust,
 * a rain falling), linear-filtered so its texel centres land on sector centres. `uCover` gates the
 * whole pass: 0 draws the ground exactly as before.
 */

/** Rec. 601 luma weights, the published grey the grades pivot on. */
const LUMA = 'vec3(0.299, 0.587, 0.114)';
/** Ground y is drawn squashed by the projection; noise stretches it back so patches read round. */
const ISO_Y_STRETCH = 1.8;
/** The smallest alpha a premultiplied texel is divided by. */
const MIN_ALPHA = 1 / 255;

/** Brightness loss of fully wet ground in its shadows, and in its highlights: the relief sharpens
 *  instead of flattening, as wet soil and stone do. */
const WET_DARKEN = 0.3;
const WET_HIGHLIGHT_DARKEN = 0.14;
/** Luma band over which a texel counts from shadow to highlight. */
const WET_SHADOW_LUMA = 0.25;
const WET_HIGHLIGHT_LUMA = 0.7;
/** Saturation gain of fully wet ground. */
const WET_SATURATION = 0.22;
/** RGB multiplier of fully wet ground: a slight cool cast. */
const WET_TINT = 'vec3(0.95, 0.98, 1.04)';
/** A faint glaze the overcast sky lays on wet ground, in broad soft streaks (world px). */
const SHEEN_SCALE_PX = 60;
const SHEEN_COLOUR = 'vec3(0.62, 0.68, 0.76)';
const SHEEN_GAIN = 0.07;
/** Streak noise band that carries the glaze. */
const SHEEN_NOISE_LOW = 0.45;
const SHEEN_NOISE_HIGH = 0.85;

/** Puddle noise feature size in world px. */
const PUDDLE_SCALE_PX = 30;
/** Noise level at which a puddle's damp shore begins, and the rise to its open water. */
const PUDDLE_THRESHOLD = 0.58;
const PUDDLE_EDGE = 0.1;
/** Wetness at which puddles begin to show. */
const PUDDLE_ONSET = 0.5;
/** How fast a slope (lane brightness off neutral) stops holding water, and the noise a full slope
 *  takes off a puddle: puddles lie on level ground. */
const PUDDLE_SLOPE_FALLOFF = 4.0;
const PUDDLE_UNLEVEL_PENALTY = 0.3;
/** Grass drinks the rain: the noise a green-dominant texel takes off a puddle, so blades stand
 *  through its edge rather than the water stopping at a hard line. */
const GRASS_PUDDLE_PENALTY = 0.25;
/** Green lead over red and blue at which a texel counts fully as grass. */
const GRASS_GREEN_LEAD = 0.06;
/** The soaked shore around the water darkens the ground a little more. */
const PUDDLE_SHORE_DARKEN = 0.18;
/** Shallow water: the bed shows through darkened, under a mirrored overcast sky. */
const PUDDLE_BED_DARKEN = 0.35;
const PUDDLE_SKY = 'vec3(0.58, 0.64, 0.72)';
const PUDDLE_MIRROR = 0.5;
const PUDDLE_OPACITY = 0.75;
/** The mirrored sky brightens toward a puddle's far side: sky variation scale (world px) and depth. */
const PUDDLE_SKY_SCALE_PX = 40;
const PUDDLE_SKY_VARIATION = 0.35;
/** Rain rings in a puddle: one candidate per grid cell (world px), its life, the share of cells
 *  ringing at once in full rain, the widest radius (px) and brightness. */
const PUDDLE_RING_CELL_PX = 9;
const PUDDLE_RING_LIFE_S = 0.7;
const PUDDLE_RING_CHANCE = 0.35;
const PUDDLE_RING_RADIUS_PX = 3.5;
const PUDDLE_RING_GAIN = 0.22;
const PUDDLE_RING_COLOUR = 'vec3(0.86, 0.9, 0.96)';
const RING_MARGIN = PUDDLE_RING_RADIUS_PX / PUDDLE_RING_CELL_PX;
/** A ring on the ground reads flattened, like the splash rings. */
const RING_SQUASH = 2.0;

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
/** The smallest lane the snow's own lighting is divided back out of. */
const MIN_LANE = 0.05;
/** Snow opacity from a patch's thin edge to its deep middle. */
const SNOW_THIN_OPACITY = 0.7;
const SNOW_DEEP_OPACITY = 0.95;
/** Noise units from a patch's edge to its deep middle. */
const SNOW_DEEPEN = 0.2;
/** Ground this bright, pale and cool already is painted snow, its blue-grey shading included; cover
 *  keeps off most of it so the painted relief survives. Warm pale ground (sand, dry grass) is not. */
const SNOWY_LUMA_LOW = 0.48;
const SNOWY_LUMA_HIGH = 0.7;
const SNOWY_SATURATION_LOW = 0.2;
const SNOWY_SATURATION_HIGH = 0.35;
const SNOWY_WARMTH_MAX = 0.06;
const SNOWY_KEEP = 0.9;

/** Decor dusting: snow settles first on a sprite's lit, upward faces and its top rim, then spreads
 *  down into the shade as the cover deepens; the darkest crevices stay bare. */
const DECOR_SHADE_LUMA = 0.12;
const DECOR_LIGHT_LUMA = 0.55;
/** Weights of a texel's light, its top rim and its pixel grain in its claim on the snow. */
const DECOR_LIGHT_WEIGHT = 0.75;
const DECOR_RIM_WEIGHT = 0.55;
const DECOR_GRAIN = 0.12;
/** The claim a texel needs under the lightest dusting and under full cover; the soft edge around it. */
const DECOR_CLAIM_LIGHT = 1.15;
const DECOR_CLAIM_FULL = 0.22;
const DECOR_CLAIM_EDGE = 0.22;
/** Opacity of the settled snow, and the tone its shaded side keeps. */
const DECOR_SNOW_OPACITY = 0.9;
const DECOR_SNOW_SHADE = 0.72;
/** The frosted look the rest of the sprite takes: a cooled, desaturated lift. */
const DECOR_FROST = 0.45;
const DECOR_FROST_TINT = 'vec3(0.82, 0.86, 0.92)';
const DECOR_FROST_LIFT = 0.1;

/** Dust streaks run along the wind: long in x, short in y (world px). */
const DUST_STREAK_X_PX = 90;
const DUST_STREAK_Y_PX = 14;
/** The share of full dust the thinnest streak still carries. */
const DUST_FLOOR = 0.45;
const DUST_COLOUR = 'vec3(0.86, 0.72, 0.52)';
const DUST_OPACITY = 0.42;

const f = (value: number): string => value.toFixed(4);

/** Value noise and the snow patch mask, shared by the ground and the decor. */
const COVER_NOISE = `
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
  // The noise a drawn ground px feeds the snow patches, before any grain.
  float snowNoise(vec2 drawn) {
    return coverFbm(vec2(drawn.x, drawn.y * ${f(ISO_Y_STRETCH)}) / ${f(SNOW_SCALE_PX)});
  }
  // The noise level a patch starts at under snow cover g: above 1 for none, below 0 for full.
  float snowThreshold(float g) {
    return mix(1.0 + ${f(SNOW_EDGE)}, -${f(SNOW_EDGE)}, g);
  }
  float snowMask(float n, float threshold) {
    return smoothstep(threshold - ${f(SNOW_EDGE)}, threshold + ${f(SNOW_EDGE)}, n);
  }
`;

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
  uniform vec2 uCoverClock; // x game seconds, y rain falling on screen 0..1
  in vec2 vCoverUV;
  in vec2 vGroundPos;
  ${COVER_NOISE}

  // Rain rings on a puddle's open water around drawn ground px p: one candidate per grid cell and cycle.
  float puddleRings(vec2 p, float rain) {
    vec2 cellPos = p / ${f(PUDDLE_RING_CELL_PX)};
    ivec2 cell = ivec2(floor(cellPos));
    float t = uCoverClock.x / ${f(PUDDLE_RING_LIFE_S)} + coverHash(cell);
    int cycle = int(floor(t));
    ivec2 key = cell + ivec2(cycle * 7919, cycle * 104729);
    if (coverHash(key) >= ${f(PUDDLE_RING_CHANCE)} * rain) return 0.0;
    float age = fract(t);
    // The centre keeps a ring's reach from its cell's edges, so no ring is cut by a neighbour cell.
    vec2 centre = (vec2(cell) + ${f(RING_MARGIN)}
      + ${f(1 - 2 * RING_MARGIN)} * vec2(coverHash(key + 3), coverHash(key + 5))) * ${f(PUDDLE_RING_CELL_PX)};
    // Measured in px across the squashed ring, so its top and bottom arcs hold together.
    vec2 q = (p - centre) * vec2(1.0, ${f(RING_SQUASH)});
    float d = length(q);
    float slope = length(vec2(q.x, q.y * ${f(RING_SQUASH)})) / max(d, 1e-3);
    float ring = 1.0 - smoothstep(0.0, 0.8, abs(d - age * ${f(PUDDLE_RING_RADIUS_PX)}) / max(slope, 1.0));
    return ring * (1.0 - age);
  }

  // rgb is premultiplied by alpha; lane is the fragment's brightness multiplier (1 = level ground).
  vec3 weatherCover(vec3 rgb, float alpha, float lane, vec4 cover) {
    vec2 px = floor(vGroundPos) + 0.5;
    vec2 p = vec2(px.x, px.y * ${f(ISO_Y_STRETCH)});
    float grey = dot(rgb, ${LUMA});
    float luma = grey / max(alpha, ${f(MIN_ALPHA)});
    if (cover.r > 0.0) {
      float wet = cover.r;
      float grass = smoothstep(0.0, ${f(GRASS_GREEN_LEAD)},
        (rgb.g - max(rgb.r, rgb.b)) / max(alpha, ${f(MIN_ALPHA)}));
      float highlight = smoothstep(${f(WET_SHADOW_LUMA)}, ${f(WET_HIGHLIGHT_LUMA)}, luma);
      float darken = mix(${f(WET_DARKEN)}, ${f(WET_HIGHLIGHT_DARKEN)}, highlight);
      rgb = mix(vec3(grey), rgb, 1.0 + ${f(WET_SATURATION)} * wet) * (1.0 - darken * wet)
        * mix(vec3(1.0), ${WET_TINT}, wet);
      float streak = smoothstep(${f(SHEEN_NOISE_LOW)}, ${f(SHEEN_NOISE_HIGH)},
        coverNoise(p / ${f(SHEEN_SCALE_PX)}));
      rgb += ${SHEEN_COLOUR} * (${f(SHEEN_GAIN)} * wet * streak * highlight * alpha);
      float level = 1.0 - clamp(abs(lane - 1.0) * ${f(PUDDLE_SLOPE_FALLOFF)}, 0.0, 1.0);
      float onset = smoothstep(${f(PUDDLE_ONSET)}, 1.0, wet);
      float n = coverFbm(p / ${f(PUDDLE_SCALE_PX)}) - ${f(PUDDLE_UNLEVEL_PENALTY)} * (1.0 - level)
        - ${f(GRASS_PUDDLE_PENALTY)} * grass;
      float shore = smoothstep(${f(PUDDLE_THRESHOLD)}, ${f(PUDDLE_THRESHOLD + PUDDLE_EDGE)}, n) * onset;
      float water = smoothstep(${f(PUDDLE_THRESHOLD + PUDDLE_EDGE / 2)},
        ${f(PUDDLE_THRESHOLD + PUDDLE_EDGE * 1.5)}, n) * onset;
      if (shore > 0.0) {
        float sky = 1.0 + ${f(PUDDLE_SKY_VARIATION)} * (coverNoise(p / ${f(PUDDLE_SKY_SCALE_PX)}) - 0.5);
        vec3 bed = rgb * (1.0 - ${f(PUDDLE_BED_DARKEN)});
        vec3 surface = mix(bed, ${PUDDLE_SKY} * (sky * alpha), ${f(PUDDLE_MIRROR)});
        rgb = mix(rgb * (1.0 - ${f(PUDDLE_SHORE_DARKEN)} * shore), surface, water * ${f(PUDDLE_OPACITY)});
        float rain = cover.a * uCoverClock.y;
        if (water > 0.0 && rain > 0.0)
          rgb += ${PUDDLE_RING_COLOUR} * (${f(PUDDLE_RING_GAIN)} * water * puddleRings(px, rain) * alpha);
      }
    }
    if (cover.g > 0.0) {
      vec3 straight = rgb / max(alpha, ${f(MIN_ALPHA)});
      float saturation = max(straight.r, max(straight.g, straight.b)) - min(straight.r, min(straight.g, straight.b));
      float snowy = smoothstep(${f(SNOWY_LUMA_LOW)}, ${f(SNOWY_LUMA_HIGH)}, luma)
        * (1.0 - smoothstep(${f(SNOWY_SATURATION_LOW)}, ${f(SNOWY_SATURATION_HIGH)}, saturation))
        * (1.0 - smoothstep(0.0, ${f(SNOWY_WARMTH_MAX)}, straight.r - straight.b));
      float n = snowNoise(px) + (coverHash(ivec2(px)) - 0.5) * ${f(SNOW_GRAIN)};
      float threshold = snowThreshold(cover.g);
      float mask = snowMask(n, threshold) * (1.0 - ${f(SNOWY_KEEP)} * snowy);
      float depth = mix(${f(SNOW_THIN_OPACITY)}, ${f(SNOW_DEEP_OPACITY)},
        smoothstep(threshold, threshold + ${f(SNOW_DEEPEN)}, n));
      float tone = clamp(${f(SNOW_TONE_BASE)} + ${f(SNOW_RELIEF)} * (luma - ${f(SNOW_TONE_PIVOT)}),
        ${f(SNOW_TONE_MIN)}, ${f(SNOW_TONE_MAX)});
      // The caller multiplies by the lane afterwards, so divide it back out of the snow's own share.
      float lit = mix(1.0, lane, ${f(SNOW_LIGHT_RESPONSE)}) / max(lane, ${f(MIN_LANE)});
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

/**
 * Decor vertex declarations: `aAnchor` is the quad's drawn feet anchor in world px, constant across the
 * quad, so the whole sprite takes the snow of the ground patch it stands in. The cover is read at the
 * drawn spot rather than the unlifted one; the grid is smooth over a sector, so a hill's lift barely
 * moves it.
 */
export const DECOR_COVER_VERTEX_DECLARATIONS = `
  in vec2 aAnchor;
  uniform sampler2D uCoverTex;
  uniform float uCover;
  uniform vec2 uCoverNodeScale; // half-cell node to cover UV
  flat out float vSnow;
  ${COVER_NOISE}
`;

/** Decor vertex body: the anchor's cover and the ground's snow patch there, once per vertex. */
export const DECOR_COVER_VERTEX_BODY = `
    vSnow = 0.0;
    if (uCover > 0.5) {
      vec2 node = vec2(aAnchor.x / ${f(TILE_HALF_W)}, 2.0 * aAnchor.y / ${f(TILE_HALF_H)});
      float g = textureLod(uCoverTex, node * uCoverNodeScale, 0.0).g;
      if (g > 0.0) vSnow = snowMask(snowNoise(floor(aAnchor) + 0.5), snowThreshold(g)) * g;
    }
`;

export const DECOR_COVER_FRAGMENT_DECLARATIONS = `
  flat in float vSnow;
  ${COVER_NOISE}

  // Dust a decor texel (premultiplied rgb) with snow. uv is its page UV; lane its brightness multiplier.
  vec3 decorSnow(vec3 rgb, float alpha, vec2 uv, float lane) {
    vec2 size = vec2(textureSize(uTexture, 0));
    vec3 straight = rgb / max(alpha, ${f(MIN_ALPHA)});
    float luma = dot(straight, ${LUMA});
    // The page keeps a transparent gutter round every frame, so one texel up never reads a neighbour.
    float above = texture(uTexture, uv - vec2(0.0, 1.0 / size.y)).a;
    float rim = alpha > 0.0 ? 1.0 - above : 0.0;
    float light = smoothstep(${f(DECOR_SHADE_LUMA)}, ${f(DECOR_LIGHT_LUMA)}, luma);
    float grain = coverHash(ivec2(floor(uv * size)));
    float claim = ${f(DECOR_LIGHT_WEIGHT)} * light + ${f(DECOR_RIM_WEIGHT)} * rim
      + ${f(DECOR_GRAIN)} * (grain - 0.5);
    float needed = mix(${f(DECOR_CLAIM_LIGHT)}, ${f(DECOR_CLAIM_FULL)}, vSnow);
    float settled = smoothstep(needed - ${f(DECOR_CLAIM_EDGE)}, needed + ${f(DECOR_CLAIM_EDGE)}, claim)
      * ${f(DECOR_SNOW_OPACITY)};
    vec3 frosted = mix(straight, vec3(luma) * ${DECOR_FROST_TINT} + ${f(DECOR_FROST_LIFT)}, ${f(DECOR_FROST)} * vSnow);
    float lit = mix(1.0, lane, ${f(SNOW_LIGHT_RESPONSE)}) / max(lane, ${f(MIN_LANE)});
    vec3 snow = ${SNOW_COLOUR} * mix(${f(DECOR_SNOW_SHADE)}, 1.0, max(light, rim)) * lit;
    return mix(frosted, snow, settled) * alpha;
  }
`;

/** The terrain's shared cover switch, UV mapping and clock, one group per map bound into every shaded mesh. */
export type GroundCoverUniforms = UniformGroup & {
  readonly uniforms: { uCover: number; readonly uCoverMap: Float32Array; readonly uCoverClock: Float32Array };
};

export function makeGroundCoverUniforms(): GroundCoverUniforms {
  return new UniformGroup({
    uCover: { value: 0, type: 'f32' },
    uCoverMap: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
    uCoverClock: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
  }) as GroundCoverUniforms;
}

/** The decor's cover switch and node-to-cover-UV scale, one group shared by every shaded decor batch. */
export type DecorCoverUniforms = UniformGroup & {
  readonly uniforms: { uCover: number; readonly uCoverNodeScale: Float32Array };
};

export function makeDecorCoverUniforms(): DecorCoverUniforms {
  return new UniformGroup({
    uCover: { value: 0, type: 'f32' },
    uCoverNodeScale: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
  }) as DecorCoverUniforms;
}

/** A cover texture of `width` by `height` sectors, all clear. */
export function makeGroundCoverTexture(width: number, height: number): BufferImageSource {
  return new BufferImageSource({
    resource: new Uint8Array(Math.max(1, width) * Math.max(1, height) * 4),
    width: Math.max(1, width),
    height: Math.max(1, height),
    // The cover is a smooth field between sector centres, not pixel art.
    scaleMode: 'linear',
    // Alpha is its own channel (rain falling), not coverage: a premultiplied upload would zero the rest.
    alphaMode: 'no-premultiply-alpha',
    addressMode: 'clamp-to-edge',
  });
}
