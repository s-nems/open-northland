import { Building, FOG_MODE, fogMode, Owner, Position, Settler, Vehicle } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { System } from '../context.js';
import { isFighterJob, SCOUT_JOB } from '../readviews/index.js';
import { HUNTER_JOB } from '../readviews/tribes/index.js';
import { cellOfNode } from './gates.js';
import { FOG_STATE } from './state.js';

/**
 * Ticks between visibility-mask rebuilds. The fog "scan pulse": positions move every tick but the masks refresh
 * on this cadence, so per-tick cost amortizes to (owned entities × vision area) / 5 writes. At 12 ticks/s that
 * is a ~417 ms refresh — imperceptible against fog's soft edges. Our design (the original has no observable fog
 * refresh rate), a deliberate cadence like combat's REPATH_CADENCE.
 */
export const VISION_CADENCE_TICKS = 5;

/**
 * Vision radii in half-cell nodes (the same integer node-distance convention as `DEFAULT_WORK_FLAG_RADIUS` /
 * `SIGHT_RADIUS_NODES`), measured along the E/W world axis (one node = half a column = 34 px of the measured
 * 68×38 pitch); the stamped area is the world-metric ellipse of that radius, so vision reads circular on screen.
 * All approximated (user-tuned): the original carries no readable per-job sight field — the ordering (buildings
 * large, scout largest, soldier large, hunter a bit over civilian, civilian smallest) is the user's spec.
 */
export const BUILDING_VISION_NODES = 20;
export const CIVILIAN_VISION_NODES = 12;
export const HUNTER_VISION_NODES = 14;
export const SOLDIER_VISION_NODES = 16;
export const SCOUT_VISION_NODES = 26;

/**
 * The vision radius (nodes) of a settler of `jobType` — a data-shaped classification over the pinned
 * job-id bands (the defaultStanceForJob style): scouts widest, soldiers/heroes wide, hunters a bit
 * over civilians, every other trade (and a jobless settler/child) the civilian floor.
 */
export function visionRadiusForJob(jobType: number | null): number {
  if (jobType === SCOUT_JOB) return SCOUT_VISION_NODES;
  if (isFighterJob(jobType)) return SOLDIER_VISION_NODES;
  if (jobType === HUNTER_JOB) return HUNTER_VISION_NODES;
  return CIVILIAN_VISION_NODES;
}

/** The world-metric weights of the vision ellipse: one cell column is 68 px wide, one cell row 38 px deep, one
 *  node (the radius unit) 34 px — the measured projection pitch (`nav/metric.ts`, source basis "projection").
 *  Integer, so the ellipse test is exact integer arithmetic. */
const CELL_STEP_PX = 68;
const ROW_STEP_PX = 38;
const NODE_STEP_PX = 34;

/**
 * VisionSystem — rebuild the per-player fog masks on the {@link VISION_CADENCE_TICKS} cadence (and immediately
 * on a mode change, so a `setFogMode` command takes effect the same tick). Runs before the combatSystem in
 * `SYSTEM_ORDER` so combat always gates on this tick's (or at worst a cadence-stale) visibility.
 *
 * A rebuild is two passes over each player's mask:
 *  1. **Downgrade** — RECON drops every VISIBLE byte to EXPLORED (ground nobody watches regresses to
 *     terrain-only); REVEAL skips this (sticky exploration, the original's observed behaviour).
 *  2. **Stamp** — every owned positioned eye (settler by job / building / boat) writes VISIBLE over the
 *     world-metric ellipse of its vision radius. Stamping is idempotent + commutative, so the
 *     `query(Owner, Position)` store order needs no canonical sort.
 *
 * Cost: zero when fog is OFF or no owned entity exists; otherwise O(players · cells) for the downgrade +
 * O(owned · radius²) for the stamps, every {@link VISION_CADENCE_TICKS} ticks.
 */
