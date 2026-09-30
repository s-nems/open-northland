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
 * whole pass: 0 draws the ground exactly as before. Beyond the cover texel the pass reads four ground
 * taps to classify the ground under snow; its noise is arithmetic.
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
/** Extra gain while rain falls hard, which offsets the cool grade and grey veil of the rain's air so
 *  soaked ground still reads more saturated than dry ground in clear weather. Tuned by eye. */
const WET_RAIN_SATURATION = 0.25;
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
 *  the wandering of a drift's edge. No octave is finer than a few px, so the snow reads as a smooth
 *  field with soft edges rather than pixel speckle. */
const SNOW_DRIFT_SCALE_PX = 140;
const SNOW_PATCH_SCALE_PX = 36;
const SNOW_EDGE_SCALE_PX = 15;
const SNOW_DRIFT_WEIGHT = 0.47;
const SNOW_PATCH_WEIGHT = 0.38;
const SNOW_EDGE_WEIGHT = 0.15;
/** Zoomed out, the edge octave fades out between these zooms, so drifts stay drifts instead of
 *  breaking into speckle; at default zoom it is all there. */
const SNOW_DETAIL_FULL_ZOOM = 0.85;
const SNOW_DETAIL_GONE_ZOOM = 0.45;
/** Mean of the value noise, which a faded octave settles on. */
const NOISE_MEAN = 0.5;
/** Half-width of the snow edge in noise units: a few px of feathering at default zoom. */
const SNOW_EDGE = 0.045;
/** The noise level snow starts at under the lightest cover, and under full cover. The full level
 *  leaves the highest-lying and steepest ground bare, so even deep snow never becomes a sheet. */
const SNOW_NONE_THRESHOLD = 0.78;
const SNOW_FULL_THRESHOLD = 0.33;
/** Steep ground holds only thin snow: how fast a slope (lane off neutral) counts as steep, and the
 *  noise a full slope takes off. */
const SNOW_SLOPE_FALLOFF = 3.0;
const SNOW_SLOPE_PENALTY = 0.22;
/** The ground is classified from the average of four taps this many texels out, not per texel, so a
 *  bright grass blade or a grey pebble in the pattern cannot switch the snow on or off by itself. */
const GROUND_TAP_TEXELS = 3;
/** Tall grass holds snow up off the ground: the noise grassy ground takes off, so its drifts lie a
 *  little thinner. */
const SNOW_GRASS_PENALTY = 0.08;
/** Bare rock sheds snow: the saturation band below which ground counts as grey stone, and the noise
 *  stone takes off. */
const SNOW_ROCK_SATURATION_LOW = 0.06;
const SNOW_ROCK_SATURATION_HIGH = 0.16;
const SNOW_ROCK_PENALTY = 0.12;
/** Snow colour on a drift's crest: a cool white that survives the warm post grade. */
const SNOW_COLOUR = 'vec3(0.94, 0.97, 1.06)';
/** Thin snow and the hollows between crests read blue-grey: the tint there, and the noise units above
 *  the drift's start over which it turns to crest white. */
const SNOW_HOLLOW_TINT = 'vec3(0.8, 0.85, 0.95)';
const SNOW_CREST_LOW = 0.02;
const SNOW_CREST_HIGH = 0.2;
/** Where a drift thins out its edge reads a touch darker, as packed snow over damp ground: the
 *  darkening and its width in noise units inside the edge. */
const SNOW_RIM_DARKEN = 0.1;
const SNOW_RIM_WIDTH = 0.05;
/** Shaded snow turns blue: the tint of snow in full shade and the lane at which shade is full. */
const SNOW_SHADE_TINT = 'vec3(0.84, 0.9, 1.04)';
const SNOW_SHADE_LANE = 0.75;
/** A trace of the ground's own pixel relief shows through the snow body, measured against its
 *  neighbourhood so dark ground does not grey the snow out. */
const SNOW_RELIEF = 0.25;
/** How much of the terrain lighting (the lane multiplier) the snow takes: full lighting blows a
 *  lit slope's snow out to flat white. */
const SNOW_LIGHT_RESPONSE = 0.55;
/** The smallest lane the snow's own lighting is divided back out of. */
const MIN_LANE = 0.05;
/** Snow opacity at a drift's thin edge, and in its deep middle under full cover: the ground's hue
 *  and relief always show through. */
