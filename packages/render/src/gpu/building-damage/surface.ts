import { clamp01 } from '../../data/math.js';

/** Artistic damage ladder, deliberately independent of the simulation's repair and combat rules. */
export function damageStage(hp: number): number {
  if (!Number.isFinite(hp)) return 0;
  return hp >= 0.9 ? 0 : hp >= 0.72 ? 1 : hp >= 0.52 ? 2 : hp >= 0.32 ? 3 : hp >= 0.14 ? 4 : 5;
}

export function noise(seed: number, salt: number): number {
  let n = Math.imul(seed ^ Math.imul(salt, 374761393), 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export interface Fracture {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly roof: boolean;
  readonly timber: boolean;
  readonly colour: readonly [number, number, number];
  readonly seed: number;
}

/** Alpha, local colour and the roof silhouette guide the scars; colour is only a material approximation.
 * No building ids or replacement artwork are involved. Interior breaches remain dark cavities, not
 * transparent windows through an entire house. Only bites at the roof silhouette remove coverage. */
export function analyseSurface(rgba: Uint8ClampedArray, w: number, h: number, seed: number): Fracture[] {
  const fractures: Fracture[] = [];
  const solid = (x: number, y: number) => (rgba[(y * w + x) * 4 + 3] ?? 0) >= 200;
  // Thin ornaments, cranes and flagpoles above the roof cannot host a fire. Find the first substantial
  // cross-section, then require a solid neighbourhood around each interior wound.
  let roofTop = 0;
  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = 0; x < w; x++) if (solid(x, y)) count++;
    if (count >= Math.max(10, w * 0.24)) {
      roofTop = y;
      break;
    }
  }
  for (let i = 0; i < 6; i++) {
    const roof = i < 4;
    const band = (i * 3 + Math.floor(noise(seed, 71) * 5)) % 5;
    const targetX = Math.round(w * (0.15 + (band + noise(seed, i + 1) * 0.6) * 0.14));
    let chosen: { x: number; y: number; score: number } | undefined;
    for (let x = Math.max(2, targetX - 9); x <= Math.min(w - 3, targetX + 9); x++) {
      let top = roofTop;
      while (top < h && !solid(x, top)) top++;
      if (top >= h * 0.72) continue;
      const targetY = roof
        ? top + h * (i === 2 ? 0.035 : 0.12 + noise(seed, 20 + i) * 0.12)
        : h * (0.62 + 0.12 * noise(seed, 20 + i));
      for (let y = Math.max(top + 2, Math.round(targetY) - 8); y < Math.min(h - 3, targetY + 8); y++) {
        if (!solid(x, y) || !solid(x - 3, y) || !solid(x + 3, y) || !solid(x, y + 3)) continue;
        if (i !== 2 && (!solid(x - 3, y - 3) || !solid(x + 3, y - 3))) continue;
        const score = Math.abs(x - targetX) + Math.abs(y - targetY) * 0.8;
        if (chosen === undefined || score < chosen.score) chosen = { x, y, score };
      }
    }
    if (chosen === undefined) continue;
    const { x, y } = chosen;
    const at = (y * w + x) * 4;
    const r = rgba[at] ?? 0;
    const g = rgba[at + 1] ?? 0;
    const b = rgba[at + 2] ?? 0;
    fractures.push({
      x,
      y,
      roof,
      radius: Math.max(5, Math.min(22, Math.min(w, h) * (0.072 + noise(seed, 60 + i) * 0.04))),
      timber: roof || (r > b * 1.2 && g > b * 1.08),
      colour: [r, g, b],
      seed: seed + i * 197,
    });
  }
  return fractures;
}

