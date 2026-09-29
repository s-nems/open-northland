import { BufferImageSource, UniformGroup } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';

/**
 * The terrain shader's weather-cover hook: wet ground darkens and deepens in colour with small puddles
 * on level spots, thin snow gathers on level open ground in noise-broken drifts, sand dust dulls the
 * ground in streaks; flat decor takes a light snow dusting on its upper faces. An Open Northland
 * enhancement; the original leaves the ground untouched by weather. The cover is an addition, not a
 * layer over the map: terrain hue and relief read through all of it. Every colour and scale is tuned
 * by eye.
 *
 * The cover texture is the `WeatherCover` grid, one texel per weather sector (r wet, g snow, b dust,
 * a rain falling), linear-filtered so its texel centres land on sector centres. `uCover` gates the
 * whole pass: 0 draws the ground exactly as before. The pass adds no texture sample to a fragment
 * beyond the cover texel; its noise is arithmetic.
 */

/** Rec. 601 luma weights, the published grey the grades pivot on. */
const LUMA_WEIGHTS = [0.299, 0.587, 0.114] as const;
const LUMA = `vec3(${LUMA_WEIGHTS.join(', ')})`;
/** Ground y is drawn squashed by the projection; noise stretches it back so patches read round. */
const ISO_Y_STRETCH = 1.8;
/** The smallest alpha a premultiplied texel is divided by. */
const MIN_ALPHA = 1 / 255;

/** Cover partway between two sectors is pushed up or down by broad noise, so a front wanders instead
 *  of tracing the linear-filtered sector grid: noise size (world px) and the push halfway through. */
const TRANSITION_SCALE_PX = 110;
const TRANSITION_JITTER = 0.6;

/** Brightness loss of fully wet ground in its shadows, and in its highlights: the relief sharpens
 *  instead of flattening, as wet soil and stone do. */
const WET_DARKEN = 0.26;
const WET_HIGHLIGHT_DARKEN = 0.12;
/** Luma band over which a texel counts from shadow to highlight. */
const WET_SHADOW_LUMA = 0.25;
const WET_HIGHLIGHT_LUMA = 0.7;
/** Saturation gain of fully wet ground: wet surfaces read deeper in colour, never greyer. */
const WET_SATURATION = 0.35;
/** Ground soaks unevenly: the share of wetness the driest patches keep off, and their size (world px). */
const WET_PATCHINESS = 0.3;
const WET_PATCH_SCALE_PX = 70;
/** A faint glaze the overcast sky lays on wet highlights, in broad soft streaks (world px). */
const SHEEN_SCALE_PX = 60;
const SHEEN_COLOUR = 'vec3(0.62, 0.68, 0.76)';
const SHEEN_GAIN = 0.05;
/** Streak noise band that carries the glaze. */
const SHEEN_NOISE_LOW = 0.5;
const SHEEN_NOISE_HIGH = 0.85;

/** Puddle noise feature size, and the finer noise that frays its shore (world px). */
const PUDDLE_SCALE_PX = 24;
const PUDDLE_SHORE_SCALE_PX = 7;
const PUDDLE_SHORE_FRAY = 0.1;
/** Noise level at which a puddle's damp rim begins when puddles first form and in a soaking; the rise
 *  from rim to open water. High thresholds keep puddles few and small. */
const PUDDLE_THRESHOLD_ONSET = 0.68;
const PUDDLE_THRESHOLD_SOAKED = 0.58;
const PUDDLE_EDGE = 0.08;
/** Wetness at which puddles begin to form. */
const PUDDLE_ONSET = 0.55;
/** How fast a slope (lane brightness off neutral) stops holding water, and the noise a full slope
 *  takes off a puddle: puddles lie on level ground. */
const PUDDLE_SLOPE_FALLOFF = 2.5;
const PUDDLE_UNLEVEL_PENALTY = 0.25;
/** Grass drinks the rain: the noise a green-dominant texel takes off a puddle, so blades stand
 *  through its edge rather than the water stopping at a hard line. */