const SNOW_THIN_OPACITY = 0.4;
const SNOW_DEEP_OPACITY = 0.82;
/** Noise units from a drift's edge to its deep middle. */
const SNOW_DEEPEN = 0.14;
/** Bare ground between the drifts dulls under frost: saturation it loses and the cool lift it takes
 *  under full cover, so the drifts sit on a wintry ground instead of on summer green. */
const FROST_DESATURATE = 0.38;
const FROST_LIFT = 'vec3(0.02, 0.03, 0.05)';
/** Ground this bright, pale and cool already is painted snow, its blue-grey shading included; cover
 *  keeps off most of it so the painted relief survives. Warm pale ground (sand, dry grass) is not. */
const SNOWY_LUMA_LOW = 0.48;
const SNOWY_LUMA_HIGH = 0.7;
const SNOWY_SATURATION_LOW = 0.2;
const SNOWY_SATURATION_HIGH = 0.35;
const SNOWY_WARMTH_MAX = 0.06;
const SNOWY_KEEP = 0.9;

/** Snow on a sprite gathers where the rows above it are clear: the weights of the first three rows
 *  above in that test, so a cap fades over a few rows instead of stopping at one. */
const CAP_ROW_WEIGHTS = [0.5, 0.3, 0.2] as const;
/** A cap needs a surface to lie on: the share of the cap a texel with clear sides keeps (a blade tip),
 *  against one with filled sides (a mushroom top, a stone). */
const CAP_BARE_SIDE_SHARE = 0.25;
/** Luma band from shade to lit: lit faces face up to the sky and hold more of the snow. */
const CAP_SHADE_LUMA = 0.12;
const CAP_LIGHT_LUMA = 0.55;
const CAP_LIGHT_SHARE = 0.35;
/** Snow opacity on a full cap, and the tone its shaded side keeps. */
const CAP_OPACITY = 0.85;
/** The raw claim band a cap turns from bare to full snow over: a soft lower edge, a solid top. */
const CAP_CLAIM_LOW = 0.12;
const CAP_CLAIM_HIGH = 0.6;
const CAP_SHADE_TONE = 0.78;
/** Zoomed out, a cap's few rows shrink under a pixel and would read as speckle: between these texels
 *  per screen px the decor's caps fade to this share. */
const CAP_MINIFY_FULL = 1.0;
const CAP_MINIFY_GONE = 2.2;
const CAP_MINIFIED_SHARE = 0.35;
/** Decor: the share of full cover its upper part takes as a soft lightening over the sprite height,
 *  and the share of the sprite height, from the top, it reaches down. */
const DECOR_UPPER_GAIN = 0.35;
const DECOR_UPPER_REACH = 0.55;
/** Decor on a snowed drift sinks in: the share of its height from the ground that blends toward the
 *  lying snow, the share of that blend its top keeps (flat decor is all foot), and its strongest
 *  opacity. */
const DECOR_BURY_HEIGHT = 0.45;
const DECOR_BURY_TOP_SHARE = 0.15;
const DECOR_BURY_OPACITY = 0.55;
/** Share of its ground drift's snow a sprite still takes on bare ground: snow settles on stone and
 *  leaves before the ground holds it. */
const DECOR_BARE_SHARE = 0.5;
/** The faint frosted look the rest of the sprite takes: a cooled, desaturated lift. */
const DECOR_FROST = 0.15;
const DECOR_FROST_TINT = 'vec3(0.82, 0.86, 0.92)';
const DECOR_FROST_LIFT = 0.1;
/** The decor quad writes its two top corners first (decor-batch). */
const QUAD_CORNERS = 4;
const QUAD_TOP_CORNERS = 2;

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
  // The drift noise at a ground-plane px, before any ground penalty; 'detail' 0..1 keeps the edge
  // octave, which settles on its mean without it.
  float snowNoise(vec2 p, float detail) {
    float edge = detail > 0.0 ? coverNoise(p / ${f(SNOW_EDGE_SCALE_PX)} + 97.0) : ${f(NOISE_MEAN)};
    return ${f(SNOW_DRIFT_WEIGHT)} * coverNoise(p / ${f(SNOW_DRIFT_SCALE_PX)})
      + ${f(SNOW_PATCH_WEIGHT)} * coverNoise(p / ${f(SNOW_PATCH_SCALE_PX)} + 53.0)
      + ${f(SNOW_EDGE_WEIGHT)} * mix(${f(NOISE_MEAN)}, edge, detail);
  }
  // The noise level a drift starts at under snow cover g: above any noise for none.
  float snowThreshold(float g) {
    return g > 0.0 ? mix(${f(SNOW_NONE_THRESHOLD)}, ${f(SNOW_FULL_THRESHOLD)}, g) : 2.0;
  }
  float snowMask(float n, float threshold) {
    return smoothstep(threshold - ${f(SNOW_EDGE)}, threshold + ${f(SNOW_EDGE)}, n);
  }
