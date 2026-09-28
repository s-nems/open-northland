import { hash2, noise1 } from './noise.js';

/**
 * Where a building's walls meet the ground, read from its art alone. An invented enhancement, not the
 * original's: the original stands its buildings on the painted foundation the art carries.
 */

const RGBA = 4;
const ALPHA = 3;
/** Alpha from which a pixel counts as part of the building rather than its soft edge. */
const OPAQUE_ALPHA = 128;
/** {@link FootAnalysis.above} on a pixel whose opaque run reaches no ground contact. */
export const NO_CONTACT = Number.POSITIVE_INFINITY;

/** Clear pixels a contact needs under it: the ground shows below the wall there. */
const CONTACT_CLEAR_BELOW_PX = 3;
/** Opaque pixels a contact needs over it, so a thin fringe or a post tip is not a wall foot. */
const CONTACT_WALL_PX = 6;
/** How far neighbouring contacts may step up or down per column and still form one ground line. */
const GROUND_LINE_STEP_PX = 2;
/** Narrower lines are a slanted side edge's staircase, not ground. */
const GROUND_LINE_MIN_SPAN_PX = 6;
/** A line held up at both ends by posts this tall is a lintel or an eave, not ground. */
const LINTEL_POST_PX = 8;
/** Columns past a line's end searched for the post holding it up. */
const SUPPORT_SEARCH_PX = 2;

/** How steeply the silhouette may rise from a lower foot nearby before its lowest pixel is an eave tip
 *  over the ground rather than a foot, in px per px across. */
const EAVE_CONE_SLOPE = 2.5;
/** px an eave tip may sit above that cone and still count as a foot. */
const ZONE_CONE_TOLERANCE_PX = 2;
/** The ground zone runs at least a lattice diamond deep: the ground rises half a px per px across. */
const ZONE_DIAMOND_SLOPE = 0.5;
/** px the ground zone grows by on every side. */
const ZONE_MARGIN_PX = 8;

/** px the foot sinks into the ground at its deepest. */
const SINK_PX = 4.5;
/** The share of {@link SINK_PX} the shallowest stretch keeps, so no stretch floats. */
const SINK_FLOOR_SHARE = 0.35;
/** Wavelength of the sink's slow swell along the foot, in px. */
const SINK_SWELL_PX = 9;
/** Per-column jitter of the cut, as a share of {@link SINK_PX}, so the buried edge reads as uneven soil. */
const SINK_JITTER_SHARE = 0.4;
const SINK_SWELL_SEED = 11;
const SINK_JITTER_SEED = 5;

/** The analysis every bake of one frame shares, in the frame's own pixel space. */
export interface FootAnalysis {
  readonly width: number;
  readonly height: number;
  /** Alpha after the foot sinks into the ground. */
  readonly alpha: Uint8ClampedArray;
  /** Per pixel: px above the ground contact at the foot of its opaque run, or {@link NO_CONTACT}. */
  readonly above: Float32Array;
  /** 1 on a pixel where the sunk wall meets the ground. */
  readonly contact: Uint8Array;
  /** Per column: the lowest contact row, or -1. */
  readonly footRow: Int32Array;
  /** Per column: how lit the wall just above the foot is against the frame's best-lit face, 0..1. */
  readonly wallLight: Float32Array;
}

/**
 * Find the ground contacts of a `width`×`height` frame at `(offsetX, offsetY)` in straight-alpha RGBA
 * `pixels` `stride` wide, and sink its foot along them; null when the art stands on no ground line, which
 * draws it as it is.
 */
export function analyseFoot(
  pixels: Uint8ClampedArray,
  stride: number,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): FootAnalysis | null {
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      alpha[y * width + x] = pixels[((y + offsetY) * stride + x + offsetX) * RGBA + ALPHA] ?? 0;
    }
  }
  const zone = groundZone(alpha, width, height);
  const firstContact = contactsOf(alpha, zone, width, height);
  if (!firstContact.includes(1)) return null;
  sinkFoot(alpha, heightsAbove(alpha, firstContact, width, height), width, height);
  const contact = contactsOf(alpha, zone, width, height);
  if (!contact.includes(1)) return null;
  const footRow = new Int32Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = height - 1; y >= 0; y--) {
      if (contact[y * width + x] === 1) {
        footRow[x] = y;
        break;
      }
    }
  }
  const above = heightsAbove(alpha, contact, width, height);
  const wallLight = wallLightOf(pixels, stride, offsetX, offsetY, above, width, height);
  return { width, height, alpha, above, contact, footRow, wallLight };
}

/** The band of wall, in px above its contact, whose brightness says how lit that face is: over the
 *  tallest snow drift, under the eaves of a low wall. */
const WALL_LIGHT_FROM_PX = 4;
const WALL_LIGHT_TO_PX = 16;
/** Columns each way a face's brightness is averaged over, so window frames and beams do not flicker it. */
const WALL_LIGHT_SMOOTH_PX = 4;
/** The share of the frame's foot columns lit no better than its best-lit face, whose brightness is 1. */
const WALL_LIGHT_REFERENCE_SHARE = 0.85;
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

