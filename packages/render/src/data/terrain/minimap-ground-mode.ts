/** How much of the styled ground shows under the minimap markers: all of it, dimmed so owner colours
 *  stand out, barely there for play that watches units, or none at all. */
export const MINIMAP_GROUND_MODES = ['natural', 'muted', 'dark', 'hidden'] as const;
export type MinimapGroundMode = (typeof MINIMAP_GROUND_MODES)[number];

/** A grade over the natural raster: luma is pulled toward `pivot` by `contrast`, chroma kept at
 *  `saturation` (`waterSaturation` on blue water), and the result scaled to `value`. All factors are
 *  shares of the natural picture. */
interface GroundGrade {
  readonly saturation: number;
  /** Water keeps more of its blue, so the coast still reads once the land is grey. */
  readonly waterSaturation: number;
  readonly value: number;
  readonly contrast: number;
  /** The luma, 0..255, that contrast compression keeps in place. */
  readonly pivot: number;
}

const MID_GREY = 128;

/** Tuned by eye on magiczny_las; an approximation. */
const MUTED_GRADE: GroundGrade = { saturation: 0.4, waterSaturation: 0.7, value: 0.6, contrast: 1, pivot: 0 };
/** Barely there: the relief survives as faint grey shading around mid-grey, the water as a dim blue. */
const DARK_GRADE: GroundGrade = {
  saturation: 0.15,
  waterSaturation: 0.8,
  value: 0.35,
  contrast: 0.6,
  pivot: MID_GREY,
};
/** The flat under the markers with no ground drawn, a near-black warm brown like the panel wood. */
const HIDDEN_GROUND = 0x141210;

/** Rec. 601 luma weights in 1/256ths, so integer RGB keeps the result exact and deterministic. */
const LUMA_R = 77;
const LUMA_G = 150;
const LUMA_B = 29;
const LUMA_SHIFT = 8;
const LUMA_LEVELS = 256;
/** How far, in byte levels, blue must lead red and the green share below for a pixel to count as wholly
 *  water; less lead blends toward the land's saturation, so the coast's foam and banks fade smoothly. */
const WATER_BLUE_LEAD = 40;
/** Turquoise shallows carry nearly as much green as blue, so blue is measured against this share of the
 *  green; grass and sand keep more green than that and stay land. In 1/256ths. */
const WATER_GREEN_SHARE = 205;
const SHARE_SHIFT = 8;
const RGBA = 4;

const GRADES: Readonly<Record<'muted' | 'dark', GroundGrade>> = { muted: MUTED_GRADE, dark: DARK_GRADE };

/**
 * Grade an opaque RGBA minimap raster for `mode` into `target` (by default in place) and return
 * `target`. Alpha is never touched, so an empty raster stays empty. Pure and deterministic.
 */
export function applyMinimapGroundMode(
  source: Uint8Array,
  mode: MinimapGroundMode,
  target: Uint8Array = source,
): Uint8Array {
  if (target.length !== source.length) throw new Error('minimap ground mode: target size differs');
  if (mode === 'natural') {
    if (target !== source) target.set(source);
    return target;
  }
  if (mode === 'hidden') {
    fillFlat(source, target, HIDDEN_GROUND);
    return target;
  }
  grade(source, target, GRADES[mode]);
  return target;
}

function fillFlat(source: Uint8Array, target: Uint8Array, colour: number): void {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  for (let i = 0; i < source.length; i += RGBA) {
    target[i] = r;
    target[i + 1] = g;
    target[i + 2] = b;
    target[i + 3] = source[i + 3] ?? 0;
  }
}

function grade(
  source: Uint8Array,
  target: Uint8Array,
  { saturation, waterSaturation, value, contrast, pivot }: GroundGrade,
): void {
  const lumaOut = new Float64Array(LUMA_LEVELS);
  for (let y = 0; y < LUMA_LEVELS; y++) lumaOut[y] = (pivot + contrast * (y - pivot)) * value;
  const landChroma = saturation * value;
  const waterChromaPerLead = ((waterSaturation - saturation) * value) / WATER_BLUE_LEAD;
  // Writes through the clamped view round and clamp each channel to a byte.
  const out = new Uint8ClampedArray(target.buffer, target.byteOffset, target.length);
  for (let i = 0; i < source.length; i += RGBA) {
    const r = source[i] ?? 0;
    const g = source[i + 1] ?? 0;
    const b = source[i + 2] ?? 0;
    const y = (LUMA_R * r + LUMA_G * g + LUMA_B * b) >> LUMA_SHIFT;
    const base = lumaOut[y] ?? 0;
    const greenShare = (g * WATER_GREEN_SHARE) >> SHARE_SHIFT;
    const lead = Math.min(WATER_BLUE_LEAD, Math.max(0, b - (r > greenShare ? r : greenShare)));
    const chroma = landChroma + waterChromaPerLead * lead;
    out[i] = base + chroma * (r - y);
    out[i + 1] = base + chroma * (g - y);
    out[i + 2] = base + chroma * (b - y);
    out[i + 3] = source[i + 3] ?? 0;
  }
}