`;

/**
 * A sprite texel's claim on settled snow, 0..1, from how clear the rows above it are, the alpha beside
 * it and its luma: snow lies on the top surfaces and lit faces, fading down over a few rows. Every
 * input is a smooth weight, so no single texel flips on alone.
 */
const SNOW_CAP = `
  // How clear the three rows above a texel are, nearest first.
  float capClear(vec3 above) {
    return 1.0 - dot(above, vec3(${CAP_ROW_WEIGHTS.map(f).join(', ')}));
  }
  float snowCap(float clear, float sides, float luma) {
    float support = mix(${f(CAP_BARE_SIDE_SHARE)}, 1.0, sides);
    float light = smoothstep(${f(CAP_SHADE_LUMA)}, ${f(CAP_LIGHT_LUMA)}, luma);
    return smoothstep(${f(CAP_CLAIM_LOW)}, ${f(CAP_CLAIM_HIGH)},
      clear * support * mix(1.0 - ${f(CAP_LIGHT_SHARE)}, 1.0, light));
  }
  vec3 snowCapColour(float luma, float lit) {
    return ${SNOW_COLOUR} * mix(${f(CAP_SHADE_TONE)}, 1.0,
      smoothstep(${f(CAP_SHADE_LUMA)}, ${f(CAP_LIGHT_LUMA)}, luma)) * lit;
  }
`;

/** Vertex declarations: the cover UV rides the unlifted brightness-lane UV, the noise the drawn position. */
export const COVER_VERTEX_DECLARATIONS = `
  uniform vec4 uCoverMap; // xy scale, zw offset from the brightness-lane UV to the cover UV
  out vec2 vCoverUV;
  out vec2 vGroundPos;
  flat out float vCoverZoom;
`;

/** Vertex body; needs `aBrightnessUV`, `aPosition` and the transform matrices. */
export const COVER_VERTEX_BODY = `
    vCoverUV = aBrightnessUV * uCoverMap.xy + uCoverMap.zw;
    vGroundPos = aPosition;
    // Screen px per world px: the camera zoom and any view scale above it.
    vCoverZoom = length((uWorldTransformMatrix * uTransformMatrix)[0].xy);
