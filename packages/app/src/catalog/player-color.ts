/** The team-colour strength range: the minimum is the retail palette, the maximum the boldest. */
export const TEAM_COLOR_STRENGTH_MIN = 1;
export const TEAM_COLOR_STRENGTH_MAX = 10;

/** Saturation gain at full strength (`s × (1 + gain)`) and the value gamma's gain (`v^(1 / (1 + gain))`). */
const SATURATION_GAIN = 0.9;
const VALUE_GAMMA_GAIN = 0.35;

/** Packed `0xRRGGBB` → HSV with `h` in `[0, 360)`, `s` and `v` in `[0, 1]`. */
function rgbToHsv(rgb: number): readonly [number, number, number] {
  const r = ((rgb >> 16) & 0xff) / 0xff;
  const g = ((rgb >> 8) & 0xff) / 0xff;
  const b = (rgb & 0xff) / 0xff;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return [h, s, max];
}

/** HSV (`h` in `[0, 360)`, `s` and `v` in `[0, 1]`) → packed `0xRRGGBB`. */
function hsvToRgb(h: number, s: number, v: number): number {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const channel = (value: number): number => Math.round((value + m) * 0xff);
  return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}

/**
 * A player colour pushed toward a bolder version of itself for colour-vision-deficient players: hue
 * stays, saturation and value rise with `strength`. The minimum returns `rgb` byte for byte. A project
 * choice, not original behavior; the curve follows other games' team-colour intensity settings.
 */
export function enhancePlayerColor(rgb: number, strength: number): number {
  const clamped = Math.min(TEAM_COLOR_STRENGTH_MAX, Math.max(TEAM_COLOR_STRENGTH_MIN, Math.round(strength)));
  const fraction = (clamped - TEAM_COLOR_STRENGTH_MIN) / (TEAM_COLOR_STRENGTH_MAX - TEAM_COLOR_STRENGTH_MIN);
  if (fraction <= 0) return rgb;
  const [h, s, v] = rgbToHsv(rgb);
  const boostedS = Math.min(1, s * (1 + SATURATION_GAIN * fraction));
  const liftedV = Math.min(1, v ** (1 / (1 + VALUE_GAMMA_GAIN * fraction)));
  return hsvToRgb(h, boostedS, liftedV);
}
