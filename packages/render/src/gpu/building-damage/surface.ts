import { clamp01 } from '../../data/math.js';

const HEALTH_ANCHORS = [1, 0.9, 0.75, 0.6, 0.45, 0.3, 0.2] as const;

/** Continuous artistic damage, independent of repair and combat rules. */
export function damageLevel(hp: number): number {
  if (!Number.isFinite(hp) || hp >= 1) return 0;
  for (let i = 1; i < HEALTH_ANCHORS.length; i++) {
    const upper = HEALTH_ANCHORS[i - 1] ?? 1;
    const lower = HEALTH_ANCHORS[i] ?? 0;
    if (hp >= lower) return i - 1 + (upper - hp) / (upper - lower);
  }
  return 6;
}

export function noise(seed: number, salt: number): number {
  let n = Math.imul(seed ^ Math.imul(salt, 374761393), 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

interface Beam {
  readonly x: number;
  readonly y: number;
  readonly cos: number;
  readonly sin: number;
  readonly length: number;
  readonly width: number;
  readonly breakStage: number;
  readonly gap: number;
  readonly seed: number;
}

export interface Fracture {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly roof: boolean;
  readonly timber: boolean;
  readonly open: boolean;
  readonly onset: number;
  readonly aspect: number;
  readonly angle: number;
  readonly contour: readonly number[];
  readonly beams: readonly Beam[];
  readonly colour: readonly [number, number, number];
  readonly seed: number;
}

/** Seeded rejection sampling follows solid material, with separate roof, wall and silhouette losses.
 * Alpha and colour are material approximations; they cannot identify the architecture of every sprite. */
export function analyseSurface(rgba: Uint8ClampedArray, w: number, h: number, seed: number): Fracture[] {
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && (rgba[(y * w + x) * 4 + 3] ?? 0) >= 200;
  let roofTop = 0;
  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = 0; x < w; x++) if (solid(x, y)) count++;
    if (count >= Math.max(10, w * 0.24)) {
      roofTop = y;
      break;
    }
  }
  const fractures: Fracture[] = [];
  const roofCount = 4 + Math.floor(noise(seed, 17) * 3);
  const count = roofCount + 3 + Math.floor(noise(seed, 18) * 3);
  for (let i = 0; i < count; i++) {
    const roof = i < roofCount;
    const open = i === roofCount - 1 || i === count - 1;
    const radius = Math.max(5, Math.min(40, Math.min(w, h) * (0.065 + noise(seed, 600 + i) * 0.085)));
    let chosen: { x: number; y: number; score: number } | undefined;
    for (let attempt = 0; attempt < 48; attempt++) {
      const salt = i * 151 + attempt * 3;
      let x = Math.round(w * (0.1 + noise(seed, salt + 1000) * 0.8));
      let top = roofTop;
      while (top < h && !solid(x, top)) top++;
      if (top > roofTop + (h - roofTop) * 0.53) continue;
      let y = Math.round(
        roof
          ? top + (h - roofTop) * (open ? 0.025 : 0.05 + noise(seed, salt + 1001) * 0.23)
          : roofTop + (h - roofTop) * (0.48 + noise(seed, salt + 1001) * 0.37),
      );
      if (open && !roof) {
        const left = noise(seed, salt + 1002) < 0.5;
        x = left ? 0 : w - 1;
        while (x >= 0 && x < w && !solid(x, y)) x += left ? 1 : -1;
        x += left ? 4 : -4;
      }
      y = Math.min(h - 4, y);
      if (!solid(x, y) || !solid(x - 2, y) || !solid(x + 2, y) || !solid(x, y + 2)) continue;
      if (!open && (!solid(x - 3, y - 3) || !solid(x + 3, y - 3))) continue;
      let separation = 3;
      for (const previous of fractures) {
        separation = Math.min(
          separation,
          Math.hypot(x - previous.x, y - previous.y) / (radius + previous.radius),
        );
      }
      const score = separation + noise(seed, salt + 1002) * 0.25;
      if (chosen === undefined || score > chosen.score) chosen = { x, y, score };
    }
    if (chosen === undefined || chosen.score < 0.45) continue;
    const { x, y } = chosen;
    const at = (y * w + x) * 4;
    const r = rgba[at] ?? 0,
      g = rgba[at + 1] ?? 0,
      b = rgba[at + 2] ?? 0;
    const woundSeed = Math.floor(noise(seed, 2000 + i) * 0x7fffffff);
    const timber = roof || (r > b * 1.2 && g > b * 1.08);
    const angle = (noise(woundSeed, 1) - 0.5) * Math.PI;
    const beams: Beam[] = [];
    const beamCount = timber ? 1 + Math.floor(noise(woundSeed, 2) * 4) : 0;
    // Fixed source-pixel members are progressively uncovered, rather than stretching with the hole.
    for (let j = 0; j < beamCount; j++) {
      const crossMember = j === 3;
      const beamAngle = angle + (crossMember ? 1.35 : 0) + (noise(woundSeed, 30 + j) - 0.5) * 0.28;
      beams.push({
        x: (noise(woundSeed, 10 + j) - 0.5) * radius * 1.5,
        y: (noise(woundSeed, 20 + j) - 0.5) * radius,
        cos: Math.cos(beamAngle),
        sin: Math.sin(beamAngle),
        length: radius * (2.3 + noise(woundSeed, 40 + j) * 1.4),
        width: 1.2 + noise(woundSeed, 50 + j) * Math.min(3.2, radius * 0.13),
        breakStage: 4 + Math.floor(noise(woundSeed, 60 + j) * 4),
        gap: 0.15 + noise(woundSeed, 70 + j) * 0.38,
        seed: woundSeed + j * 83,
      });
    }
    fractures.push({
      x,
      y,
      roof,
      timber,
      open,
      radius,
      angle,
      onset: i < 3 ? noise(woundSeed, 3) * 0.35 : open ? 2.7 : 0.4 + noise(woundSeed, 3) * 2.4,
      aspect: roof ? 0.35 + noise(woundSeed, 4) * 0.5 : 0.55 + noise(woundSeed, 4) * 0.85,
      contour: Array.from({ length: 12 }, (_, j) => 0.63 + noise(woundSeed, 100 + j) * 0.65),
      beams,
      colour: [r, g, b],
      seed: woundSeed,
    });
  }
  return fractures;
}