/** Rebuilt from the pristine pixels at every rung: repair cannot leave cumulative soot or holes. */
export function scarSurface(
  original: Uint8ClampedArray,
  w: number,
  h: number,
  fractures: readonly Fracture[],
  stage: number,
): Uint8ClampedArray {
  const out = original.slice();
  if (stage <= 0) return out;
  for (let i = 0; i < fractures.length; i++) {
    const f = fractures[i];
    if (f === undefined) continue;
    const strength = clamp01((stage - i * 0.48) / 4.5);
    if (strength <= 0) continue;
    const radius = f.radius * (0.3 + strength * 1.15);
    const rx = radius;
    const ry = radius * (f.roof ? 0.62 : 0.88);
    for (let y = Math.max(0, Math.floor(f.y - ry * 1.7)); y < Math.min(h, f.y + ry * 1.7); y++) {
      for (let x = Math.max(0, Math.floor(f.x - rx * 1.7)); x < Math.min(w, f.x + rx * 1.7); x++) {
        const at = (y * w + x) * 4;
        if ((original[at + 3] ?? 0) < 128) continue;
        const dx = (x - f.x) / rx;
        const dy = (y - f.y) / ry;
        const angle = Math.atan2(dy, dx);
        const edge = 1 + 0.16 * Math.sin(angle * 5 + f.seed) + 0.1 * Math.sin(angle * 11 + f.seed * 0.7);
        const grit = noise(f.seed, Math.floor(x / 2) + Math.floor(y / 2) * w);
        const d = Math.hypot(dx, dy) / edge + (grit - 0.5) * 0.13;
        if (d > 1.5) continue;
        const char = clamp01((stage - 2) / 3) * clamp01((1.5 - d) * 0.75);
        for (let c = 0; c < 3; c++) out[at + c] = (out[at + c] ?? 0) * (1 - char * 0.65);
        if (d > 1 || stage === 1) continue;
        // Jagged, light-catching broken edges retain the surrounding material's palette.
        if (d > 0.79) {
          const light = dy > 0 ? 1.14 : 0.48;
          for (let c = 0; c < 3; c++) out[at + c] = (original[at + c] ?? 0) * light;
          continue;
        }
        const beam =
          f.timber &&
          (Math.abs(x - f.x - (y - f.y) * 0.42) < 1.3 ||
            Math.abs(y - f.y + (x - f.x) * 0.28 - ry * 0.24) < 1.1);
        if (beam) {
          const grain = 0.45 + grit * 0.2;
          out[at] = 66 + f.colour[0] * grain * 0.35;
          out[at + 1] = 45 + f.colour[1] * grain * 0.28;
          out[at + 2] = 25 + f.colour[2] * grain * 0.2;
        } else {
          out[at] = 23 + grit * 15;
          out[at + 1] = 20 + grit * 12;
          out[at + 2] = 17 + grit * 9;
          // Roof-edge gaps open to the sky; deep holes keep the back wall in darkness.
          if (f.roof && stage >= 3) {
            let top = y;
            while (top > 0 && y - top < ry && (original[((top - 1) * w + x) * 4 + 3] ?? 0) >= 128) top--;
            if (y - top < ry * 0.6) out[at + 3] = 0;
          }
        }
      }
    }
    crack(out, original, w, h, f, radius, strength);
  }
  return out;
}

function crack(
  out: Uint8ClampedArray,
  original: Uint8ClampedArray,
  w: number,
  h: number,
  f: Fracture,
  radius: number,
  strength: number,
): void {
  for (let branch = 0; branch < 3; branch++) {
    const angle = noise(f.seed, branch + 81) * Math.PI * 2;
    const length = radius * (1.3 + strength * 0.8);
    for (let step = 0; step < length; step += 0.6) {
      const bend = Math.sin(step * 0.6 + branch) * (f.timber ? 0.6 : 1.5);
      const x = Math.round(f.x + Math.cos(angle) * step + bend);
      const y = Math.round(f.y + Math.sin(angle) * step * (f.roof ? 0.65 : 1));
      if (x < 1 || x >= w - 1 || y < 1 || y >= h - 1) continue;
      const at = (y * w + x) * 4;
      if ((original[at + 3] ?? 0) < 200) continue;
      for (let c = 0; c < 3; c++) out[at + c] = (original[at + c] ?? 0) * 0.35;
    }
  }
}