const GRASS_PUDDLE_PENALTY = 0.3;
/** Green lead over red and blue at which a texel counts fully as grass. */
const GRASS_GREEN_LEAD = 0.06;
/** The soaked rim around the water darkens the ground a little more. */
const PUDDLE_SHORE_DARKEN = 0.12;
/** Shallow water: the bed shows through darkened, under a faint mirrored overcast sky. */
const PUDDLE_BED_DARKEN = 0.3;
const PUDDLE_SKY = 'vec3(0.58, 0.64, 0.72)';
const PUDDLE_MIRROR = 0.3;
const PUDDLE_OPACITY = 0.6;
/** The mirrored sky brightens toward a puddle's far side: sky variation scale (world px) and depth. */
const PUDDLE_SKY_SCALE_PX = 40;
const PUDDLE_SKY_VARIATION = 0.35;
/** Rain rings in a puddle: one candidate per grid cell (world px), its life, the share of cells
 *  ringing at once in full rain, the widest radius (px) and brightness. */
const PUDDLE_RING_CELL_PX = 9;
export const PUDDLE_RING_LIFE_S = 0.6;
const PUDDLE_RING_CHANCE = 0.18;
const PUDDLE_RING_RADIUS_PX = 3;
const PUDDLE_RING_GAIN = 0.16;
const PUDDLE_RING_COLOUR = 'vec3(0.86, 0.9, 0.96)';
const RING_MARGIN = PUDDLE_RING_RADIUS_PX / PUDDLE_RING_CELL_PX;
/** A ring on the ground reads flattened, like the splash rings. */
const RING_SQUASH = 2.0;

/** Snow lies in drifts at three scales (world px) with these weights: broad drifts, patches, and
 *  the fine breakup of an edge. */
const SNOW_DRIFT_SCALE_PX = 140;
const SNOW_PATCH_SCALE_PX = 36;
const SNOW_FINE_SCALE_PX = 9;
const SNOW_DRIFT_WEIGHT = 0.45;
const SNOW_PATCH_WEIGHT = 0.35;
const SNOW_FINE_WEIGHT = 0.2;
/** Half-width of the snow edge in noise units. */
const SNOW_EDGE = 0.07;
/** Per-pixel grain breaking the edge into the ground's own pixel grid. */
const SNOW_GRAIN = 0.08;
/** The noise level snow starts at under the lightest cover, and under full cover. The full level
 *  leaves the highest-lying and steepest ground bare, so even deep snow never becomes a sheet. */
const SNOW_NONE_THRESHOLD = 0.78;
const SNOW_FULL_THRESHOLD = 0.33;
/** Steep ground holds only thin snow: how fast a slope (lane off neutral) counts as steep, and the
 *  noise a full slope takes off. */
const SNOW_SLOPE_FALLOFF = 3.0;
const SNOW_SLOPE_PENALTY = 0.22;
/** Bright grass tips poke through: the luma band over which a grass texel counts as a tip, and the
 *  noise a tip takes off. */
const SNOW_TIP_LUMA_LOW = 0.28;
const SNOW_TIP_LUMA_HIGH = 0.5;
const SNOW_TIP_PENALTY = 0.22;
/** Bare rock sheds snow: the saturation band below which a texel counts as grey stone, and the noise
 *  stone takes off. */
const SNOW_ROCK_SATURATION_LOW = 0.06;
const SNOW_ROCK_SATURATION_HIGH = 0.16;
const SNOW_ROCK_PENALTY = 0.15;
/** Snow colour: a cool white that survives the warm post grade. */
const SNOW_COLOUR = 'vec3(0.94, 0.97, 1.06)';
/** Shaded snow turns blue: the tint of snow in full shade and the lane at which shade is full. */
const SNOW_SHADE_TINT = 'vec3(0.84, 0.9, 1.04)';
const SNOW_SHADE_LANE = 0.75;
/** Snow brightness follows the ground texel's luma about this pivot, so the pixel art's relief
 *  still reads through; clamped so dark ground cannot grey the snow out. */