/** Blend neighbouring wound states from pristine pixels, including silhouettes in premultiplied alpha.
 * A growing breach reveals its construction backing gradually instead of replacing a wall in one step. */
export function scarSurface(
  original: Uint8ClampedArray,
  w: number,
  h: number,
  fractures: readonly Fracture[],
  level: number,
  backing?: Uint8ClampedArray,
): Uint8ClampedArray {
  const clamped = Number.isFinite(level) ? Math.max(0, Math.min(6, level)) : 0;
  const lower = Math.floor(clamped);
  const blend = clamped - lower;
  const out = scarStage(original, w, h, fractures, lower, backing);
  if (blend === 0) return out;
  const next = scarStage(original, w, h, fractures, lower + 1, backing);
  return blendSurfaces(out, next, blend);
}

/** Inputs may be retained endpoints; blending never writes into either one. */
export function blendSurfaces(
  lower: Uint8ClampedArray,
  next: Uint8ClampedArray,
  blend: number,
): Uint8ClampedArray {
  const out = lower.slice();
  for (let at = 0; at < out.length; at += 4) {
    const a = (out[at + 3] ?? 0) * (1 - blend);
    const b = (next[at + 3] ?? 0) * blend;
    const alpha = a + b;
    if (alpha > 0) {
      for (let c = 0; c < 3; c++) out[at + c] = ((out[at + c] ?? 0) * a + (next[at + c] ?? 0) * b) / alpha;
    }
    out[at + 3] = alpha;
  }
  return out;
}

