import type { WorldSnapshot } from '@vinland/sim';
import { Container, Graphics } from 'pixi.js';
import { type ElevationField, terrainLiftAt } from '../../data/elevation.js';
import { ONE, TILE_HALF_H, TILE_HALF_W, tileToScreen } from '../../data/iso.js';
import type { EntityBounds } from '../sprite-pool/index.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The SELECTION layer — a feet-anchored ring under each currently-selected entity, drawn in WORLD
 * space (a child of the camera's `worldLayer`, BELOW the sprite layer) so a ring pans/zooms with the
 * unit and reads as a marker on the ground. Selection is a CLIENT-side view concern, not sim state
 * (the app owns the selected-id set); this layer just projects those ids to rings, exactly as the
 * sprite pool projects the snapshot to bobs — a pure consumer of the frozen snapshot + camera.
 *
 * RETAINED, like the sprite pool: a ring's ellipse geometry is built ONCE per entity and only its
 * container position is moved each frame — steady-state work is a handful of transform writes, no
 * geometry churn (the old immediate-mode rebuild-every-frame cost measurable frame time + input lag). A
 * ring pool keyed by entity id (ids are monotonic, a stable key); a deselected/departed id's ring is
 * destroyed. The per-frame snapshot scan is gated on a non-empty selection.
 *
 * A ring is sized to its target: a SETTLER gets a small feet ellipse; a BUILDING gets a ground ellipse
 * sized to its ACTUAL sprite footprint (the pool's per-entity {@link EntityBounds}, passed in) so a big
 * headquarters gets a big marker and a small hut a small one — a fixed size can't fit both. The ring sits
 * BELOW the sprites, so a unit in front occludes it; a building's ring is wide enough that its front arc
 * still reads clearly under the house.
 */

/** Settler feet ring half-extents (px) — a small ground ellipse under a settler's ~40px-wide body
 *  (deliberately much smaller than the 68×76 cell diamond, which would swallow the sprite). */
const SETTLER_RING = { rx: 20, ry: 11 };
/** Fallback building ring when the sprite's real bounds aren't known yet (no sheet / just appeared). */
const BUILDING_RING = { rx: 54, ry: 30 };
/** Floor on a building ring's half-width, so even a small building reads as a building-sized marker. */
const MIN_BUILDING_RX = 28;
/** Ground-ellipse squash: a ground circle spans a cell width (2·halfW) E–W but only a row step
 *  (halfH) N–S under the staggered raster, so a flat footprint ellipse squashes by their ratio.
 *  Read per call (not a module const) so the `?pitch=`/`?pitchy=` live overrides — applied after
 *  module init — reach the rings too. */
function isoRatio(): number {
  return TILE_HALF_H / (2 * TILE_HALF_W);
}
/** The selection ring colour (a bright green, the RTS "this is yours and selected" cue) + line weight. */
const RING_COLOR = 0x66ff66;
const RING_WIDTH = 2;
/** The work-FLAG highlight colour (a bright amber) — the flag of a currently-selected gatherer, distinct
 *  from the green unit-selection ring, drawn a touch heavier so it reads under the flag's own sprite. */
const FLAG_RING_COLOR = 0xffc020;
const FLAG_RING_WIDTH = 3;

const NO_IDS: ReadonlySet<number> = new Set();

/** One ring's resolved geometry: half-extents + a horizontal centre offset (a sprite not centred on feet). */
interface RingSpec {
  readonly rx: number;
  readonly ry: number;
  readonly cx: number;
}

/** The frame's projection inputs shared by both ring pools — grouped so the twin `reconcile` calls don't
 *  thread the same four positional args (the snapshot + the pool's drawn-anchor / bounds / elevation seams). */
interface SelectionFrame {
  readonly snapshot: WorldSnapshot;
  readonly boundsOf: ((ref: number) => EntityBounds | undefined) | undefined;
  readonly elevation: ElevationField | undefined;
  readonly anchorOf: ((ref: number) => { x: number; y: number } | undefined) | undefined;
}

export class SelectionLayer {
  readonly container = new Container();
  /** One persistent ring Graphics per SELECTED entity id (green); geometry drawn once, repositioned after. */
  private readonly rings = new Map<number, Graphics>();
  /** One persistent ring per selected gatherer's FLAG entity id (amber) — the same pooling, a second cue. */
  private readonly flagRings = new Map<number, Graphics>();
  /** Reused per-frame scratch of ids drawn this frame (one per pool; avoids a per-frame allocation). */
  private readonly drawn = new Set<number>();
  private readonly drawnFlags = new Set<number>();

  /**
   * Reconcile both marker pools from the frozen snapshot's positions: a green ring under every `selected`
   * entity, and an amber ring under every `flagged` id (the work flags of the selected gatherers). Each
   * pool get-or-creates a ring per id (sized from {@link EntityBounds} via `boundsOf` for buildings) and
   * moves it to the entity's feet, then retires rings for ids no longer present. An emptied set retires its
   * pool and does no scan.
   */
  draw(
    snapshot: WorldSnapshot,
    selected: ReadonlySet<number>,
    boundsOf?: (ref: number) => EntityBounds | undefined,
    elevation?: ElevationField,
    anchorOf?: (ref: number) => { x: number; y: number } | undefined,
    flagged: ReadonlySet<number> = NO_IDS,
  ): void {
    const frame: SelectionFrame = { snapshot, boundsOf, elevation, anchorOf };
    this.reconcile(this.rings, this.drawn, selected, RING_COLOR, RING_WIDTH, frame);
    this.reconcile(this.flagRings, this.drawnFlags, flagged, FLAG_RING_COLOR, FLAG_RING_WIDTH, frame);
  }

  /** Reconcile ONE ring pool to `ids` in `color`: place/move a ring under each present entity, retire the rest. */
  private reconcile(
    pool: Map<number, Graphics>,
    drawn: Set<number>,
    ids: ReadonlySet<number>,
    color: number,
    width: number,
    frame: SelectionFrame,
  ): void {
    drawn.clear();
    if (ids.size > 0) {
      for (const ent of frame.snapshot.entities) {
        if (!ids.has(ent.id)) continue;
        const pos = ent.components.Position as { x: number; y: number } | undefined;
        if (pos === undefined) continue;
        // The pool's DRAWN anchor (inter-tick lerped AND terrain-lifted) when the entity was drawn this
        // frame, so the ring glides with the interpolated bob and rides the hill under it. When it wasn't
        // drawn (culled off-screen), fall back to the raw snapshot projection plus the same lift.
        let s = frame.anchorOf?.(ent.id);
        if (s === undefined) {
          const tileX = pos.x / ONE;
          const tileY = pos.y / ONE;
          const p = tileToScreen(tileX, tileY);
          const lift = terrainLiftAt(frame.elevation, tileX, tileY);
          s = { x: p.x, y: p.y - lift };
        }
        let ring = pool.get(ent.id);
        if (ring === undefined) {
          // Kind + size are fixed while present, so the ring geometry is authored once here.
          const isBuilding = ent.components.Building !== undefined;
          ring = makeRing(
            ringSpec(isBuilding, isBuilding ? frame.boundsOf?.(ent.id) : undefined, s.x),
            color,
            width,
          );
          this.container.addChild(ring);
          pool.set(ent.id, ring);
        }
        ring.position.set(s.x, s.y);
        drawn.add(ent.id);
      }
    }
    // Retire rings not drawn this frame (deselected, or the entity died / left the snapshot).
    retireUndrawn(pool, drawn, (ring) => ring.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.rings.clear();
    this.flagRings.clear();
  }
}

/**
 * The ring geometry for a target: a settler's small fixed feet ellipse, or a building's ground ellipse
 * sized to its actual sprite footprint (`bounds`) — half its sprite width, floored so a small building
 * still reads, squashed to the iso ground ratio, and offset when the sprite isn't centred on the feet.
 * Falls back to a fixed building ellipse when the real bounds aren't available yet.
 */
function ringSpec(isBuilding: boolean, bounds: EntityBounds | undefined, feetX: number): RingSpec {
  if (!isBuilding) return { rx: SETTLER_RING.rx, ry: SETTLER_RING.ry, cx: 0 };
  if (bounds !== undefined) {
    const rx = Math.max(MIN_BUILDING_RX, (bounds.maxX - bounds.minX) / 2);
    return { rx, ry: rx * isoRatio(), cx: (bounds.minX + bounds.maxX) / 2 - feetX };
  }
  return { rx: BUILDING_RING.rx, ry: BUILDING_RING.ry, cx: 0 };
}

/** A single marker ring in `color`, its ellipse geometry authored once at the (feet-relative) centre `spec.cx`. */
function makeRing(spec: RingSpec, color: number, width: number): Graphics {
  const g = new Graphics();
  g.ellipse(spec.cx, 0, spec.rx, spec.ry).fill({ color, alpha: 0.12 }).stroke({ width, color, alpha: 0.9 });
  return g;
}