const SNOW_TONE_PIVOT = 0.3;
const SNOW_TONE_BASE = 0.86;
const SNOW_RELIEF = 0.9;
const SNOW_TONE_MIN = 0.74;
const SNOW_TONE_MAX = 1.0;
/** How much of the terrain lighting (the lane multiplier) the snow takes: full lighting blows a
 *  lit slope's snow out to flat white. */
const SNOW_LIGHT_RESPONSE = 0.55;
/** The smallest lane the snow's own lighting is divided back out of. */
const MIN_LANE = 0.05;
/** Snow opacity at a drift's thin edge, and in its deep middle under full cover: the ground's hue
 *  and relief always show through. */
const SNOW_THIN_OPACITY = 0.35;
const SNOW_DEEP_OPACITY = 0.8;
/** Noise units from a drift's edge to its deep middle. */
const SNOW_DEEPEN = 0.12;
/** Bare ground between the drifts dulls under frost: saturation it loses and the cool lift it takes
 *  under full cover, so the drifts sit on a wintry ground instead of on summer green. */
const FROST_DESATURATE = 0.3;
const FROST_LIFT = 'vec3(0.02, 0.03, 0.05)';
/** Ground this bright, pale and cool already is painted snow, its blue-grey shading included; cover
 *  keeps off most of it so the painted relief survives. Warm pale ground (sand, dry grass) is not. */
const SNOWY_LUMA_LOW = 0.48;
const SNOWY_LUMA_HIGH = 0.7;
const SNOWY_SATURATION_LOW = 0.2;
const SNOWY_SATURATION_HIGH = 0.35;
const SNOWY_WARMTH_MAX = 0.06;
const SNOWY_KEEP = 0.9;

/** Decor dusting: snow settles only on a sprite's lit, upward faces and its top rim, a little further
 *  down as the cover deepens; the shaded body keeps its own colours. */
const DECOR_SHADE_LUMA = 0.12;
const DECOR_LIGHT_LUMA = 0.55;
/** Share of its ground drift's snow a sprite still takes on bare ground: snow settles on stone and
 *  bark before the ground holds it. */
const DECOR_BARE_SHARE = 0.5;
/** Weights of a texel's light, its top rim and its pixel grain in its claim on the snow. */
const DECOR_LIGHT_WEIGHT = 0.6;
const DECOR_RIM_WEIGHT = 0.6;
const DECOR_GRAIN = 0.2;
/** The claim a texel needs under the lightest dusting and under full cover; the soft edge around it. */
const DECOR_CLAIM_LIGHT = 1.05;
const DECOR_CLAIM_FULL = 0.55;
const DECOR_CLAIM_EDGE = 0.15;
/** Opacity of the settled snow, and the tone its shaded side keeps. */
const DECOR_SNOW_OPACITY = 0.78;
const DECOR_SNOW_SHADE = 0.72;
/** The faint frosted look the rest of the sprite takes: a cooled, desaturated lift. */
const DECOR_FROST = 0.12;
const DECOR_FROST_TINT = 'vec3(0.82, 0.86, 0.92)';
const DECOR_FROST_LIFT = 0.1;

/** Dust streaks run along the wind: long in x, short in y (world px). */
const DUST_STREAK_X_PX = 90;
const DUST_STREAK_Y_PX = 12;
/** The share of full dust the thinnest streak still carries. */
const DUST_FLOOR = 0.15;
const DUST_COLOUR_RGB = [0.8, 0.68, 0.5] as const;
const DUST_COLOUR = `vec3(${DUST_COLOUR_RGB.join(', ')})`;
const DUST_LUMA = DUST_COLOUR_RGB.reduce((sum, channel, i) => sum + channel * (LUMA_WEIGHTS[i] ?? 0), 0);
/** Dust dulls the ground toward its own hue but keeps this share of the ground's brightness, so the
 *  relief and every terrain edge still read. */