function scarStage(
  original: Uint8ClampedArray,
  w: number,
  h: number,
  fractures: readonly Fracture[],
  stage: number,
  backing?: Uint8ClampedArray,
): Uint8ClampedArray {
  const out = original.slice();
  if (stage <= 0) return out;
  for (const f of fractures) {
    const strength = clamp01((stage - f.onset) / (6 - f.onset));
    if (strength <= 0) continue;
    const radius =
      f.radius * (0.25 + strength * 1.15 + Math.max(0, stage - 4) * 0.3 + (stage === 1 ? 0.1 : 0));
    const rx = radius,
      ry = radius * f.aspect;
    const cos = Math.cos(f.angle),
      sin = Math.sin(f.angle);
    const extent = Math.max(rx, ry) * 1.65;
    // Beyond this radius even the largest contour lobe and minimum grit are outside the soot edge.
    const outside = (Math.max(...f.contour) * 1.55) ** 2;
    for (let y = Math.max(0, Math.floor(f.y - extent)); y < Math.min(h, f.y + extent); y++) {
      for (let x = Math.max(0, Math.floor(f.x - extent)); x < Math.min(w, f.x + extent); x++) {
        const at = (y * w + x) * 4;
        if ((original[at + 3] ?? 0) < 128 || out[at + 3] === 0) continue;
        const px = x - f.x,
          py = y - f.y;
        const dx = (px * cos + py * sin) / rx;
        const dy = (-px * sin + py * cos) / ry;
        if (dx * dx + dy * dy > outside) continue;
        const a = ((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * f.contour.length;
        const edgeA = f.contour[Math.floor(a) % f.contour.length] ?? 1;
        const edgeB = f.contour[(Math.floor(a) + 1) % f.contour.length] ?? 1;
        const edge = edgeA + (edgeB - edgeA) * (a % 1);
        const grit = noise(f.seed, Math.floor(x / 2) + Math.floor(y / 2) * w);
        const d = Math.hypot(dx, dy) / edge + (grit - 0.5) * 0.1;
        if (d > 1.5) continue;
        const soot = clamp01((stage - 2) / 4) * clamp01((1.5 - d) * 0.85);
        for (let c = 0; c < 3; c++) out[at + c] = (out[at + c] ?? 0) * (1 - soot * 0.68);
        if (d > 1) continue;
        if (stage === 1) {
          // Fresh chips expose lighter edges and a rough substrate before cavities or soot appear.
          const lip = d > 0.72 && py > 0;
          for (let c = 0; c < 3; c++) {
            const substrate = f.timber ? (c === 0 ? 137 : c === 1 ? 102 : 63) : 125;
            out[at + c] = lip
              ? (original[at + c] ?? 0) * 1.15 + 16
              : (original[at + c] ?? 0) * 0.24 + substrate * (0.65 + grit * 0.18);
          }
          continue;
        }
        if (d > 0.83) {
          // Irregular broken material has a shaded thickness and a thin sunlit lower lip.
          const light = py > 0 ? (d > 0.94 ? 1.12 : 0.7) : 0.38;
          for (let c = 0; c < 3; c++) out[at + c] = (original[at + c] ?? 0) * light;
          continue;
        }
        const hasBacking = (backing?.[at + 3] ?? 0) >= 128;
        const beam = hasBacking ? null : timberPixel(f, px, py, stage, grit);
        if (hasBacking) {
          const shade = stage >= 5 ? 0.65 : 0.78;
          for (let c = 0; c < 3; c++) out[at + c] = (backing?.[at + c] ?? 0) * shade;
        } else if (beam !== null) {
          const ash = stage >= 5 ? 0.7 : 0.88;
          out[at] = (88 + f.colour[0] * 0.22) * beam * ash;
          out[at + 1] = (65 + f.colour[1] * 0.18) * beam * ash;
          out[at + 2] = (42 + f.colour[2] * 0.16) * beam * ash;
        } else if (f.open && f.roof && stage >= 5 && d < 0.45 && py < 0) {
          out[at + 3] = 0;
        } else {
          // Dim source variation suggests depth behind the broken face instead of a flat black stamp.
          out[at] = 16 + (original[at] ?? 0) * 0.09 + grit * 10;
          out[at + 1] = 14 + (original[at + 1] ?? 0) * 0.08 + grit * 8;
          out[at + 2] = 12 + (original[at + 2] ?? 0) * 0.07 + grit * 6;
        }
      }
    }
    crack(out, original, w, h, f, radius, strength);
  }
  return out;
}

/** Bevelled timber with longitudinal grain, a dark side face and uneven splintered ends. */
function timberPixel(f: Fracture, x: number, y: number, stage: number, grit: number): number | null {
  for (const beam of f.beams) {
    const { cos, sin } = beam;
    const along = ((x - beam.x) * cos + (y - beam.y) * sin) / beam.length + 0.5;
    const across = -(x - beam.x) * sin + (y - beam.y) * cos;
    const half = beam.width * (0.55 - along * 0.13);
    if (Math.abs(across) > half || along < 0 || along > 1) continue;
    const fibre = Math.sin(across * 5 + beam.seed) * 0.035 + grit * 0.035;
    const broken = stage >= beam.breakStage;
    const breakAt = 0.3 + noise(beam.seed, 501) * 0.4;
    const end = breakAt + fibre;
    const restart = breakAt + beam.gap + fibre * 0.7;
    if (broken && along > end && along < restart) continue;
    if (broken && (Math.abs(along - end) < 0.04 || Math.abs(along - restart) < 0.035)) return 1.5;
    if (across > half * 0.25) return 0.42;
    const grain = Math.sin(across * 7 + Math.sin(along * 16 + beam.seed) * 0.5);
    return (across < -half * 0.55 ? 1.3 : 0.87) + grain * 0.1 + grit * 0.1;
  }
  return null;
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
  const branches = 1 + Math.floor(noise(f.seed, 80) * 4);
  for (let branch = 0; branch < branches; branch++) {
    const angle = f.timber
      ? f.angle + (noise(f.seed, branch + 81) - 0.5) * 0.5
      : noise(f.seed, branch + 81) * Math.PI * 2;
    const length = radius * (1.1 + strength * 0.9);
    for (let step = 0; step < length; step += 0.6) {
      const bend = Math.sin(step * 0.6 + branch) * (f.timber ? 0.45 : 1.5);
      const x = Math.round(f.x + Math.cos(angle) * step + bend);
      const y = Math.round(f.y + Math.sin(angle) * step);
      if (x < 1 || x >= w - 1 || y < 1 || y >= h - 1) continue;
      const at = (y * w + x) * 4;
      if ((original[at + 3] ?? 0) < 200 || out[at + 3] === 0) continue;
      for (let c = 0; c < 3; c++) out[at + c] = (out[at + c] ?? 0) * 0.45;
    }
  }
}
