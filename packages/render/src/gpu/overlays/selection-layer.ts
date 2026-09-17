import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import { classify, readPosition } from '../../data/scene/snapshot-readers/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { DrawnGeometry, EntityBounds } from '../sprite-pool/index.js';
import { feetAnchor } from './entity-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The selection layer - a feet-anchored ring under each selected entity, drawn in world space below the
 * sprite layer so it reads as a marker on the ground. Selection is a client-side view concern, not sim
 * state: the app owns the selected-id set and this layer only projects it, resolving each id through
 * `entityById` so cost follows the selection rather than the map.
 */

/** Settler feet ring half-extents (px) - fitted to the ~40 px body, not the 68×76 cell diamond, which
 *  would swallow the sprite. */
const SETTLER_RING = { rx: 20, ry: 11 };
/** Fallback building ring when the sprite's real bounds aren't known yet (no sheet / just appeared). */
const BUILDING_RING = { rx: 54, ry: 30 };
/** Floor on a building ring's half-width, so even a small building reads as a building-sized marker. */
const MIN_BUILDING_RX = 28;
/** Ground-ellipse squash: a ground circle spans a cell width (2·halfW) E–W but only a row step
 *  (halfH) N–S under the staggered raster, so a flat footprint ellipse squashes by their ratio. */
const ISO_RATIO = TILE_HALF_H / (2 * TILE_HALF_W);
/** The selection ring: bright green, plus its line weight. */
const RING_COLOR = 0x66ff66;
const RING_WIDTH = 2;
/** The work-flag highlight: amber, distinct from the green selection ring, drawn heavier so it reads
 *  under the flag's own sprite. */
const FLAG_RING_COLOR = 0xffc020;
const FLAG_RING_WIDTH = 3;
/** The work-area circle: the flag's amber, thinner and barely filled, since it spans a whole harvest
 *  radius rather than one sprite. */
const AREA_RING_WIDTH = 2;
const AREA_RING_FILL_ALPHA = 0.05;
/** World px one half-cell node spans east-west, the unit a work radius is carried in. */
const NODE_WIDTH_PX = TILE_HALF_W;

const NO_IDS: ReadonlySet<number> = new Set();
const NO_AREAS: readonly WorkAreaRing[] = [];

/** One work-area circle: the flag entity it centres on and its radius in half-cell nodes. */
export interface WorkAreaRing {
  readonly entity: number;
  readonly radiusNodes: number;
}

/** One ring's half-extents and centre offset in feet-local world pixels. */
interface RingSpec {
  readonly rx: number;
  readonly ry: number;
  readonly cx: number;
  readonly cy: number;
}

export interface SelectionFrame {
  readonly snapshot: WorldSnapshot;
  /** Authored ground markers and drawn bounds, anchored with the displayed sprites. */
  readonly drawn?: DrawnGeometry;
  /** The terrain height field - lifts a ring onto sloped ground. Absent → no lift (flat). */
  readonly elevation?: ElevationField;
}

export class SelectionLayer {
  readonly container = new Container();
  /** One persistent ring per selected entity id (green). */
  private readonly rings = new Map<number, Graphics>();
  /** One persistent ring per selected gatherer's flag entity id (amber). */
  private readonly flagRings = new Map<number, Graphics>();
  /** One persistent work-area circle per shown flag entity id, keyed with the radius it was authored at
   *  so a re-sized area redraws rather than keeping a stale circle. */
  private readonly areaRings = new Map<number, { g: Graphics; radiusNodes: number }>();
  private readonly seenAreas = new Set<number>();
  /** Reused per-frame scratch of ids drawn this frame (one per pool; avoids a per-frame allocation). */
  private readonly seen = new Set<number>();
  private readonly seenFlags = new Set<number>();
  private readonly specs = new WeakMap<Graphics, RingSpec>();

  /** Reconcile the three pools: a green ring under every `selected` entity, an amber one under every
   *  `flagged` id (the work flags of the selected gatherers), and a work-area circle per `workAreas`
   *  entry. */
  draw(
    frame: SelectionFrame,
    selected: ReadonlySet<number>,
    flagged: ReadonlySet<number> = NO_IDS,
    workAreas: readonly WorkAreaRing[] = NO_AREAS,
  ): void {
    this.reconcile(this.rings, this.seen, selected, RING_COLOR, RING_WIDTH, frame);
    this.reconcile(this.flagRings, this.seenFlags, flagged, FLAG_RING_COLOR, FLAG_RING_WIDTH, frame);
    this.reconcileAreas(workAreas, frame);
  }