`;

export const COVER_FRAGMENT_DECLARATIONS = `
  uniform sampler2D uCoverTex;
  uniform float uCover;
  uniform vec2 uCoverClock; // x game seconds, y rain falling on screen 0..1
  in vec2 vCoverUV;
  in vec2 vGroundPos;
  flat in float vCoverZoom;
  ${COVER_NOISE}

  // The ground's straight colour averaged over four taps round the fragment, kept inside its tile.
  // Needs the terrain shader's uTexture, vUV and vSampleBounds.
  vec3 groundNeighbourhood() {
    vec2 size = vec2(textureSize(uTexture, 0));
    vec2 centre = (vSampleBounds.xy + vSampleBounds.zw) * 0.5;
    vec2 low = min(vSampleBounds.xy + 0.5 / size, centre);
    vec2 high = max(vSampleBounds.zw - 0.5 / size, centre);
    vec2 d = ${f(GROUND_TAP_TEXELS)} / size;
    vec4 sum = textureLod(uTexture, clamp(vUV + d, low, high), 0.0)
      + textureLod(uTexture, clamp(vUV - d, low, high), 0.0)
      + textureLod(uTexture, clamp(vUV + vec2(d.x, -d.y), low, high), 0.0)
      + textureLod(uTexture, clamp(vUV + vec2(-d.x, d.y), low, high), 0.0);
    return sum.rgb / max(sum.a, ${f(MIN_ALPHA)});
  }

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

  // rgb is premultiplied by alpha; lane is the fragment's brightness multiplier (1 = level ground);
  // near is the ground's straight colour averaged over its neighbourhood.
  vec3 weatherCover(vec3 rgb, float alpha, float lane, vec4 cover, vec3 near) {
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
      float wetSaturation = ${f(WET_SATURATION)} + ${f(WET_RAIN_SATURATION)} * cover.a * uCoverClock.y;
      rgb = mix(vec3(grey), rgb, 1.0 + wetSaturation * wet) * (1.0 - darken * wet);
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
      // Classified from the neighbourhood, never the texel, so no single pixel flips the snow.
      float nearLuma = dot(near, ${LUMA});
      float nearSaturation = max(near.r, max(near.g, near.b)) - min(near.r, min(near.g, near.b));
      float nearGrass = smoothstep(0.0, ${f(GRASS_GREEN_LEAD)}, near.g - max(near.r, near.b));
      float snowy = smoothstep(${f(SNOWY_LUMA_LOW)}, ${f(SNOWY_LUMA_HIGH)}, nearLuma)
        * (1.0 - smoothstep(${f(SNOWY_SATURATION_LOW)}, ${f(SNOWY_SATURATION_HIGH)}, nearSaturation))
        * (1.0 - smoothstep(0.0, ${f(SNOWY_WARMTH_MAX)}, near.r - near.b));
      float rock = (1.0 - smoothstep(${f(SNOW_ROCK_SATURATION_LOW)}, ${f(SNOW_ROCK_SATURATION_HIGH)}, nearSaturation))
        * (1.0 - snowy);
      float detail = smoothstep(${f(SNOW_DETAIL_GONE_ZOOM)}, ${f(SNOW_DETAIL_FULL_ZOOM)}, vCoverZoom);
      float n = snowNoise(p, detail)
        - ${f(SNOW_SLOPE_PENALTY)} * clamp(abs(lane - 1.0) * ${f(SNOW_SLOPE_FALLOFF)}, 0.0, 1.0)
        - ${f(SNOW_GRASS_PENALTY)} * nearGrass - ${f(SNOW_ROCK_PENALTY)} * rock;
      float threshold = snowThreshold(cover.g);
      float mask = snowMask(n, threshold) * (1.0 - ${f(SNOWY_KEEP)} * snowy);
      float body = smoothstep(threshold, threshold + ${f(SNOW_DEEPEN)}, n);
      float depth = mix(${f(SNOW_THIN_OPACITY)}, mix(${f(SNOW_THIN_OPACITY)}, ${f(SNOW_DEEP_OPACITY)}, cover.g), body);
      float crest = smoothstep(threshold + ${f(SNOW_CREST_LOW)}, threshold + ${f(SNOW_CREST_HIGH)}, n);
      float rim = 1.0 - smoothstep(threshold, threshold + ${f(SNOW_RIM_WIDTH)}, n);
      float tone = (1.0 + ${f(SNOW_RELIEF)} * (luma - nearLuma)) * (1.0 - ${f(SNOW_RIM_DARKEN)} * rim);
      vec3 colour = mix(${SNOW_HOLLOW_TINT}, ${SNOW_COLOUR}, crest);
      vec3 shade = mix(${SNOW_SHADE_TINT}, vec3(1.0), smoothstep(${f(SNOW_SHADE_LANE)}, 1.0, lane));
      // The caller multiplies by the lane afterwards, so divide it back out of the snow's own share.
      float lit = mix(1.0, lane, ${f(SNOW_LIGHT_RESPONSE)}) / max(lane, ${f(MIN_LANE)});
      rgb = mix(rgb, vec3(dot(rgb, ${LUMA})), ${f(FROST_DESATURATE)} * cover.g) + ${FROST_LIFT} * (cover.g * alpha);
      rgb = mix(rgb, colour * shade * (tone * lit * alpha), mask * depth);
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
  flat out float vCoverSnow;
  out float vUp;
  out vec2 vDecorPos;
  ${COVER_NOISE}
`;

/** Decor vertex body: the anchor's cover and the ground's drift there, once per vertex. */
export const DECOR_COVER_VERTEX_BODY = `
    vSnow = 0.0;
    vCoverSnow = 0.0;
    vUp = 0.0;
    vDecorPos = vec2(0.0);
    if (uCover > 0.5) {
      // 1 on the quad's top edge, 0 on its bottom.
      vUp = gl_VertexID % ${QUAD_CORNERS} < ${QUAD_TOP_CORNERS} ? 1.0 : 0.0;
      vDecorPos = aPosition;
      vec2 node = vec2(aAnchor.x / ${f(TILE_HALF_W)}, 2.0 * aAnchor.y / ${f(TILE_HALF_H)});
      vec2 p = coverPlane(floor(aAnchor) + 0.5);
      float g = coverJitter(textureLod(uCoverTex, node * uCoverNodeScale, 0.0).rgb, p).g;
      if (g > 0.0) {
        vCoverSnow = g;
        vSnow = mix(${f(DECOR_BARE_SHARE)}, 1.0, snowMask(snowNoise(p, 1.0), snowThreshold(g))) * g;
      }
    }
`;

export const DECOR_COVER_FRAGMENT_DECLARATIONS = `
  flat in float vSnow;
  flat in float vCoverSnow;
  in float vUp;
  in vec2 vDecorPos;
  ${COVER_NOISE}
  ${SNOW_CAP}

  // Snow a decor texel (premultiplied rgb): a soft cap on its top surfaces and upper part, its foot
  // sunk into a snowed drift. uv is its page UV; lane its brightness multiplier.
  vec3 decorSnow(vec3 rgb, float alpha, vec2 uv, float lane) {
    vec2 size = vec2(textureSize(uTexture, 0));
    vec2 texel = 1.0 / size;
    // vSnow is flat across the quad, so the branch around this call keeps derivatives defined.
    vec2 footprint = fwidth(uv * size);
    float minified = smoothstep(${f(CAP_MINIFY_FULL)}, ${f(CAP_MINIFY_GONE)}, max(footprint.x, footprint.y));
    vec3 straight = rgb / max(alpha, ${f(MIN_ALPHA)});
    float luma = dot(straight, ${LUMA});
    // The page keeps a one-texel transparent gutter round every frame, so a row further up counts only
    // while the rows between are filled: past a clear row it could be a neighbour frame.
    vec3 above = vec3(texture(uTexture, uv - vec2(0.0, texel.y)).a, 0.0, 0.0);
    if (above.x > 0.0) above.y = texture(uTexture, uv - vec2(0.0, 2.0 * texel.y)).a;
    if (above.y > 0.0) above.z = texture(uTexture, uv - vec2(0.0, 3.0 * texel.y)).a;
    float sides = 0.5 * (texture(uTexture, uv - vec2(texel.x, 0.0)).a + texture(uTexture, uv + vec2(texel.x, 0.0)).a);
    float upper = smoothstep(1.0 - ${f(DECOR_UPPER_REACH)}, 1.0, vUp);
    float cap = max(snowCap(capClear(above), sides, luma) * mix(1.0, ${f(CAP_MINIFIED_SHARE)}, minified),
      ${f(DECOR_UPPER_GAIN)} * upper) * vSnow;
    // Flat decor lies on the ground it is drawn over, so the drift there is the one it sinks into.
    float drift = snowMask(snowNoise(coverPlane(floor(vDecorPos) + 0.5), 1.0), snowThreshold(vCoverSnow));
    float buried = mix(1.0, ${f(DECOR_BURY_TOP_SHARE)}, smoothstep(0.0, ${f(DECOR_BURY_HEIGHT)}, vUp))
      * drift * vCoverSnow;
    float lit = mix(1.0, lane, ${f(SNOW_LIGHT_RESPONSE)}) / max(lane, ${f(MIN_LANE)});
    vec3 frosted = mix(straight, vec3(luma) * ${DECOR_FROST_TINT} + ${f(DECOR_FROST_LIFT)}, ${f(DECOR_FROST)} * vSnow);
    vec3 capped = mix(frosted, snowCapColour(luma, lit), cap * ${f(CAP_OPACITY)});
    return mix(capped, ${SNOW_HOLLOW_TINT} * lit, buried * ${f(DECOR_BURY_OPACITY)}) * alpha;
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

/** Cover texels are RGBA bytes, snow in green. */
const COVER_TEXEL_BYTES = 4;
export const COVER_SNOW_CHANNEL = 1;

/** A cover texture of `width` by `height` sectors, all clear. */
export function makeGroundCoverTexture(width: number, height: number): BufferImageSource {
  return new BufferImageSource({
    resource: new Uint8Array(Math.max(1, width) * Math.max(1, height) * COVER_TEXEL_BYTES),
    width: Math.max(1, width),
    height: Math.max(1, height),
    // The cover is a smooth field between sector centres, not pixel art.
    scaleMode: 'linear',
    // Alpha is its own channel (rain falling), not coverage: a premultiplied upload would zero the rest.
    alphaMode: 'no-premultiply-alpha',
    addressMode: 'clamp-to-edge',
  });
}
