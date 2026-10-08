import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import { classify, readPosition } from '../../data/scene/snapshot-readers/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import { DEFAULT_SELECTION_STYLE, type SelectionStyle } from '../selection-style.js';
import type { DrawnGeometry, EntityBounds } from '../sprite-pool/index.js';
import { feetAnchor } from './entity-anchor.js';
import { mintRangeRing, RANGE_RING_KINDS, type RangeRing, type RangeRingKind } from './range-ring.js';
import { retireUndrawn } from './retained-pool.js';
import { drawUnitSelectionRing } from './unit-selection-ring.js';

/**
 * The selection layer - a feet-anchored ring under each selected entity, drawn in world space below the
 * sprite layer so it reads as a marker on the ground. Selection is a client-side view concern, not sim
 * state: the app owns the selected-id set and this layer only projects it, resolving each id through
 * `entityById` so cost follows the selection rather than the map.
 */

/** Settler feet ring half-extents (px) - fitted to the ~40 px body, not the 68×76 cell diamond, which
 *  would swallow the sprite. */
const SETTLER_RING = { rx: 20, ry: 11 };
/** Artistic choice: a tighter, unfilled marker for mobile units. */
const UNIT_RING = { rx: 16, ry: 7 };
/** Fallback building ring when the sprite's real bounds aren't known yet (no sheet / just appeared). */
const BUILDING_RING = { rx: 54, ry: 30 };
/** Floor on a building ring's half-width, so even a small building reads as a building-sized marker. */
const MIN_BUILDING_RX = 28;
/** Ground-ellipse squash: a ground circle spans a cell width (2·halfW) E–W but only a row step
 *  (halfH) N–S under the staggered raster, so a flat footprint ellipse squashes by their ratio. */
const ISO_RATIO = TILE_HALF_H / (2 * TILE_HALF_W);
/** Neutral selection colour for unowned objects and the white-ring option. */
const RING_COLOR = 0xf2e8c9;

const NO_IDS: ReadonlySet<number> = new Set();
const NO_RANGES: readonly RangeRing[] = [];

/** One ring's half-extents and centre offset in feet-local world pixels. */
interface RingSpec {
  readonly rx: number;
  readonly ry: number;
  readonly cx: number;
  readonly cy: number;
}

export interface SelectionFrame {
  readonly snapshot: WorldSnapshot;
  /** Logical screen pixels per world pixel; absent means the unscaled test/shot view. */
  readonly zoom?: number;
  readonly selectionStyle?: SelectionStyle | undefined;
  /** Authored ground markers and drawn bounds, anchored with the displayed sprites. */
  readonly drawn?: DrawnGeometry;
  /** The terrain height field - lifts a ring onto sloped ground. Absent → no lift (flat). */
  readonly elevation?: ElevationField;
}

export class SelectionLayer {
  readonly container = new Container();
  /** One persistent ring per selected entity id. */
  private readonly rings = new Map<number, Graphics>();
  private readonly focusRings = new Map<number, Graphics>();
  private readonly seenFocus = new Set<number>();
  /** Per kind, one persistent range circle per centre entity id, kept with the radius it was authored at
   *  so a re-sized range redraws rather than keeping a stale circle. */
  private readonly rangeRings: Readonly<
    Record<RangeRingKind, Map<number, { g: Graphics; radiusNodes: number }>>
  > = {
    work: new Map(),
    defence: new Map(),
  };
  private readonly seenRanges: Readonly<Record<RangeRingKind, Set<number>>> = {
    work: new Set(),
    defence: new Set(),
  };
  /** Reused per-frame scratch of ids drawn this frame (one per pool; avoids a per-frame allocation). */
  private readonly seen = new Set<number>();
  private readonly specs = new WeakMap<
    Graphics,
    RingSpec & { zoom: number; weight: number; color: number }
  >();

  /** Reconcile selected entities, work flags, range circles and the member indicated by the group HUD. */
  draw(
    frame: SelectionFrame,
    selected: ReadonlySet<number>,
    flagged: ReadonlySet<number> = NO_IDS,
    ranges: readonly RangeRing[] = NO_RANGES,
    focused: ReadonlySet<number> = NO_IDS,
  ): void {
    const style = frame.selectionStyle ?? DEFAULT_SELECTION_STYLE;
    const spriteEffect = style === 'outline' || style === 'pulse';
    this.reconcile(this.rings, this.seen, spriteEffect ? NO_IDS : selected, frame, 'selection', flagged);
    this.reconcileRanges(ranges, frame);
    this.reconcile(this.focusRings, this.seenFocus, focused, frame, 'focus');
  }