  /** Reconcile the work-area circles: one flat ground ellipse per shown area, retiring the rest. */
  private reconcileAreas(areas: readonly WorkAreaRing[], frame: SelectionFrame): void {
    this.seenAreas.clear();
    for (const area of areas) {
      const ent = entityById(frame.snapshot, area.entity);
      if (ent === undefined) continue;
      const pos = readPosition(ent.components);
      if (pos === null) continue;
      const s = feetAnchor(frame.drawn, area.entity, pos, frame.elevation);
      let held = this.areaRings.get(area.entity);
      if (held === undefined || held.radiusNodes !== area.radiusNodes) {
        held?.g.destroy();
        const rx = area.radiusNodes * NODE_WIDTH_PX;
        const g = new Graphics();
        g.ellipse(0, 0, rx, rx * ISO_RATIO)
          .fill({ color: FLAG_RING_COLOR, alpha: AREA_RING_FILL_ALPHA })
          .stroke({ width: AREA_RING_WIDTH, color: FLAG_RING_COLOR, alpha: 0.7 });
        this.container.addChild(g);
        held = { g, radiusNodes: area.radiusNodes };
        this.areaRings.set(area.entity, held);
      }
      held.g.position.set(s.x, s.y);
      this.seenAreas.add(area.entity);
    }
    retireUndrawn(this.areaRings, this.seenAreas, (held) => held.g.destroy());
  }

  /** Reconcile one ring pool to `ids` in `color`: place/move a ring under each present entity, retire the rest. */
  private reconcile(
    pool: Map<number, Graphics>,
    seen: Set<number>,
    ids: ReadonlySet<number>,
    color: number,
    width: number,
    frame: SelectionFrame,
  ): void {
    seen.clear();
    for (const id of ids) {
      const ent = entityById(frame.snapshot, id);
      if (ent === undefined) continue;
      const pos = readPosition(ent.components);
      if (pos === null) continue;
      const s = feetAnchor(frame.drawn, id, pos, frame.elevation);
      const kind = classify(ent.components);
      // A building's and a vehicle's ring fits the drawn sprite; a settler's is the fixed feet ellipse.
      const fitsSprite = kind === 'building' || kind === 'vehicle';
      const spec =
        (fitsSprite ? frame.drawn?.selectionOf?.(id) : undefined) ??
        ringSpec(fitsSprite, fitsSprite ? frame.drawn?.boundsOf(id) : undefined, s.x);
      let ring = pool.get(id);
      if (ring === undefined) {
        ring = new Graphics();
        this.container.addChild(ring);
        pool.set(id, ring);
      }
      const previous = this.specs.get(ring);
      if (
        previous === undefined ||
        previous.cx !== spec.cx ||
        previous.cy !== spec.cy ||
        previous.rx !== spec.rx ||
        previous.ry !== spec.ry
      ) {
        ring
          .clear()
          .ellipse(spec.cx, spec.cy, spec.rx, spec.ry)
          .fill({ color, alpha: 0.12 })
          .stroke({ width, color, alpha: 0.9 });
        this.specs.set(ring, { ...spec });
      }
      ring.position.set(s.x, s.y);
      seen.add(id);
    }
    // Retire rings not drawn this frame (deselected, or the entity died / left the snapshot).
    retireUndrawn(pool, seen, (ring) => ring.destroy());
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.rings.clear();
    this.flagRings.clear();
    this.areaRings.clear();
  }
}

/** The ring geometry for a target: a settler's fixed feet ellipse, or a building's or vehicle's ellipse
 *  fitted to its sprite footprint and offset when the sprite isn't centred on the feet. */
function ringSpec(fitsSprite: boolean, bounds: EntityBounds | undefined, feetX: number): RingSpec {
  if (!fitsSprite) return { rx: SETTLER_RING.rx, ry: SETTLER_RING.ry, cx: 0, cy: 0 };
  if (bounds !== undefined) {
    const rx = Math.max(MIN_BUILDING_RX, (bounds.maxX - bounds.minX) / 2);
    return { rx, ry: rx * ISO_RATIO, cx: (bounds.minX + bounds.maxX) / 2 - feetX, cy: 0 };
  }
  return { rx: BUILDING_RING.rx, ry: BUILDING_RING.ry, cx: 0, cy: 0 };
}
