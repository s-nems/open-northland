import {
  type DrawItem,
  type ElevationField,
  type EntityBounds,
  ONE,
  projectTile,
  tileToScreen,
} from '@open-northland/render';
import { entitiesWith, entityById, type WorldSnapshot } from '@open-northland/sim';
import {
  gathererByFlag,
  isPlayerControllable,
  isSettler,
  isWildlife,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
} from '../../game/snapshot.js';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import { containsTargetPoint, isHitTarget, type Pickable } from '../picking.js';
import type { FormationUnit } from './formation.js';

/** What the pickable target sets need from the unit-controls options (a subset threaded through). */
export interface UnitTargetsDeps {
  /** Read the current detached snapshot (memoized while sim state is unchanged). */
  readonly snapshot: () => WorldSnapshot;
  /** Whose units are selectable/orderable; watching the whole map, every owner counts as ours, so
   *  nothing reads as an enemy. */
  readonly viewer: ViewerSeat;
  /** Whether the viewer's seat holds an `enemy` stance toward `owner` - the same directed gate the sim's
   *  attack order obeys, so a click on a non-enemy falls through to a move instead of a dropped order. */
  readonly hostileToward: (owner: number) => boolean;
  /** The frame the player is clicking on. */
  readonly drawnItems: () => readonly DrawItem[];
  /** The exact sprite bounds (world px) of a drawn entity, a statically drawn harvestable included, or
   *  undefined for the kind box. */
  readonly boundsOf: ((ref: number) => EntityBounds | undefined) | undefined;
  /** Terrain lift used to project retained map resources, which do not enter the entity draw list. */
  readonly elevation?: ElevationField | undefined;
  /** Whether a retained resource is live-visible rather than only remembered through fog. */
  readonly resourceVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** Pixel-accurate refinement of {@link boundsOf} for building and resource targets, or undefined to
   *  keep the box. */
  readonly pixelHitOf: ((ref: number, wx: number, wy: number) => boolean | undefined) | undefined;
}

/** World px a road plot's click box reaches past its drawn plot. Tuned by eye. */
const ROAD_PLOT_PICK_MARGIN = 2;

function grownBox(box: EntityBounds, margin: number): EntityBounds {
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
  };
}

/** The drawable kinds a unit-controls click resolves to (a signpost has its own picker). */
export type UnitTargetKind = 'settler' | 'building' | 'palisade' | 'roadsite' | 'vehicle';

/** The pickable target sets the unit controls hit-test a click against, plus the order-issuing set. */
export interface UnitTargets {
  /** Owned, pickable targets of `kind` with their world-px feet anchors; absent, settlers and
   *  buildings. */
  owned(kind?: UnitTargetKind): Pickable[];
  /** Every standing building drawn this frame, whoever owns it: a trader's route may name another
   *  tribe's house. */
  buildings(): Pickable[];
  /** Enemy attack targets - settlers, buildings AND vehicles of a player the human holds an `enemy`
   *  stance toward. A right-click on one issues an `attackUnit` order (the sim accepts a building or
   *  vehicle target). `neutralWalls` adds the unowned palisades, which only an explicit attack pick
   *  strikes: a plain right-click beside one walks there. */
  enemies(opts?: { readonly neutralWalls?: boolean }): Pickable[];
  /** The human's gatherers' drop-off flags, each mapped to its owning gatherer (a flag→unit proxy). */
  flags(): Pickable[];
  /** The human's standing signposts - direct-click targets only (a marquee never grabs a post). */
  signposts(): Pickable[];
  /** The closed chests on screen - the "open chest" click's targets. A chest is nobody's, so every seat
   *  may send a settler to it. */
  chests(): Pickable[];
  /** The loose goods heaps on screen, each with its good - the "put it on" click's targets. A heap is
   *  nobody's either. An empty delivery flag names no good and is not one. */
  goods(): Pickable[];
  /** Visible resource nodes that a selected gatherer may use as its resource-filter target. */
  resources(): Pickable[];
  /**
   * The wild creatures on screen - the "attack animal" order's targets. Claimed livestock carries an
   * owner and is property rather than game, so it stays out, exactly as the sim's ordered-target rule
   * reads it.
   */
  wildlife(): Pickable[];
  /**
   * The owned settlers among `refs` that take the player's orders, in draw order. Bound to the selection
   * rather than the screen, so it survives the camera panning away and reaches a settler standing inside
   * a building.
   */
  ownedSettlersIn(refs: ReadonlySet<number>): FormationUnit[];
}