export const visionSystem: System = (world, ctx) => {
  const fog = ctx.fog;
  if (fog === undefined) return; // mapless sim — no grid to mask
  const mode = fogMode(world);
  if (mode === FOG_MODE.OFF) {
    if (fog.activeMode !== FOG_MODE.OFF) {
      fog.reset(); // fog switched off: drop the masks (exploration restarts if re-enabled)
      fog.activeMode = FOG_MODE.OFF;
      fog.lastRebuildTick = -1;
    }
    return;
  }

  const modeChanged = mode !== fog.activeMode;
  const due = fog.lastRebuildTick === -1 || ctx.tick - fog.lastRebuildTick >= VISION_CADENCE_TICKS;
  if (!modeChanged && !due) return;

  // Downgrade pass (RECON): ground no eye covers falls back to explored-grey. Masks are walked in
  // ascending-player order — byte-for-byte deterministic (and the order hashState mixes them in).
  // Each player's scan covers only its may-hold-VISIBLE box, not the whole map.
  if (mode !== FOG_MODE.REVEAL) {
    for (const player of fog.playersWithMasks()) {
      fog.downgradeVisible(player);
    }
  }

  // Stamp pass: every owned eye writes VISIBLE over its vision ellipse (order-independent writes),
  // and its touched rect feeds the player's may-hold-VISIBLE box for the next downgrade.
  for (const e of world.query(Owner, Position)) {
    const radius = visionRadiusOf(world, e);
    if (radius === null) continue; // an owned entity that is not an eye (a flag, a pile)
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    const { cx, cy } = cellOfNode(n.hx, n.hy);
    const player = world.get(e, Owner).player;
    const rect = stampVision(fog.maskFor(player), fog.cellsWide, fog.cellsHigh, cx, cy, radius);
    if (rect !== null) fog.mergeVisibleBounds(player, rect.minC, rect.maxC, rect.minR, rect.maxR);
  }

  fog.activeMode = mode;
  fog.lastRebuildTick = ctx.tick;
  fog.generation++;
};

/** The vision radius (nodes) of one owned entity, or null when it is not an eye: settlers see by job,
 *  buildings (finished or under construction — a rising site is manned ground) see the building
 *  radius, boat hulls see like a civilian. Owned markers (flags) and piles see nothing. */
function visionRadiusOf(world: World, e: Entity): number | null {
  const settler = world.tryGet(e, Settler);
  if (settler !== undefined) return visionRadiusForJob(settler.jobType);
  if (world.has(e, Building)) return BUILDING_VISION_NODES;
  if (world.has(e, Vehicle)) return CIVILIAN_VISION_NODES;
  return null;
}

/**
 * Write {@link FOG_STATE.VISIBLE} over the world-metric ellipse of `radiusNodes` around cell
 * (cx, cy): a cell (dc, dr) away is inside iff `(68·dc)² + (38·dr)² ≤ (34·R)²` — the measured 68×38
 * projection pitch with the radius in 34 px nodes, so the fog edge reads circular on screen (the
 * per-row stagger's ±half-cell wobble is deliberately ignored — a half-cell fringe on a soft fog edge,
 * named approximation). Exact integer math; clamped to the grid.
 *
 * Returns the clamped cell rect the stamp touched (its ellipse bounding box ∩ grid) so the caller can
 * maintain the per-player may-hold-VISIBLE box, or `null` when the stamp fell fully off-grid.
 */
export function stampVision(
  mask: Uint8Array,
  cellsWide: number,
  cellsHigh: number,
  cx: number,
  cy: number,
  radiusNodes: number,
): { minC: number; maxC: number; minR: number; maxR: number } | null {
  const radiusPx = radiusNodes * NODE_STEP_PX;
  const radiusSq = radiusPx * radiusPx;
  const dcMax = Math.floor(radiusPx / CELL_STEP_PX);
  const drMax = Math.floor(radiusPx / ROW_STEP_PX);
  const rLo = Math.max(0, cy - drMax);
  const rHi = Math.min(cellsHigh - 1, cy + drMax);
  const cLo = Math.max(0, cx - dcMax);
  const cHi = Math.min(cellsWide - 1, cx + dcMax);
  if (rLo > rHi || cLo > cHi) return null;
  for (let r = rLo; r <= rHi; r++) {
    const dyPx = (r - cy) * ROW_STEP_PX;
    const dySq = dyPx * dyPx;
    const base = r * cellsWide;
    for (let c = cLo; c <= cHi; c++) {
      const dxPx = (c - cx) * CELL_STEP_PX;
      if (dxPx * dxPx + dySq <= radiusSq) mask[base + c] = FOG_STATE.VISIBLE;
    }
  }
  return { minC: cLo, maxC: cHi, minR: rLo, maxR: rHi };
}