/**
 * Per column, the wall's brightness just above its foot relative to the frame's best-lit face, so what
 * lies at a dark side wall's foot darkens with it. Approximation: the wall's own brightness stands in
 * for the light on that face, so dark timber reads as a little shade too.
 */
function wallLightOf(
  pixels: Uint8ClampedArray,
  stride: number,
  offsetX: number,
  offsetY: number,
  above: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const luma = new Float32Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
      const h = above[y * width + x] ?? NO_CONTACT;
      if (h < WALL_LIGHT_FROM_PX || h > WALL_LIGHT_TO_PX) continue;
      const p = ((y + offsetY) * stride + x + offsetX) * RGBA;
      sum += (pixels[p] ?? 0) * LUMA_R + (pixels[p + 1] ?? 0) * LUMA_G + (pixels[p + 2] ?? 0) * LUMA_B;
      count++;
    }
    if (count > 0) luma[x] = sum / count;
  }
  const smooth = new Float32Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    let count = 0;
    for (let k = -WALL_LIGHT_SMOOTH_PX; k <= WALL_LIGHT_SMOOTH_PX; k++) {
      const v = luma[x + k] ?? -1;
      if (v < 0) continue;
      sum += v;
      count++;
    }
    if (count > 0) smooth[x] = sum / count;
  }
  const lit = [...smooth].filter((v) => v >= 0).sort((a, b) => a - b);
  const reference = lit[Math.min(lit.length - 1, Math.floor(lit.length * WALL_LIGHT_REFERENCE_SHARE))] ?? 0;
  const light = new Float32Array(width).fill(1);
  if (reference <= 0) return light;
  for (let x = 0; x < width; x++) {
    const v = smooth[x] ?? -1;
    if (v >= 0) light[x] = Math.min(1, v / reference);
  }
  return light;
}

/** Cut the foot off along a noisy line {@link SINK_PX} deep over every contact, in place. */
function sinkFoot(alpha: Uint8ClampedArray, above: Float32Array, width: number, height: number): void {
  for (let x = 0; x < width; x++) {
    const swell = SINK_FLOOR_SHARE + (1 - SINK_FLOOR_SHARE) * noise1(x / SINK_SWELL_PX, SINK_SWELL_SEED);
    const cut = SINK_PX * (swell + SINK_JITTER_SHARE * (hash2(x, SINK_JITTER_SEED) - 0.5));
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      const h = above[i] ?? NO_CONTACT;
      if (h === NO_CONTACT) continue;
      // Half a px of coverage either side of the cut antialiases it.
      const keep = Math.max(0, Math.min(1, h - cut + 0.5));
      alpha[i] = (alpha[i] ?? 0) * keep;
    }
  }
}

/**
 * The ground a building's art stands on. The silhouette's lowest pixel per column is a wall foot unless a
 * lower foot nearby rises to it more steeply than {@link EAVE_CONE_SLOPE} allows. The feet span the
 * ground's side corners; the zone runs from their line back to the parallelogram those corners and the
 * lowest foot make, never shallower than a lattice diamond, grown by {@link ZONE_MARGIN_PX}.
 */