const DUST_RELIEF = 0.75;
const DUST_OPACITY = 0.26;
/** Wind ripples on bare ground under dust, only in scattered drift patches: crest spacing, the noise
 *  warp bending the crests and its scale, the patch size (world px), and their brightness swing. */
const DUST_RIPPLE_PX = 6;
const DUST_RIPPLE_WARP_PX = 9;
const DUST_RIPPLE_WARP_SCALE_PX = 16;
const DUST_RIPPLE_PATCH_SCALE_PX = 45;
const DUST_RIPPLE_PATCH_LOW = 0.5;
const DUST_RIPPLE_PATCH_HIGH = 0.8;
const DUST_RIPPLE_GAIN = 0.06;
/** Crests lean off the vertical by this much x per px of y, so they do not line up with the pixel grid. */
const DUST_RIPPLE_LEAN = 0.35;

const TAU = 2 * Math.PI;

const f = (value: number): string => value.toFixed(4);

/** Value noise, the transition jitter and the snow drift mask, shared by the ground and the decor. */
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
  // Ground px with y stretched back to the ground plane.
  vec2 coverPlane(vec2 drawn) {
    return vec2(drawn.x, drawn.y * ${f(ISO_Y_STRETCH)});
  }
  // Cover partway between sectors, pushed by broad noise; full and bare cover stay as they are.
  vec3 coverJitter(vec3 cover, vec2 p) {
    float push = ${f(TRANSITION_JITTER)} * (coverNoise(p / ${f(TRANSITION_SCALE_PX)} + 31.0) - 0.5);
    return clamp(cover + push * 4.0 * cover * (1.0 - cover), 0.0, 1.0);
  }
  // The drift noise at a ground-plane px, before any grain or ground penalty.
  float snowNoise(vec2 p) {
    return ${f(SNOW_DRIFT_WEIGHT)} * coverNoise(p / ${f(SNOW_DRIFT_SCALE_PX)})
      + ${f(SNOW_PATCH_WEIGHT)} * coverNoise(p / ${f(SNOW_PATCH_SCALE_PX)} + 53.0)
      + ${f(SNOW_FINE_WEIGHT)} * coverNoise(p / ${f(SNOW_FINE_SCALE_PX)} + 97.0);
  }
  // The noise level a drift starts at under snow cover g: above any noise for none.
  float snowThreshold(float g) {
    return g > 0.0 ? mix(${f(SNOW_NONE_THRESHOLD)}, ${f(SNOW_FULL_THRESHOLD)}, g) : 2.0;
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
    vec2 p = coverPlane(px);
    cover.rgb = coverJitter(cover.rgb, p);
    float inv = 1.0 / max(alpha, ${f(MIN_ALPHA)});
    float grey = dot(rgb, ${LUMA});
    float luma = grey * inv;
    float level = 1.0 - clamp(abs(lane - 1.0) * ${f(PUDDLE_SLOPE_FALLOFF)}, 0.0, 1.0);
    float grass = smoothstep(0.0, ${f(GRASS_GREEN_LEAD)}, (rgb.g - max(rgb.r, rgb.b)) * inv);
    if (cover.r > 0.0) {
      float wet = cover.r * (1.0 - ${f(WET_PATCHINESS)} * coverNoise(p / ${f(WET_PATCH_SCALE_PX)} + 71.0));
      float highlight = smoothstep(${f(WET_SHADOW_LUMA)}, ${f(WET_HIGHLIGHT_LUMA)}, luma);
      float darken = mix(${f(WET_DARKEN)}, ${f(WET_HIGHLIGHT_DARKEN)}, highlight);
      rgb = mix(vec3(grey), rgb, 1.0 + ${f(WET_SATURATION)} * wet) * (1.0 - darken * wet);
      float streak = smoothstep(${f(SHEEN_NOISE_LOW)}, ${f(SHEEN_NOISE_HIGH)},
        coverNoise(p / ${f(SHEEN_SCALE_PX)}));
      rgb += ${SHEEN_COLOUR} * (${f(SHEEN_GAIN)} * wet * streak * highlight * alpha);
      float onset = smoothstep(${f(PUDDLE_ONSET)}, 1.0, cover.r);
      if (onset > 0.0) {
        float n = coverFbm(p / ${f(PUDDLE_SCALE_PX)})
          + ${f(PUDDLE_SHORE_FRAY)} * (coverNoise(p / ${f(PUDDLE_SHORE_SCALE_PX)}) - 0.5)
          - ${f(PUDDLE_UNLEVEL_PENALTY)} * (1.0 - level) - ${f(GRASS_PUDDLE_PENALTY)} * grass;
        float threshold = mix(${f(PUDDLE_THRESHOLD_ONSET)}, ${f(PUDDLE_THRESHOLD_SOAKED)}, onset);
        float shore = smoothstep(threshold, threshold + ${f(PUDDLE_EDGE)}, n) * onset;
        float water = smoothstep(threshold + ${f(PUDDLE_EDGE / 2)}, threshold + ${f(PUDDLE_EDGE * 1.5)}, n)
          * onset;
        if (shore > 0.0) {
          float sky = 1.0 + ${f(PUDDLE_SKY_VARIATION)} * (coverNoise(p / ${f(PUDDLE_SKY_SCALE_PX)}) - 0.5);
          vec3 bed = rgb * (1.0 - ${f(PUDDLE_BED_DARKEN)});
          vec3 surface = mix(bed, ${PUDDLE_SKY} * (sky * alpha), ${f(PUDDLE_MIRROR)});
          rgb = mix(rgb * (1.0 - ${f(PUDDLE_SHORE_DARKEN)} * shore), surface, water * ${f(PUDDLE_OPACITY)});
          float rain = cover.a * uCoverClock.y;
          // Slush does not ring: the rings fade out under the snow cover.
          float openWater = water * (1.0 - cover.g);
          if (openWater > 0.0 && rain > 0.0)
            rgb += ${PUDDLE_RING_COLOUR} * (${f(PUDDLE_RING_GAIN)} * openWater * puddleRings(px, rain) * alpha);
        }
      }
    }
    if (cover.g > 0.0) {
      vec3 straight = rgb * inv;
      float saturation = max(straight.r, max(straight.g, straight.b)) - min(straight.r, min(straight.g, straight.b));
      float snowy = smoothstep(${f(SNOWY_LUMA_LOW)}, ${f(SNOWY_LUMA_HIGH)}, luma)
        * (1.0 - smoothstep(${f(SNOWY_SATURATION_LOW)}, ${f(SNOWY_SATURATION_HIGH)}, saturation))
        * (1.0 - smoothstep(0.0, ${f(SNOWY_WARMTH_MAX)}, straight.r - straight.b));
      float rock = (1.0 - smoothstep(${f(SNOW_ROCK_SATURATION_LOW)}, ${f(SNOW_ROCK_SATURATION_HIGH)}, saturation))
        * (1.0 - snowy);
      float tip = grass * smoothstep(${f(SNOW_TIP_LUMA_LOW)}, ${f(SNOW_TIP_LUMA_HIGH)}, luma);
      float n = snowNoise(p) + (coverHash(ivec2(px)) - 0.5) * ${f(SNOW_GRAIN)}
        - ${f(SNOW_SLOPE_PENALTY)} * clamp(abs(lane - 1.0) * ${f(SNOW_SLOPE_FALLOFF)}, 0.0, 1.0)
        - ${f(SNOW_TIP_PENALTY)} * tip - ${f(SNOW_ROCK_PENALTY)} * rock;
      float threshold = snowThreshold(cover.g);
      float mask = snowMask(n, threshold) * (1.0 - ${f(SNOWY_KEEP)} * snowy);
      float depth = mix(${f(SNOW_THIN_OPACITY)}, mix(${f(SNOW_THIN_OPACITY)}, ${f(SNOW_DEEP_OPACITY)}, cover.g),
        smoothstep(threshold, threshold + ${f(SNOW_DEEPEN)}, n));
      float tone = clamp(${f(SNOW_TONE_BASE)} + ${f(SNOW_RELIEF)} * (luma - ${f(SNOW_TONE_PIVOT)}),
        ${f(SNOW_TONE_MIN)}, ${f(SNOW_TONE_MAX)});
      vec3 shade = mix(${SNOW_SHADE_TINT}, vec3(1.0), smoothstep(${f(SNOW_SHADE_LANE)}, 1.0, lane));
      // The caller multiplies by the lane afterwards, so divide it back out of the snow's own share.
      float lit = mix(1.0, lane, ${f(SNOW_LIGHT_RESPONSE)}) / max(lane, ${f(MIN_LANE)});
      rgb = mix(rgb, vec3(dot(rgb, ${LUMA})), ${f(FROST_DESATURATE)} * cover.g) + ${FROST_LIFT} * (cover.g * alpha);
      rgb = mix(rgb, ${SNOW_COLOUR} * shade * (tone * lit * alpha), mask * depth);
    }
    if (cover.b > 0.0) {
      vec3 straight = rgb * inv;
      float l = dot(straight, ${LUMA});
      float streak = coverNoise(vec2(p.x / ${f(DUST_STREAK_X_PX)}, p.y / ${f(DUST_STREAK_Y_PX * ISO_Y_STRETCH)}));
      float dust = cover.b * mix(${f(DUST_FLOOR)}, 1.0, streak);
      vec3 coat = ${DUST_COLOUR} * (mix(${f(DUST_LUMA)}, l, ${f(DUST_RELIEF)}) / ${f(DUST_LUMA)});
      straight = mix(straight, coat, dust * ${f(DUST_OPACITY)});
      float warp = ${f(DUST_RIPPLE_WARP_PX)} * coverNoise(p / ${f(DUST_RIPPLE_WARP_SCALE_PX)} + 13.0);
      float ripple = sin((p.x + ${f(DUST_RIPPLE_LEAN)} * p.y + warp) * ${f(TAU / DUST_RIPPLE_PX)});
      float drift = smoothstep(${f(DUST_RIPPLE_PATCH_LOW)}, ${f(DUST_RIPPLE_PATCH_HIGH)},
        coverNoise(p / ${f(DUST_RIPPLE_PATCH_SCALE_PX)} + 41.0));
      straight *= 1.0 + ${f(DUST_RIPPLE_GAIN)} * ripple * drift * (1.0 - grass) * dust;
      rgb = straight * alpha;
    }
    return rgb;
  }
`;

/**
 * Decor vertex declarations: `aAnchor` is the quad's drawn feet anchor in world px, constant across the
 * quad, so the whole sprite takes the snow of the ground drift it stands in. The cover is read at the
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

/** Decor vertex body: the anchor's cover and the ground's drift there, once per vertex. */
export const DECOR_COVER_VERTEX_BODY = `
    vSnow = 0.0;
    if (uCover > 0.5) {
      vec2 node = vec2(aAnchor.x / ${f(TILE_HALF_W)}, 2.0 * aAnchor.y / ${f(TILE_HALF_H)});
      vec2 p = coverPlane(floor(aAnchor) + 0.5);
      float g = coverJitter(textureLod(uCoverTex, node * uCoverNodeScale, 0.0).rgb, p).g;
      if (g > 0.0) vSnow = mix(${f(DECOR_BARE_SHARE)}, 1.0, snowMask(snowNoise(p), snowThreshold(g))) * g;
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
