import type { WorldSnapshot } from '@vinland/sim';
import { Container, Graphics } from 'pixi.js';
import { ONE, TILE_HALF_H, TILE_HALF_W, tileToScreen } from '../data/iso.js';
import type { EntityBounds } from './sprite-pool.js';

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

/** Settler feet ring half-extents (px) — an iso ellipse a touch smaller than a tile diamond (32×16). */
const SETTLER_RING = { rx: 20, ry: 11 };
/** Fallback building ring when the sprite's real bounds aren't known yet (no sheet / just appeared). */
const BUILDING_RING = { rx: 54, ry: 30 };
/** Floor on a building ring's half-width, so even a small building reads as a building-sized marker. */
const MIN_BUILDING_RX = 28;
/** Ground-ellipse squash: the iso tile's height/width ratio (16/32), so a footprint ellipse lies flat. */
const ISO_RATIO = TILE_HALF_H / TILE_HALF_W;
/** The selection ring colour (a bright green, the RTS "this is yours and selected" cue) + line weight. */
const RING_COLOR = 0x66ff66;
const RING_WIDTH = 2;

/** One ring's resolved geometry: half-extents + a horizontal centre offset (a sprite not centred on feet). */
interface RingSpec {
  readonly rx: number;
  readonly ry: number;
  readonly cx: number;
}

export class SelectionLayer {
  readonly container = new Container();
  /** One persistent ring Graphics per selected entity id; geometry drawn once, only repositioned after. */
  private readonly rings = new Map<number, Graphics>();
  /** Reused per-frame scratch of ids drawn this frame (avoids a per-frame allocation). */
  private readonly drawn = new Set<number>();

  /**
   * Reconcile the rings to `selected` from the frozen snapshot's positions: get-or-create a ring per
   * selected entity (sized from its {@link EntityBounds} via `boundsOf` for buildings) and move it to the
   * entity's feet, then destroy rings for ids no longer selected (or whose entity left the snapshot). An
   * emptied selection retires every ring and returns early — no scan.
   */
  draw(
    snapshot: WorldSnapshot,
    selected: ReadonlySet<number>,
    boundsOf?: (ref: number) => EntityBounds | undefined,
  ): void {
    this.drawn.clear();
    if (selected.size > 0) {
      for (const ent of snapshot.entities) {
        if (!selected.has(ent.id)) continue;
        const pos = ent.components.Position as { x: number; y: number } | undefined;
        if (pos === undefined) continue;
        // Fixed (scaled int) -> float tile -> iso screen anchor (the feet), the same projection the
        // sprite pool uses, so the ring lands exactly under the bob.
        const s = tileToScreen(pos.x / ONE, pos.y / ONE);
        let ring = this.rings.get(ent.id);
        if (ring === undefined) {
          // Kind + size are fixed for the current selection, so the ring geometry is authored once here.
          const isBuilding = ent.components.Building !== undefined;
          ring = makeRing(ringSpec(isBuilding, isBuilding ? boundsOf?.(ent.id) : undefined, s.x));
          this.container.addChild(ring);
          this.rings.set(ent.id, ring);
        }
        ring.position.set(s.x, s.y);
        this.drawn.add(ent.id);
      }
    }
    // Retire rings not drawn this frame (deselected, or the entity died / left the snapshot).
    if (this.rings.size > this.drawn.size) {
      for (const [id, ring] of this.rings) {
        if (this.drawn.has(id)) continue;
        ring.destroy();
        this.rings.delete(id);
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.rings.clear();
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
    return { rx, ry: rx * ISO_RATIO, cx: (bounds.minX + bounds.maxX) / 2 - feetX };
  }
  return { rx: BUILDING_RING.rx, ry: BUILDING_RING.ry, cx: 0 };
}

/** A single selection ring, its ellipse geometry authored once at the (feet-relative) centre `spec.cx`. */
function makeRing(spec: RingSpec): Graphics {
  const g = new Graphics();
  g.ellipse(spec.cx, 0, spec.rx, spec.ry)
    .fill({ color: RING_COLOR, alpha: 0.12 })
    .stroke({ width: RING_WIDTH, color: RING_COLOR, alpha: 0.9 });
  return g;
}
