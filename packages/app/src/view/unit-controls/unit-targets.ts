import {
  type DrawItem,
  type ElevationField,
  type EntityBounds,
  ONE,
  projectTile,
  SPRITE_CULL_MARGIN,
  TILE_HALF_H,
  TILE_HALF_W,
  tileToScreen,
} from '@open-northland/render';
import {
  collectPositioned,
  type EntitySnapshot,
  entitiesWith,
  entityById,
  positionOfNode,
  type TileBox,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  flagHolderOf,
  isPlayerControllable,
  isSettler,
  isWildlife,
  num,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerTribeOf,
  siteClaimBuilderOf,
} from '../../game/snapshot/index.js';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import { containsTargetPoint, drawnInFront, hitsTarget, isHitTarget, type Pickable } from '../picking.js';
import type { FormationUnit } from './orders/formation.js';
import { createPointScan, ROAD_PLOT_PICK_MARGIN } from './point-scan.js';

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
  /** `animaltypes.ini` `cannotbeattacked` for a tribe: decorative fauna no order may strike. */
  readonly animalCannotBeAttacked: (tribe: number) => boolean;
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
  /** Whether the point is on a claimed wall or road site's work flag, which then stands for its builder;
   *  absent, the flag is part of the site. */
  readonly siteFlagHitOf?: ((ref: number, wx: number, wy: number) => boolean) | undefined;
}

/** A passenger orders from the mooring, including one seated in a vehicle on the ship's deck. */
function passengerPosition(snapshot: WorldSnapshot, entity: SnapshotEntity): ReturnType<typeof positionOf> {
  let vehicle = num((entity.components.Rider as { vehicle?: unknown } | undefined)?.vehicle);
  const seen = new Set<number>();
  while (vehicle !== undefined && !seen.has(vehicle)) {
    seen.add(vehicle);
    const carrier = entityById(snapshot, vehicle);
    const state = carrier?.components.Vehicle as
      | { carrier?: unknown; moored?: unknown; mooring?: { hx?: unknown; hy?: unknown } }
      | undefined;
    if (state === undefined) return undefined;
    if (state.moored === true) {
      const hx = num(state.mooring?.hx);
      const hy = num(state.mooring?.hy);
      return hx === undefined || hy === undefined ? undefined : positionOfNode(hx, hy);
    }
    vehicle = num(state.carrier);
  }
  return undefined;
}

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
  /** The human's gatherers' drop-off flags and the work flags of the wall and road sites its builders
   *  claimed, each mapped to its settler (a flag→unit proxy). */
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
   * owner and is property rather than game, and `cannotbeattacked` fauna is no target, so both stay
   * out, exactly as the sim's ordered-target rule reads it.
   */
  wildlife(): Pickable[];
  /** The livestock on screen a scout may be sent to claim: wild, or held by a player the viewer's seat is
   *  hostile toward - the sim's claim rule. */
  claimableLivestock(): Pickable[];
  /**
   * The owned settlers among `refs` that take the player's orders, in draw order. Bound to the selection
   * rather than the screen, so it survives the camera panning away and reaches a settler standing inside
   * a building.
   */
  ownedSettlersIn(refs: ReadonlySet<number>): FormationUnit[];
}

/** A target under the point that carries a good: a goods heap, or a resource a gatherer may switch to. */
export interface GoodHit {
  readonly ref: number;
  readonly goodType: number;
}

/** A goods heap under the point, with the units it holds. */
export interface PileHit extends GoodHit {
  readonly amount: number;
}

/**
 * Everything a right click tells apart under one world point, each the frontmost of its set as
 * `pickTopAt` over the matching {@link UnitTargets} list picks it (a resource the nearest, as
 * `pickNearestAt` does), or null.
 */
export interface PointHits {
  readonly ownSettler: number | null;
  readonly ownVehicle: number | null;
  /** An own building, the right-click ladder's building rung. */
  readonly ownBuilding: number | null;
  /** An own wall segment still to be built or an own road site. */
  readonly site: number | null;
  /** Any standing building, whoever owns it: a trader's route candidate. */
  readonly building: number | null;
  /** From {@link UnitTargets.enemies} without the neutral walls. */
  readonly enemy: number | null;
  /** The frontmost enemy settler, which an armed vehicle strikes before any other enemy. */
  readonly enemySettler: number | null;
  readonly wildlife: number | null;
  readonly claimableLivestock: number | null;
  /** Any animal, wild, decorative or someone's livestock: what the hover names. */
  readonly creature: number | null;
  readonly chest: number | null;
  readonly pile: PileHit | null;
  readonly resource: GoodHit | null;
}

/** The right click's point classification, read in one pass over the frame. */
export interface PointHitTargets {
  pointHits(wx: number, wy: number): PointHits;
}

