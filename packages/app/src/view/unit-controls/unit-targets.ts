import {
  type DrawItem,
  type ElevationField,
  type EntityBounds,
  ONE,
  projectTile,
  tileToScreen,
} from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import {
  gathererByFlag,
  isPlayerControllable,
  isSettler,
  isWildlife,
  ownerPlayerOf,
  positionOf,
} from '../../game/snapshot.js';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import { isHitTarget, type Pickable } from '../picking.js';
import { memoBySnapshot } from '../projections/index.js';
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
  /** The renderer's exact per-entity sprite bounds (world px), or undefined for the kind box. */
  readonly boundsOf: ((ref: number) => EntityBounds | undefined) | undefined;
  /** Terrain lift used to project retained map resources, which do not enter the entity draw list. */
  readonly elevation?: ElevationField | undefined;
  /** Whether a retained resource is live-visible rather than only remembered through fog. */
  readonly resourceVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** Pixel-accurate refinement of {@link boundsOf} for building targets, or undefined to keep the box. */
  readonly pixelHitOf: ((ref: number, wx: number, wy: number) => boolean | undefined) | undefined;
}

/** The drawable kinds a unit-controls click resolves to (a signpost has its own picker). */
export type UnitTargetKind = 'settler' | 'building' | 'palisade';

/** The pickable target sets the unit controls hit-test a click against, plus the order-issuing set. */
export interface UnitTargets {
  /** Owned, pickable targets (settlers + buildings) with their world-px feet anchors. */
  owned(kind?: UnitTargetKind): Pickable[];
  /** Every standing building drawn this frame, whoever owns it: a trader's route may name another
   *  tribe's house. */
  buildings(): Pickable[];
  /** Enemy attack targets - settlers AND buildings of a player the human holds an `enemy` stance
   *  toward. A right-click on one issues an `attackUnit` order (the sim accepts a building target). */
  enemies(): Pickable[];
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

/** Turns the frame the player is looking at into the {@link Pickable}s a click hit-tests against. */
export function createUnitTargets(deps: UnitTargetsDeps): UnitTargets {
  // Memoized by snapshot identity, so this O(entities) pass runs once per tick rather than once per
  // builder: a single click-release chains owned, flags and signposts.
  const ownersOf = memoBySnapshot((snap: WorldSnapshot) => {
    const ownerOf = new Map<number, number>();
    // Claimed livestock is the player's property rather than a unit: the herd drives itself, so it is
    // neither pickable nor orderable.
    const livestock = new Set<number>();
    for (const e of snap.entities) {
      const player = ownerPlayerOf(e);
      if (player !== undefined) ownerOf.set(e.id, player);
      if (e.components.Livestock !== undefined) livestock.add(e.id);
    }
    return { ownerOf, livestock };
  });

  /** Whether an entity with this owner belongs to the pickable "ours" set. */
  const pickableOwner = (owner: number | undefined): boolean => {
    if (owner === undefined) return false;
    const seat = pickableSeat(deps.viewer);
    return seat === null || owner === seat;
  };

  /** The item's kind when it is one a unit-controls click resolves to, else null. */
  const unitKindOf = (item: DrawItem): UnitTargetKind | null =>
    item.kind === 'settler' || item.kind === 'building' || item.kind === 'palisade' ? item.kind : null;

  /** A building refines to solid pixels, since its sprite box overhangs the footprint. A palisade keeps
   *  its sprite box: the gaps between its posts are part of the wall a player aims at. */
  const hitTarget = (item: DrawItem, kind: UnitTargetKind): Pickable => {
    const pixelHitOf = deps.pixelHitOf;
    return {
      ref: item.ref,
      x: item.x,
      y: item.y,
      kind,
      box: deps.boundsOf?.(item.ref),
      ...(kind === 'building' && pixelHitOf !== undefined
        ? { pixelHit: (wx: number, wy: number) => pixelHitOf(item.ref, wx, wy) }
        : {}),
    };
  };

  return {
    owned(kind?: UnitTargetKind): Pickable[] {
      const { ownerOf, livestock } = ownersOf(deps.snapshot());
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        const itemKind = unitKindOf(it);
        if (itemKind === null || (kind !== undefined && itemKind !== kind)) continue;
        if (!isHitTarget(it)) continue;
        if (!pickableOwner(ownerOf.get(it.ref))) continue;
        if (livestock.has(it.ref)) continue; // see the livestock note on the memo
        out.push(hitTarget(it, itemKind));
      }
      return out;
    },

    buildings(): Pickable[] {
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if (it.kind !== 'building' || !isHitTarget(it)) continue;
        out.push(hitTarget(it, 'building'));
      }
      return out;
    },

