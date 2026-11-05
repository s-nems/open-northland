import {
  readStoredSettings,
  TEAM_COLOR_STRENGTH_MAX,
  TEAM_COLOR_STRENGTH_MIN,
} from '../view/settings/store.js';

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
 * Push a player colour toward a bolder version of itself for colour-vision-deficient players, after
 * Vera PR #3453 and StarCraft II's Team Colour Intensity. Saturation scales by `1 + 0.90 × fraction`
 * and value lifts along the gamma `v^(1 / (1 + 0.35 × fraction))`; hue is never touched, so a red team
 * stays red. `strength` is the 1–10 team-colour-strength setting; `1` returns `rgb` unchanged, byte
 * for byte. The boost is always applied from the retail colour, so the result depends only on
 * `strength` and never accumulates across changes (10 → 3 → 10 yields the same bytes as 10 directly).
 */
export function enhancePlayerColor(rgb: number, strength: number): number {
  const clamped = Math.min(
    TEAM_COLOR_STRENGTH_MAX,
    Math.max(TEAM_COLOR_STRENGTH_MIN, Math.round(strength)),
  );
  const fraction = (clamped - TEAM_COLOR_STRENGTH_MIN) / (TEAM_COLOR_STRENGTH_MAX - TEAM_COLOR_STRENGTH_MIN);
  if (fraction <= 0) return rgb;
  const [h, s, v] = rgbToHsv(rgb);
  const boostedS = Math.min(1, s * (1 + 0.9 * fraction));
  const liftedV = Math.min(1, v ** (1 / (1 + 0.35 * fraction)));
  return hsvToRgb(h, boostedS, liftedV);
}

/** The live team-colour-strength setting (1–10); `1` means the retail palette. */
export function currentTeamColorStrength(): number {
  return readStoredSettings().teamColorStrength;
}