function groundZone(alpha: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const low = new Float32Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = height - 1; y >= 0; y--) {
      if ((alpha[y * width + x] ?? 0) >= OPAQUE_ALPHA) {
        low[x] = y;
        break;
      }
    }
  }
  const reach = coneEnvelope(low, EAVE_CONE_SLOPE);
  const feet = new Float32Array(width).fill(-1);
  let left = -1;
  let right = -1;
  let frontY = -1;
  let frontXSum = 0;
  let frontCount = 0;
  for (let x = 0; x < width; x++) {
    const y = low[x] ?? -1;
    if (y < 0 || y < (reach[x] ?? 0) - ZONE_CONE_TOLERANCE_PX) continue;
    feet[x] = y;
    if (left < 0) left = x;
    right = x;
    if (y > frontY) {
      frontY = y;
      frontXSum = x;
      frontCount = 1;
    } else if (y === frontY) {
      frontXSum += x;
      frontCount++;
    }
  }
  if (right < 0) return mask;
  const front = coneEnvelope(feet, EAVE_CONE_SLOPE);
  const frontX = frontXSum / frontCount;
  const leftY = low[left] ?? frontY;
  const rightY = low[right] ?? frontY;
  const backX = left + right - frontX;
  const backY = leftY + rightY - frontY;
  for (let x = Math.max(0, left - ZONE_MARGIN_PX); x <= Math.min(width - 1, right + ZONE_MARGIN_PX); x++) {
    const frontRow = front[x] ?? frontY;
    const side =
      x <= backX
        ? leftY + ((backY - leftY) * (x - left)) / Math.max(1, backX - left)
        : backY + ((rightY - backY) * (x - backX)) / Math.max(1, right - backX);
    const diamond = frontRow - ZONE_DIAMOND_SLOPE * 2 * Math.max(0, Math.min(x - left, right - x));
    const back = Math.min(side, diamond);
    for (let y = 0; y < height; y++) {
      if (y <= frontRow + ZONE_MARGIN_PX && y >= back - ZONE_MARGIN_PX) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Per column, the lowest row any column's value reaches when it rises `slope` px per px across. */
function coneEnvelope(low: Float32Array, slope: number): Float32Array {
  const out = new Float32Array(low.length).fill(-1);
  let run = -1;
  for (let x = 0; x < low.length; x++) {
    run = Math.max(run - slope, low[x] ?? -1);
    out[x] = run;
  }
  run = -1;
  for (let x = low.length - 1; x >= 0; x--) {
    run = Math.max(run - slope, low[x] ?? -1);
    out[x] = Math.max(out[x] ?? -1, run);
  }
  return out;
}

function contactsOf(alpha: Uint8ClampedArray, zone: Uint8Array, width: number, height: number): Uint8Array {
  const contact = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      if ((alpha[i] ?? 0) < OPAQUE_ALPHA || zone[i] === 0) continue;
      let clear = true;
      for (let k = 1; k <= CONTACT_CLEAR_BELOW_PX && y + k < height; k++) {
        if ((alpha[(y + k) * width + x] ?? 0) >= OPAQUE_ALPHA) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      let wall = 0;
      while (wall < CONTACT_WALL_PX && wall <= y && (alpha[(y - wall) * width + x] ?? 0) >= OPAQUE_ALPHA)
        wall++;
      if (wall >= CONTACT_WALL_PX) contact[i] = 1;
    }
  }
  return keepGroundLines(contact, alpha, width, height);
}

/**
 * Keep contacts that chain into a line no steeper than the ground runs across the screen and at least
 * {@link GROUND_LINE_MIN_SPAN_PX} wide, and that no pair of posts holds up like a lintel.
 */
function keepGroundLines(
  contact: Uint8Array,
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const parent = new Int32Array(width * height).fill(-1);
  const find = (i: number): number => {
    let root = i;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    let at = i;
    while (at !== root) {
      const next = parent[at] ?? root;
      parent[at] = root;
      at = next;
    }
    return root;
  };
  for (let i = 0; i < contact.length; i++) if (contact[i] === 1) parent[i] = i;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x + 1 < width; x++) {
      const i = y * width + x;
      if (contact[i] !== 1) continue;
      for (let dy = -GROUND_LINE_STEP_PX; dy <= GROUND_LINE_STEP_PX; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const j = ny * width + x + 1;
        if (contact[j] !== 1) continue;
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  // Each line's end columns, and the lowest contact row in each.
  const minX = new Map<number, number>();
  const maxX = new Map<number, number>();
  for (let i = 0; i < contact.length; i++) {
    if (contact[i] !== 1) continue;
    const root = find(i);
    const x = i % width;
    minX.set(root, Math.min(minX.get(root) ?? x, x));
    maxX.set(root, Math.max(maxX.get(root) ?? x, x));
  }
  const leftRow = new Map<number, number>();
  const rightRow = new Map<number, number>();
  for (let i = 0; i < contact.length; i++) {
    if (contact[i] !== 1) continue;
    const root = find(i);
    const x = i % width;
    const y = Math.floor(i / width);
    if (x === minX.get(root)) leftRow.set(root, Math.max(leftRow.get(root) ?? y, y));
    if (x === maxX.get(root)) rightRow.set(root, Math.max(rightRow.get(root) ?? y, y));
  }
  const supported = (x: number, y: number, dir: number): boolean => {
    for (let step = 1; step <= SUPPORT_SEARCH_PX; step++) {
      const sx = x + dir * step;
      if (sx < 0 || sx >= width) return false;
      let run = 0;
      while (
        run < LINTEL_POST_PX &&
        y + 1 + run < height &&
        (alpha[(y + 1 + run) * width + sx] ?? 0) >= OPAQUE_ALPHA
      )
        run++;
      if (run >= LINTEL_POST_PX) return true;
    }
    return false;
  };
  const lintel = new Map<number, boolean>();
  const out = new Uint8Array(contact.length);
  for (let i = 0; i < contact.length; i++) {
    if (contact[i] !== 1) continue;
    const root = find(i);
    const x0 = minX.get(root) ?? 0;
    const x1 = maxX.get(root) ?? 0;
    if (x1 - x0 + 1 < GROUND_LINE_MIN_SPAN_PX) continue;
    let held = lintel.get(root);
    if (held === undefined) {
      held = supported(x0, leftRow.get(root) ?? 0, -1) && supported(x1, rightRow.get(root) ?? 0, 1);
      lintel.set(root, held);
    }
    if (!held) out[i] = 1;
  }
  return out;
}

/** Per pixel, how far up its opaque run it sits from the contact at that run's foot. */
function heightsAbove(
  alpha: Uint8ClampedArray,
  contact: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const above = new Float32Array(width * height).fill(NO_CONTACT);
  for (let x = 0; x < width; x++) {
    let h = NO_CONTACT;
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x;
      if ((alpha[i] ?? 0) < OPAQUE_ALPHA) {
        h = NO_CONTACT;
        continue;
      }
      h = contact[i] === 1 ? 0 : h + 1;
      above[i] = h;
    }
  }
  return above;
}