  /** Reconcile the range circles: one flat ground ellipse per shown range, retiring the rest. */
  private reconcileRanges(ranges: readonly RangeRing[], frame: SelectionFrame): void {
    this.seenRanges.work.clear();
    this.seenRanges.defence.clear();
    for (const range of ranges) {
      const ent = entityById(frame.snapshot, range.entity);
      if (ent === undefined) continue;
      const pos = readPosition(ent.components);
      if (pos === null) continue;
      const s = feetAnchor(frame.drawn, range.entity, pos, frame.elevation);
      const pool = this.rangeRings[range.kind];
      let held = pool.get(range.entity);
      if (held === undefined || held.radiusNodes !== range.radiusNodes) {
        held?.g.destroy();
        const g = mintRangeRing(range.radiusNodes, range.kind);
        this.container.addChild(g);
        held = { g, radiusNodes: range.radiusNodes };
        pool.set(range.entity, held);
      }
      held.g.position.set(s.x, s.y);
      this.seenRanges[range.kind].add(range.entity);
    }
    for (const kind of RANGE_RING_KINDS) {
      retireUndrawn(this.rangeRings[kind], this.seenRanges[kind], (held) => held.g.destroy());
    }
  }

  /** Reconcile one ring pool to `ids`: place/move a ring under each present entity, retire the rest. */
  private reconcile(
    pool: Map<number, Graphics>,
    seen: Set<number>,
    ids: ReadonlySet<number>,
    frame: SelectionFrame,
    unitStyle: 'selection' | 'focus',
    excluded: ReadonlySet<number> = NO_IDS,
  ): void {
    seen.clear();
    for (const id of ids) {
      if (excluded.has(id)) continue;
      const ent = entityById(frame.snapshot, id);
      if (ent === undefined) continue;
      const pos = readPosition(ent.components);
      if (pos === null) continue;
      const s = feetAnchor(frame.drawn, id, pos, frame.elevation);
      const kind = classify(ent.components);
      const green = (frame.selectionStyle ?? DEFAULT_SELECTION_STYLE) === 'ring-green';
      const weight = green ? 1.3 : 1;
      const ringColor = green ? 0x66ff66 : RING_COLOR;
      const mobile = kind === 'settler';
      const zoom = frame.zoom ?? 1;
      // A building's and a vehicle's ring fits the drawn sprite; a settler's is the fixed feet ellipse.
      const fitsSprite = kind === 'building' || kind === 'vehicle';
      const spec =
        (fitsSprite ? frame.drawn?.selectionOf?.(id) : undefined) ??
        ringSpec(fitsSprite, fitsSprite ? frame.drawn?.boundsOf(id) : undefined, s.x, mobile);
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
        previous.ry !== spec.ry ||
        previous.zoom !== zoom ||
        previous.weight !== weight ||
        previous.color !== ringColor
      ) {
        ring.clear();
        drawUnitSelectionRing(ring, spec, zoom, unitStyle === 'focus', ringColor, weight);
        this.specs.set(ring, { ...spec, zoom, weight, color: ringColor });
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
    this.focusRings.clear();
    for (const kind of RANGE_RING_KINDS) this.rangeRings[kind].clear();
  }
}

/** The ring geometry for a target: a settler's fixed feet ellipse, or a building's or vehicle's ellipse
 *  fitted to its sprite footprint and offset when the sprite isn't centred on the feet. */
function ringSpec(
  fitsSprite: boolean,
  bounds: EntityBounds | undefined,
  feetX: number,
  mobile: boolean,
): RingSpec {
  if (!fitsSprite) return { ...(mobile ? UNIT_RING : SETTLER_RING), cx: 0, cy: 0 };
  if (bounds !== undefined) {
    const rx = Math.max(MIN_BUILDING_RX, (bounds.maxX - bounds.minX) / 2);
    return { rx, ry: rx * ISO_RATIO, cx: (bounds.minX + bounds.maxX) / 2 - feetX, cy: 0 };
  }
  return { rx: BUILDING_RING.rx, ry: BUILDING_RING.ry, cx: 0, cy: 0 };
}
