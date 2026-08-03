import type { World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { withinNodeRadius } from '../../../nav/node-circle.js';
import type { SystemContext } from '../../context.js';
import { interactionNode, routeRegions } from '../../footprint/index.js';
import { signpostNetwork, signpostProbe } from '../../signposts/index.js';
import { seatBaseOf } from '../base.js';
import { anchorNodeOf, firstRingNode, ownedBuildings } from '../shared.js';

/**
 * The signpost lattice the scout tiles the settlement with (user plan): one post beside the
 * seat's base, six around it at near-minimal spacing, and outer lattice spots only once owned
 * buildings stand near them, so the covered field grows with the settlement.
 */

/** Distance between neighbouring lattice targets, in nodes on the world metric - "almost as close as
 *  posts may stand" (user rule): above the 18-node placement block (SIGNPOST_SPACING_RADIUS_NODES) and
 *  below the 24-node nav range (SIGNPOST_NAV_RADIUS_NODES), so neighbouring posts clear each other's
 *  spacing yet always chain into one network. */
export const SIGNPOST_LATTICE_SPACING_NODES = 22;

/** How far a post may stand from its lattice target and still satisfy it - also the legal-spot search
 *  reach, so an erected post always satisfies the target it was placed for. Under half the spacing,
 *  so one post can never satisfy two neighbouring targets. */
export const SIGNPOST_TARGET_TOLERANCE_NODES = 8;

// Hex-lattice basis in node offsets: axial (q, r) ↦ (22q + 11r, 34r). The node lattice is anisotropic
// (34 px E/W, 19 px N/S - `nav/node-circle.ts`), so the r step's world-metric height 22·√3/2 ≈ 19.05
// spans 19.05·34/19 ≈ 34 rows; every neighbour pair then sits ~22 world units apart. Integer
// literals, precomputed - the sim allows no trig.
const LATTICE_Q_DX = SIGNPOST_LATTICE_SPACING_NODES;
const LATTICE_R_DX = SIGNPOST_LATTICE_SPACING_NODES / 2;
const LATTICE_R_DY = 34;

/** Axial hex coordinate (q, r) → node offset from the lattice centre. */
export function signpostLatticeOffset(q: number, r: number): { dx: number; dy: number } {
  return { dx: LATTICE_Q_DX * q + LATTICE_R_DX * r, dy: LATTICE_R_DY * r };
}

/** The innermost hex ring - the centre post plus this ring are always wanted (the user's "one beside
 *  the base, then six around it"); outer rings need a building nearby. */
const BASE_RING = 1;

/** The centre post aims one cell WEST of the base's door rather than at its anchor, which sits inside
 *  the blocked body and lets the legal-spot search settle on the doorway itself. One cell is two
 *  nodes on the half-cell lattice (`nav/halfcell.ts`). */
const CENTRE_DOOR_CLEARANCE_NODES = 2;

/** Every ring-k target is at least k·19 world units from the centre (the mid-edge minimum
 *  k·22·√3/2 ≈ k·19.05, floored) - the divisor bounding how many rings a settlement extent needs. */
const RING_MIN_STEP_NODES = 19;

/** Hard ring budget per decision (~217 targets scanned at worst). A settlement past it is the
 *  expansion module's concern, not lattice growth around the seat's base. */
const MAX_LATTICE_RING = 8;

/** The axial walk tracing hex ring k counter-clockwise from its east corner (k, 0). */
const RING_WALK: readonly { q: number; r: number }[] = [
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
];

/** The axial coordinates of hex ring `k` in deterministic walk order (6k points; the centre for k=0). */
function latticeRing(k: number): { q: number; r: number }[] {
  if (k === 0) return [{ q: 0, r: 0 }];
  const out: { q: number; r: number }[] = [];
  let q = k;
  let r = 0;
  for (const d of RING_WALK) {
    for (let s = 0; s < k; s++) {
      out.push({ q, r });
      q += d.q;
      r += d.r;
    }
  }
  return out;
}

/** The outermost ring worth scanning for this settlement: node Manhattan distance over-bounds the
 *  world-metric distance (a row is under one x-unit), so every target a building can want lies within. */
function latticeRingBound(anchor: HalfCellNode, buildings: readonly HalfCellNode[]): number {
  let extent = 0;
  for (const b of buildings) {
    const d = Math.abs(b.hx - anchor.hx) + Math.abs(b.hy - anchor.hy);
    if (d > extent) extent = d;
  }
  const rings = Math.ceil((extent + SIGNPOST_LATTICE_SPACING_NODES) / RING_MIN_STEP_NODES);
  return Math.min(MAX_LATTICE_RING, Math.max(BASE_RING, rings));
}

/**
 * The next erectable lattice target for the seat: the first spot (rings inside-out, walk order) that
 * is wanted (ring ≤ {@link BASE_RING}, or an owned building within one lattice spacing), has no own
 * post within the tolerance, AND a legal node to erect on. Null when the wanted lattice stands
 * complete or every remaining target is unbuildable (off-map, water, blocked).
 */
export function nextSignpostTarget(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null;
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return null;
  const anchor = anchorNodeOf(world, base);
  if (anchor === null) return null;
  const door = interactionNode(world, ctx, base);
  const posts = signpostNetwork(world).get(player) ?? [];
  // Any construction state: coverage should arrive with a site, not after it finishes.
  const buildings: HalfCellNode[] = [];
  for (const e of ownedBuildings(world, player)) {
    const node = anchorNodeOf(world, e);
    if (node !== null) buildings.push(node);
  }
  let probe: ReturnType<typeof signpostProbe> | null = null;
  // The sealed-pocket veto (routeRegions): without it a provably sealed spot wins the search and the
  // module re-aims at it every decision. Judged from the base's door; the scout's own cell is unknowable
  // in a per-seat pick (named approximation). A pocketed reference would invert the veto (every open
  // spot reads unroutable), so the pick fails open to the unvetoed search instead.
  let veto: ReturnType<typeof routeRegions> | null = null;
  const refNode =
    door !== null ? terrain.nodeAtClamped(door.x, door.y) : terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const maxRing = latticeRingBound(anchor, buildings);
  for (let ring = 0; ring <= maxRing; ring++) {
    for (const { q, r } of latticeRing(ring)) {
      const offset = signpostLatticeOffset(q, r);
      // Ring 0 rides the door, not the anchor, so the centre post ends up beside the entrance.
      const centre =
        ring === 0 && door !== null ? { hx: door.x - CENTRE_DOOR_CLEARANCE_NODES, hy: door.y } : anchor;
      const tx = centre.hx + offset.dx;
      const ty = centre.hy + offset.dy;
      const wanted =
        ring <= BASE_RING ||
        buildings.some((b) => withinNodeRadius(b.hx, b.hy, tx, ty, SIGNPOST_LATTICE_SPACING_NODES));
      if (!wanted) continue;
      const satisfied = posts.some((s) =>
        withinNodeRadius(s.hx, s.hy, tx, ty, SIGNPOST_TARGET_TOLERANCE_NODES),
      );
      if (satisfied) continue;
      if (probe === null) {
        probe = signpostProbe(world, ctx.content, terrain, player);
        const regions = routeRegions(world, ctx, terrain);
        veto = regions.pocketed(refNode) ? null : regions;
      }
      const p = probe;
      const v = veto;
      // Never the doorway itself: a post there stands where the base's settlers enter and leave. The
      // region veto probes last, so a spot the cheap gates reject never costs a pocket flood.
      const spot = firstRingNode(
        tx,
        ty,
        SIGNPOST_TARGET_TOLERANCE_NODES,
        (x, y) =>
          p.canPlace(x, y) &&
          !(door !== null && x === door.x && y === door.y) &&
          (v === null || !v.unroutable(refNode, terrain.nodeAt(x, y))),
      );
      if (spot !== null) return spot;
    }
  }
  return null;
}