    enemies(): Pickable[] {
      const { ownerOf } = ownersOf(deps.snapshot());
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        // A unit OR a building is an attack target - a warrior can raze an enemy structure.
        const itemKind = unitKindOf(it);
        if (itemKind === null) continue;
        // The ghost guard fog-gates the attack set: a remembered structure still draws, but no swing
        // can be ordered at it.
        if (!isHitTarget(it)) continue;
        const owner = ownerOf.get(it.ref);
        if (owner === undefined) {
          // Neutral palisades are explicit structure targets in the sim. Other neutral entities keep
          // their existing non-enemy meaning, and observers cannot issue attacks.
          if (itemKind !== 'palisade' || pickableSeat(deps.viewer) === null) continue;
          out.push(hitTarget(it, itemKind));
          continue;
        }
        if (pickableOwner(owner)) continue; // "ours" - not an enemy
        if (!deps.hostileToward(owner)) continue; // an ally or truce holder is not an attack target
        out.push(hitTarget(it, itemKind));
      }
      return out;
    },

    flags(): Pickable[] {
      // flag-id → owning gatherer-id (not a player id); a whole-map viewer picks every player's flags
      const gathererOf = gathererByFlag(deps.snapshot(), pickableSeat(deps.viewer) ?? 'any');
      if (gathererOf.size === 0) return [];
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if (it.isFlag !== true || !isHitTarget(it)) continue;
        const gatherer = gathererOf.get(it.ref);
        if (gatherer === undefined) continue; // an unbound / non-human flag - not a selection proxy
        // The flag's own drawn bounds: the feet anchor is pre-lift, so a box around it misses a flag on
        // raised ground.
        out.push({ ref: gatherer, x: it.x, y: it.y, kind: 'settler', box: deps.boundsOf?.(it.ref) });
      }
      return out;
    },

    wildlife(): Pickable[] {
      const snapshot = deps.snapshot();
      const { ownerOf } = ownersOf(snapshot);
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if (it.kind !== 'settler' || !isHitTarget(it)) continue;
        if (ownerOf.has(it.ref)) continue; // owned - a person or someone's livestock, not game
        const e = entityById(snapshot, it.ref);
        if (e === undefined || !isWildlife(e)) continue;
        out.push(hitTarget(it, 'settler'));
      }
      return out;
    },

    signposts(): Pickable[] {
      const { ownerOf } = ownersOf(deps.snapshot());
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        // Only the post itself - its direction boards ride synthetic negative refs (see sprite-scene.ts).
        if (it.kind !== 'signpost' || it.ref <= 0 || !isHitTarget(it)) continue;
        if (!pickableOwner(ownerOf.get(it.ref))) continue;
        out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: deps.boundsOf?.(it.ref) });
      }
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
      for (const it of deps.drawnItems()) {
        if (it.kind !== 'resource' || !isHitTarget(it)) continue;
        emitted.add(it.ref);
        out.push({
          ref: it.ref,
          x: it.x,
          y: it.y,
          kind: it.kind,
          box: deps.boundsOf?.(it.ref),
          ...(it.goodType !== undefined ? { goodType: it.goodType } : {}),
        });
      }
      // Virgin decoded-map resources are retained by the landscape layer and deliberately omitted from
      // the entity draw list. Project those live snapshot entities here so Ctrl+RMB can still identify
      // the tree/deposit the player sees; once first worked, the ordinary draw-item path takes over.
      for (const entity of deps.snapshot().entities) {
        if (emitted.has(entity.id) || entity.components.LandscapeResource === undefined) continue;
        const value = entity.components.Resource as { goodType?: unknown } | undefined;
        const position = positionOf(entity);
        if (typeof value?.goodType !== 'number' || position === undefined) continue;
        const tileX = position.x / ONE;
        const tileY = position.y / ONE;
        if (deps.resourceVisible?.(tileX, tileY) === false) continue;
        const at = projectTile(deps.elevation, tileX, tileY);
        out.push({ ref: entity.id, x: at.x, y: at.y, kind: 'resource', goodType: value.goodType });
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
        if (e.components.Livestock !== undefined) continue; // see the livestock note on the memo
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