/** Point queries for hover; the order target API retains its array contracts. */
export interface SelectionHitTargets {
  /** Any owned selectable kind under the point, including vehicles, using this frame's bounds. */
  hasOwnedAt(wx: number, wy: number): boolean;
  hasFlagAt(wx: number, wy: number): boolean;
  hasSignpostAt(wx: number, wy: number): boolean;
}

/** Turns the frame the player is looking at into the {@link Pickable}s a click hit-tests against. */
export function createUnitTargets(deps: UnitTargetsDeps): UnitTargets & SelectionHitTargets {
  /** The owner of a drawn item's entity; a synthetic ref or a departed entity has none. */
  const ownerOfRef = (snapshot: WorldSnapshot, ref: number): number | undefined => {
    const e = entityById(snapshot, ref);
    return e === undefined ? undefined : ownerPlayerOf(e);
  };

  /** Claimed livestock is the player's property rather than a unit: the herd drives itself, so it is
   *  neither pickable nor orderable. */
  const isLivestock = (e: SnapshotEntity): boolean => e.components.Livestock !== undefined;

  /** Whether an entity with this owner belongs to the pickable "ours" set. */
  const pickableOwner = (owner: number | undefined): boolean => {
    if (owner === undefined) return false;
    const seat = pickableSeat(deps.viewer);
    return seat === null || owner === seat;
  };

  /** The item's kind when it is one a unit-controls click selects or orders, else null. */
  const unitKindOf = (item: DrawItem): UnitTargetKind | null =>
    item.kind === 'settler' ||
    item.kind === 'building' ||
    item.kind === 'palisade' ||
    item.kind === 'roadsite' ||
    item.kind === 'vehicle'
      ? item.kind
      : null;

  const usesPixels = (kind: UnitTargetKind): boolean => kind === 'building' || kind === 'vehicle';

  /** A building or vehicle refines to solid pixels, since its sprite box overhangs the footprint. A palisade
   *  keeps its sprite box: the gaps between its posts are part of the wall a player aims at. A road plot's
   *  box grows a little, so the small flat plot stays easy to hit. */
  const hitTarget = (item: DrawItem, kind: UnitTargetKind): Pickable => {
    const pixelHitOf = deps.pixelHitOf;
    const box = deps.boundsOf?.(item.ref);
    return {
      ref: item.ref,
      x: item.x,
      y: item.y,
      kind,
      box: kind === 'roadsite' && box !== undefined ? grownBox(box, ROAD_PLOT_PICK_MARGIN) : box,
      ...(usesPixels(kind) && pixelHitOf !== undefined
        ? { pixelHit: (wx: number, wy: number) => pixelHitOf(item.ref, wx, wy) }
        : {}),
    };
  };

  const itemHits = (item: DrawItem, kind: UnitTargetKind | 'signpost', wx: number, wy: number): boolean => {
    const box = deps.boundsOf?.(item.ref);
    if (
      !containsTargetPoint(kind, item.x, item.y, box, wx, wy, kind === 'roadsite' ? ROAD_PLOT_PICK_MARGIN : 0)
    )
      return false;
    return kind === 'signpost' || !usesPixels(kind) || (deps.pixelHitOf?.(item.ref, wx, wy) ?? true);
  };

  const visitOwned = (
    kind: UnitTargetKind | 'all' | undefined,
    visit: (item: DrawItem, kind: UnitTargetKind) => boolean,
  ): boolean => {
    const snapshot = deps.snapshot();
    for (const item of deps.drawnItems()) {
      const itemKind = unitKindOf(item);
      if (itemKind === null) continue;
      if (kind === undefined ? itemKind === 'vehicle' : kind !== 'all' && itemKind !== kind) continue;
      if (!isHitTarget(item)) continue;
      const entity = entityById(snapshot, item.ref);
      if (entity === undefined || !pickableOwner(ownerPlayerOf(entity)) || isLivestock(entity)) continue;
      if (visit(item, itemKind)) return true;
    }
    return false;
  };

  const visitFlags = (visit: (item: DrawItem, gatherer: number) => boolean): boolean => {
    const gathererOf = gathererByFlag(deps.snapshot(), pickableSeat(deps.viewer) ?? 'any');
    if (gathererOf.size === 0) return false;
    for (const item of deps.drawnItems()) {
      if (item.isFlag !== true || !isHitTarget(item)) continue;
      const gatherer = gathererOf.get(item.ref);
      if (gatherer !== undefined && visit(item, gatherer)) return true;
    }
    return false;
  };

  const visitSignposts = (visit: (item: DrawItem) => boolean): boolean => {
    const snapshot = deps.snapshot();
    for (const item of deps.drawnItems()) {
      if (item.kind !== 'signpost' || item.ref <= 0 || !isHitTarget(item)) continue;
      if (!pickableOwner(ownerOfRef(snapshot, item.ref))) continue;
      if (visit(item)) return true;
    }
    return false;
  };

  return {
    owned(kind?: UnitTargetKind): Pickable[] {
      const out: Pickable[] = [];
      visitOwned(kind, (item, itemKind) => {
        out.push(hitTarget(item, itemKind));
        return false;
      });
      return out;
    },
    hasOwnedAt: (wx, wy) => visitOwned('all', (item, kind) => itemHits(item, kind, wx, wy)),
    hasFlagAt: (wx, wy) => visitFlags((item) => itemHits(item, 'settler', wx, wy)),
    hasSignpostAt: (wx, wy) => visitSignposts((item) => itemHits(item, 'signpost', wx, wy)),

    buildings(): Pickable[] {
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if (it.kind !== 'building' || !isHitTarget(it)) continue;
        out.push(hitTarget(it, 'building'));
      }
      return out;
    },

    enemies(opts): Pickable[] {
      const neutralWalls = opts?.neutralWalls === true && pickableSeat(deps.viewer) !== null;
      const snapshot = deps.snapshot();
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        // A unit, a building or a vehicle is an attack target - a warrior can raze an enemy structure
        // or batter a cart.
        const itemKind = unitKindOf(it);
        // A road site is flat ground: nothing to strike.
        if (itemKind === null || itemKind === 'roadsite') continue;
        // The ghost guard fog-gates the attack set: a remembered structure still draws, but no swing
        // can be ordered at it.
        if (!isHitTarget(it)) continue;
        const owner = ownerOfRef(snapshot, it.ref);
        if (owner === undefined) {
          // Other neutral entities are never attack targets, and observers issue no attacks.
          if (itemKind === 'palisade' && neutralWalls) out.push(hitTarget(it, itemKind));
          continue;
        }
        if (pickableOwner(owner)) continue; // "ours" - not an enemy
        if (!deps.hostileToward(owner)) continue; // an ally or truce holder is not an attack target
        out.push(hitTarget(it, itemKind));
      }
      return out;
    },

    flags(): Pickable[] {
      const out: Pickable[] = [];
      visitFlags((item, gatherer) => {
        // The flag's bounds follow terrain lift; its selection proxy is the gatherer.
        out.push({ ref: gatherer, x: item.x, y: item.y, kind: 'settler', box: deps.boundsOf?.(item.ref) });
        return false;
      });
      return out;
    },

    wildlife(): Pickable[] {
      const snapshot = deps.snapshot();
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if (it.kind !== 'settler' || !isHitTarget(it)) continue;
        const e = entityById(snapshot, it.ref);
        if (e === undefined || !isWildlife(e)) continue;
        if (ownerPlayerOf(e) !== undefined) continue; // owned - a person or someone's livestock, not game
        out.push(hitTarget(it, 'settler'));
      }
      return out;
    },

    signposts(): Pickable[] {
      const out: Pickable[] = [];
      visitSignposts((item) => {
        out.push({ ref: item.ref, x: item.x, y: item.y, kind: 'signpost', box: deps.boundsOf?.(item.ref) });
        return false;
      });
      return out;
    },

    chests(): Pickable[] {
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if (it.kind !== 'chest' || !isHitTarget(it)) continue;
        out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: deps.boundsOf?.(it.ref) });
      }
      return out;
    },

    goods(): Pickable[] {
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if ((it.kind !== 'stockpile' && it.kind !== 'grounddrop') || !isHitTarget(it)) continue;
        if (it.goodType === undefined) continue;
        out.push({
          ref: it.ref,
          x: it.x,
          y: it.y,
          kind: 'pile',
          goodType: it.goodType,
          box: deps.boundsOf?.(it.ref),
        });
      }
      return out;
    },

    resources(): Pickable[] {
      const out: Pickable[] = [];
      const emitted = new Set<number>();
      const pixelHitOf = deps.pixelHitOf;
      /** A resource is only hit on its drawn pixels: a plain right click beside a mushroom or a stone
       *  moves the flag without switching the gatherer's good to it. */
      const resourceTarget = (ref: number, x: number, y: number, goodType: number): Pickable => ({
        ref,
        x,
        y,
        kind: 'resource',
        goodType,
        box: deps.boundsOf?.(ref),
        ...(pixelHitOf !== undefined
          ? { pixelHit: (wx: number, wy: number) => pixelHitOf(ref, wx, wy) }
          : {}),
      });
      for (const it of deps.drawnItems()) {
        if (it.kind !== 'resource' || !isHitTarget(it)) continue;
        emitted.add(it.ref);
        if (it.goodType === undefined) continue;
        out.push(resourceTarget(it.ref, it.x, it.y, it.goodType));
      }
      // Virgin decoded-map resources are retained by the landscape layer and deliberately omitted from
      // the entity draw list. Project those live snapshot entities here so a right click can still
      // identify the tree/deposit the player sees; once first worked, the ordinary draw-item path takes over.
      for (const entity of entitiesWith(deps.snapshot(), 'LandscapeResource')) {
        if (emitted.has(entity.id)) continue;
        const value = entity.components.Resource as { goodType?: unknown } | undefined;
        const position = positionOf(entity);
        if (typeof value?.goodType !== 'number' || position === undefined) continue;
        const tileX = position.x / ONE;
        const tileY = position.y / ONE;
        if (deps.resourceVisible?.(tileX, tileY) === false) continue;
        const at = projectTile(deps.elevation, tileX, tileY);
        out.push(resourceTarget(entity.id, at.x, at.y, value.goodType));
      }
      return out;
    },

    ownedSettlersIn(refs: ReadonlySet<number>): FormationUnit[] {
      if (refs.size === 0) return [];
      const snapshot = deps.snapshot();
      const out: FormationUnit[] = [];
      for (const ref of refs) {
        const e = entityById(snapshot, ref);
        if (e === undefined || !isSettler(e) || !pickableOwner(ownerPlayerOf(e))) continue;
        if (isLivestock(e)) continue;
        if (!isPlayerControllable(e)) continue;
        const pos = positionOf(e);
        if (pos === undefined) continue;
        // No elevation lift and no cull: this set pairs units to formation slots against each other
        // rather than against the screen.
        out.push({ ref: e.id, ...tileToScreen(pos.x / ONE, pos.y / ONE) });
      }
      // Front-to-back then by id, the drawn scene's own order: the formation pairing breaks equal-cost
      // ties by input index, so a unit's slot must not depend on entity order.
      out.sort((a, b) => a.y - b.y || a.x - b.x || a.ref - b.ref);
      return out;
    },
  };
}