/** Point queries for hover; the order target API retains its array contracts. */
export interface SelectionHitTargets {
  /** Any owned selectable kind under the point, including vehicles, using this frame's bounds. */
  hasOwnedAt(wx: number, wy: number): boolean;
  hasFlagAt(wx: number, wy: number): boolean;
  hasSignpostAt(wx: number, wy: number): boolean;
}

/** The frontmost target of one set so far, ordered as {@link drawnInFront} orders them. */
type Front = { readonly ref: number; readonly y: number } | null;

/** The resource nearest the point so far, ordered as `pickNearestAt` orders them. */
type Nearest = { readonly ref: number; readonly goodType: number; readonly distance: number } | null;

function inFront(best: Front, item: DrawItem): Front {
  return best === null || drawnInFront(item, best) ? { ref: item.ref, y: item.y } : best;
}

function nearer(
  best: Nearest,
  ref: number,
  x: number,
  y: number,
  goodType: number,
  wx: number,
  wy: number,
): Nearest {
  const distance = (wx - x) * (wx - x) + (wy - y) * (wy - y);
  return best === null || distance < best.distance || (distance === best.distance && ref > best.ref)
    ? { ref, goodType, distance }
    : best;
}

/** Turns the frame the player is looking at into the {@link Pickable}s a click hit-tests against. */
export function createUnitTargets(
  deps: UnitTargetsDeps,
): UnitTargets & SelectionHitTargets & PointHitTargets {
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

  const boxHits = (item: DrawItem, kind: UnitTargetKind | 'signpost', wx: number, wy: number): boolean =>
    containsTargetPoint(
      kind,
      item.x,
      item.y,
      deps.boundsOf?.(item.ref),
      wx,
      wy,
      kind === 'roadsite' ? ROAD_PLOT_PICK_MARGIN : 0,
    );
  const pixelsHit = (item: DrawItem, kind: UnitTargetKind | 'signpost', wx: number, wy: number): boolean =>
    kind === 'signpost' || !usesPixels(kind) || (deps.pixelHitOf?.(item.ref, wx, wy) ?? true);

  const scanAt = createPointScan(deps);

  /** Visits the owned pickable items of `kind` among `items`; `under` filters on geometry first, so a
   *  point query reads the entities of the items under the point alone. */
  const visitOwned = (
    items: readonly DrawItem[],
    kind: UnitTargetKind | 'all' | undefined,
    visit: (item: DrawItem, kind: UnitTargetKind) => boolean,
    under?: (item: DrawItem, kind: UnitTargetKind) => boolean,
  ): boolean => {
    const snapshot = deps.snapshot();
    for (const item of items) {
      const itemKind = unitKindOf(item);
      if (itemKind === null) continue;
      if (kind === undefined ? itemKind === 'vehicle' : kind !== 'all' && itemKind !== kind) continue;
      if (!isHitTarget(item)) continue;
      if (under !== undefined && !under(item, itemKind)) continue;
      const entity = entityById(snapshot, item.ref);
      if (entity === undefined || !pickableOwner(ownerPlayerOf(entity)) || isLivestock(entity)) continue;
      if (visit(item, itemKind)) return true;
    }
    return false;
  };

  /** The builder whose claim planted a drawn site's flag, when the viewer may select that builder. */
  const siteBuilderOf = (snapshot: WorldSnapshot, item: DrawItem): number | undefined => {
    if (item.palisadeSite !== 'claimed' && item.roadSite !== 'claimed') return undefined;
    const site = entityById(snapshot, item.ref);
    const ref = site === undefined ? undefined : siteClaimBuilderOf(site);
    const builder = ref === undefined ? undefined : entityById(snapshot, ref);
    if (builder === undefined || !isSettler(builder) || !pickableOwner(ownerPlayerOf(builder)))
      return undefined;
    return builder.id;
  };

  /** The flag's bounds follow terrain lift; its selection proxy is its settler. A site's flag answers on
   *  its own pixels only, so the ring or plot it stands in still selects the site. */
  const visitFlags = (
    items: readonly DrawItem[],
    visit: (target: Pickable) => boolean,
    at?: { readonly x: number; readonly y: number },
  ): boolean => {
    const snapshot = deps.snapshot();
    const player = pickableSeat(deps.viewer) ?? 'any';
    const siteFlagHitOf = deps.siteFlagHitOf;
    for (const item of items) {
      if (!isHitTarget(item)) continue;
      const claimedSite = item.palisadeSite === 'claimed' || item.roadSite === 'claimed';
      if (item.isFlag !== true && (siteFlagHitOf === undefined || !claimedSite)) continue;
      const box = deps.boundsOf?.(item.ref);
      // A flag stands for its settler, so it hits as a settler's box would.
      if (at !== undefined && !containsTargetPoint('settler', item.x, item.y, box, at.x, at.y)) continue;
      if (item.isFlag === true) {
        const gatherer = flagHolderOf(snapshot, item.ref, player);
        if (gatherer !== undefined && visit({ ref: gatherer, x: item.x, y: item.y, kind: 'settler', box }))
          return true;
        continue;
      }
      if (siteFlagHitOf === undefined) continue;
      const builder = siteBuilderOf(snapshot, item);
      if (builder === undefined) continue;
      const pixelHit = (wx: number, wy: number): boolean => siteFlagHitOf(item.ref, wx, wy);
      if (visit({ ref: builder, x: item.x, y: item.y, kind: 'settler', box, pixelHit })) return true;
    }
    return false;
  };

  const visitSignposts = (
    items: readonly DrawItem[],
    visit: (item: DrawItem) => boolean,
    under?: (item: DrawItem) => boolean,
  ): boolean => {
    const snapshot = deps.snapshot();
    for (const item of items) {
      if (item.kind !== 'signpost' || item.ref <= 0 || !isHitTarget(item)) continue;
      if (under !== undefined && !under(item)) continue;
      if (!pickableOwner(ownerOfRef(snapshot, item.ref))) continue;
      if (visit(item)) return true;
    }
    return false;
  };

  /** Tile coordinates whose resources a sprite over the point may stand on: the renderer's cull slack
   *  bounds how far a drawn sprite reaches from its anchor, and a stagger or terrain lift adds a tile. */
  const retainedNear = (wx: number, wy: number): TileBox => {
    const reachY = SPRITE_CULL_MARGIN + (deps.elevation?.maxLift ?? 0);
    return {
      minX: (wx - SPRITE_CULL_MARGIN) / (2 * TILE_HALF_W) - 1,
      maxX: (wx + SPRITE_CULL_MARGIN) / (2 * TILE_HALF_W) + 1,
      minY: (wy - reachY) / TILE_HALF_H - 1,
      maxY: (wy + reachY) / TILE_HALF_H + 1,
    };
  };

  const resourceHits = (ref: number, x: number, y: number, wx: number, wy: number): boolean =>
    containsTargetPoint('resource', x, y, deps.boundsOf?.(ref), wx, wy) &&
    (deps.pixelHitOf?.(ref, wx, wy) ?? true);

  // Reused across point queries, so a hover read per frame allocates per hit rather than per item.
  const nearby: EntitySnapshot[] = [];

  const pointHits = (wx: number, wy: number): PointHits => {
    const snapshot = deps.snapshot();
    let ownSettler: Front = null;
    let ownVehicle: Front = null;
    let ownBuilding: Front = null;
    let site: Front = null;
    let building: Front = null;
    let enemy: Front = null;
    let enemySettler: Front = null;
    let wildlife: Front = null;
    let claimableLivestock: Front = null;
    let creature: Front = null;
    let chest: Front = null;
    let pile: (Front & { readonly goodType: number; readonly amount: number }) | null = null;
    let resource: Nearest = null;
    const scan = scanAt(wx, wy);
    for (const item of scan.items) {
      const kind = unitKindOf(item);
      if (kind === null) {
        if (item.kind === 'chest') {
          if (containsTargetPoint('chest', item.x, item.y, deps.boundsOf?.(item.ref), wx, wy))
            chest = inFront(chest, item);
        } else if (item.kind === 'stockpile' || item.kind === 'grounddrop') {
          const goodType = item.goodType;
          if (
            goodType !== undefined &&
            containsTargetPoint('pile', item.x, item.y, deps.boundsOf?.(item.ref), wx, wy) &&
            (pile === null || drawnInFront(item, pile))
          )
            pile = { ref: item.ref, y: item.y, goodType, amount: item.fill ?? 0 };
        } else if (item.kind === 'resource') {
          if (item.goodType !== undefined && resourceHits(item.ref, item.x, item.y, wx, wy))
            resource = nearer(resource, item.ref, item.x, item.y, item.goodType, wx, wy);
        }
        continue;
      }
      if (!boxHits(item, kind, wx, wy) || !pixelsHit(item, kind, wx, wy)) continue;
      const entity = entityById(snapshot, item.ref);
      const owner = entity === undefined ? undefined : ownerPlayerOf(entity);
      if (kind === 'building') building = inFront(building, item);
      if (entity !== undefined && pickableOwner(owner) && !isLivestock(entity)) {
        if (kind === 'settler') ownSettler = inFront(ownSettler, item);
        else if (kind === 'vehicle') ownVehicle = inFront(ownVehicle, item);
        else if (kind === 'building') ownBuilding = inFront(ownBuilding, item);
        else if (kind === 'roadsite' || entity.components.UnderConstruction !== undefined)
          site = inFront(site, item);
      }
      if (kind !== 'roadsite' && owner !== undefined && !pickableOwner(owner) && deps.hostileToward(owner)) {
        enemy = inFront(enemy, item);
        if (kind === 'settler') enemySettler = inFront(enemySettler, item);
      }
      if (kind !== 'settler' || entity === undefined) continue;
      if (isWildlife(entity)) creature = inFront(creature, item);
      if (isWildlife(entity) && owner === undefined) {
        const tribe = settlerTribeOf(entity);
        if (tribe === undefined || !deps.animalCannotBeAttacked(tribe)) wildlife = inFront(wildlife, item);
      }
      if (
        isLivestock(entity) &&
        (owner === undefined || (!pickableOwner(owner) && deps.hostileToward(owner)))
      )
        claimableLivestock = inFront(claimableLivestock, item);
    }
    const count = collectPositioned(snapshot, retainedNear(wx, wy), nearby);
    for (let i = 0; i < count; i++) {
      const entity = nearby[i];
      if (entity === undefined || entity.components.LandscapeResource === undefined) continue;
      if (scan.resources.has(entity.id)) continue;
      const goodType = (entity.components.Resource as { goodType?: unknown } | undefined)?.goodType;
      const position = positionOf(entity);
      if (typeof goodType !== 'number' || position === undefined) continue;
      const tileX = position.x / ONE;
      const tileY = position.y / ONE;
      if (deps.resourceVisible?.(tileX, tileY) === false) continue;
      const at = projectTile(deps.elevation, tileX, tileY);
      if (resourceHits(entity.id, at.x, at.y, wx, wy))
        resource = nearer(resource, entity.id, at.x, at.y, goodType, wx, wy);
    }
    return {
      ownSettler: ownSettler?.ref ?? null,
      ownVehicle: ownVehicle?.ref ?? null,
      ownBuilding: ownBuilding?.ref ?? null,
      site: site?.ref ?? null,
      building: building?.ref ?? null,
      enemy: enemy?.ref ?? null,
      enemySettler: enemySettler?.ref ?? null,
      wildlife: wildlife?.ref ?? null,
      claimableLivestock: claimableLivestock?.ref ?? null,
      creature: creature?.ref ?? null,
      chest: chest?.ref ?? null,
      pile: pile === null ? null : { ref: pile.ref, goodType: pile.goodType, amount: pile.amount },
      resource: resource === null ? null : { ref: resource.ref, goodType: resource.goodType },
    };
  };

  return {
    pointHits,
    owned(kind?: UnitTargetKind): Pickable[] {
      const out: Pickable[] = [];
      visitOwned(deps.drawnItems(), kind, (item, itemKind) => {
        out.push(hitTarget(item, itemKind));
        return false;
      });
      return out;
    },
    hasOwnedAt: (wx, wy) =>
      visitOwned(
        scanAt(wx, wy).items,
        'all',
        (item, kind) => pixelsHit(item, kind, wx, wy),
        (item, kind) => boxHits(item, kind, wx, wy),
      ),
    hasFlagAt: (wx, wy) =>
      visitFlags(scanAt(wx, wy).items, (target) => hitsTarget(target, wx, wy), { x: wx, y: wy }),
    hasSignpostAt: (wx, wy) =>
      visitSignposts(
        scanAt(wx, wy).items,
        () => true,
        (item) => boxHits(item, 'signpost', wx, wy),
      ),

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
      visitFlags(deps.drawnItems(), (target) => {
        out.push(target);
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
        // Decorative fauna is no target, so a click on it falls through to the order under it.
        const tribe = settlerTribeOf(e);
        if (tribe !== undefined && deps.animalCannotBeAttacked(tribe)) continue;
        out.push(hitTarget(it, 'settler'));
      }
      return out;
    },

    claimableLivestock(): Pickable[] {
      const snapshot = deps.snapshot();
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if (it.kind !== 'settler' || !isHitTarget(it)) continue;
        const e = entityById(snapshot, it.ref);
        if (e === undefined || !isLivestock(e)) continue;
        const owner = ownerPlayerOf(e);
        if (owner !== undefined && (pickableOwner(owner) || !deps.hostileToward(owner))) continue;
        out.push(hitTarget(it, 'settler'));
      }
      return out;
    },

    signposts(): Pickable[] {
      const out: Pickable[] = [];
      visitSignposts(deps.drawnItems(), (item) => {
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
        const pos = positionOf(e) ?? passengerPosition(snapshot, e);
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
