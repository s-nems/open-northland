import type { DrawItem } from '../../../data/scene/index.js';
import type { SpriteSheet } from '../../textures/sprite-sheet.js';
import { layeredLayerFor } from './layered.js';
import type { LayerBuffer, ResolvedLayer } from './resolved-layer.js';

/** Radians a school's entity id and a fish's index in the school turn the fish along its curves. */
const PHASE_PER_REF = 0.754877666;
const PHASE_PER_FISH = 2.39996323;

/**
 * The sines a fish's offset from its school sums, two across and two along the screen: radians per fish
 * clock unit, the share of the fish's phase, and the reach in world px. Calibrated to the original's
 * 12 Hz world clock: a broad crossing takes tens of seconds, with a smaller ripple layered over it. The
 * curves are our deterministic approximation.
 */
const SWAY_X = { rate: 0.0097, phase: 1, reach: 90 } as const;
const RIPPLE_X = { rate: 0.002, phase: 1.7, reach: 20 } as const;
const SWAY_Y = { rate: 0.004, phase: 1.3, reach: 60 } as const;
const RIPPLE_Y = { rate: 0.019, phase: 0.7, reach: 20 } as const;
const WAVES = [SWAY_X, RIPPLE_X, SWAY_Y, RIPPLE_Y] as const;

/** Fish clock units back a fish's heading looks to tell where it swims. */
const HEADING_LOOKBACK = 0.25;

/** Per wave of {@link WAVES}: the sine and cosine of the school's angle now, then at the lookback. */
const SCHOOL_STRIDE = 4;
const NOW = 0;
const BEFORE = 2;
const school = new Float64Array(WAVES.length * SCHOOL_STRIDE);

/** Per fish index, per wave: the sine and cosine of the fish's own share of the phase, which no clock
 *  moves. Grown to the largest school resolved. */
const FISH_STRIDE = 2 * WAVES.length;
let fishTurns = new Float64Array(0);

function fishTurnsFor(count: number): Float64Array {
  const known = fishTurns.length / FISH_STRIDE;
  if (count <= known) return fishTurns;
  const grown = new Float64Array(count * FISH_STRIDE);
  grown.set(fishTurns);
  for (let fish = known; fish < count; fish++) {
    for (let w = 0; w < WAVES.length; w++) {
      const turn = fish * PHASE_PER_FISH * (WAVES[w]?.phase ?? 0);
      grown[fish * FISH_STRIDE + 2 * w] = Math.sin(turn);
      grown[fish * FISH_STRIDE + 2 * w + 1] = Math.cos(turn);
    }
  }
  fishTurns = grown;
  return grown;
}

/** Fill {@link school} for the school `ref` at fish clock `t`. */
function turnSchool(ref: number, t: number): void {
  for (let w = 0; w < WAVES.length; w++) {
    const wave = WAVES[w];
    if (wave === undefined) continue;
    const phase = ref * PHASE_PER_REF * wave.phase;
    const now = t * wave.rate + phase;
    const before = (t - HEADING_LOOKBACK) * wave.rate + phase;
    school[w * SCHOOL_STRIDE + NOW] = Math.sin(now);
    school[w * SCHOOL_STRIDE + NOW + 1] = Math.cos(now);
    school[w * SCHOOL_STRIDE + BEFORE] = Math.sin(before);
    school[w * SCHOOL_STRIDE + BEFORE + 1] = Math.cos(before);
  }
}

/** `sin(school angle + fish turn)` of wave `w` by the angle sum, `when` being {@link NOW} or
 *  {@link BEFORE}: the trigonometry runs once per school, not per fish. */
function swing(turns: Float64Array, fishAt: number, w: number, when: number): number {
  const s = w * SCHOOL_STRIDE + when;
  const f = fishAt + 2 * w;
  return (school[s] ?? 0) * (turns[f + 1] ?? 0) + (school[s + 1] ?? 0) * (turns[f] ?? 0);
}

/** The layer of each heading the school being resolved has drawn so far; `undefined` is not asked yet. */
const headingLayers: (ResolvedLayer | null | undefined)[] = [];

/**
 * Resolve one layer per fish in the authored stock. In the original the renderer loops over the swarm
 * count, moves each fish independently on sinusoidal paths and selects its directional bob from
 * velocity. The paths here approximate those with our own deterministic curves ({@link WAVES}), keeping
 * presentation motion out of the simulation.
 */
export function pushFishSchool(out: LayerBuffer, sheet: SpriteSheet, item: DrawItem, tick: number): boolean {
  const binding = sheet.bindings.fish;
  if (binding === undefined || binding.bobs.length === 0) return false;
  const count = item.swarmCount ?? 0;
  const turns = fishTurnsFor(count);
  turnSchool(item.ref, tick / Math.max(1, binding.ticksPerFrame));
  const headings = binding.bobs.length;
  for (let heading = 0; heading < headings; heading++) headingLayers[heading] = undefined;
  for (let fish = 0; fish < count; fish++) {
    const at = fish * FISH_STRIDE;
    const x = swing(turns, at, 0, NOW) * SWAY_X.reach + swing(turns, at, 1, NOW) * RIPPLE_X.reach;
    const y = swing(turns, at, 2, NOW) * SWAY_Y.reach + swing(turns, at, 3, NOW) * RIPPLE_Y.reach;
    const beforeX = swing(turns, at, 0, BEFORE) * SWAY_X.reach + swing(turns, at, 1, BEFORE) * RIPPLE_X.reach;
    const beforeY = swing(turns, at, 2, BEFORE) * SWAY_Y.reach + swing(turns, at, 3, BEFORE) * RIPPLE_Y.reach;
    const heading = fishHeadingIndex(x - beforeX, y - beforeY, headings);
    let layer = headingLayers[heading];
    if (layer === undefined) {
      const bob = binding.bobs[heading];
      layer = bob === undefined ? null : layeredLayerFor(sheet, 'fish', { layer: binding.layer, bob });
      headingLayers[heading] = layer;
    }
    if (layer !== null) out.push({ ...layer, dx: x, dy: y, movedFrom: layer });
  }
  return true;
}

/** Map screen velocity to the original fish sheet's clockwise-descending directional order. */
export function fishHeadingIndex(dx: number, dy: number, headingCount: number): number {
  if (headingCount <= 0) return 0;
  const angle = Math.atan2(dy, dx);
  const turn = (((angle / (Math.PI * 2)) % 1) + 1) % 1;
  return Math.floor((1 - turn) * headingCount) % headingCount;
}
