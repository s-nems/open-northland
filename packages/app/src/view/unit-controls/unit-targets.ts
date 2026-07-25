import { type DrawItem, type EntityBounds, ONE, tileToScreen } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { gathererByFlag, isSettler, ownerPlayerOf, positionOf } from '../../game/snapshot.js';
import { isHitTarget, type Pickable } from '../picking.js';
import { memoBySnapshot } from '../projections/index.js';
import type { FormationUnit } from './formation.js';

/** What the pickable target sets need from the unit-controls options (a subset threaded through). */
export interface UnitTargetsDeps {
  /** Read the current detached snapshot (memoized while sim state is unchanged). */
  readonly snapshot: () => WorldSnapshot;
  /** The human player whose units are selectable/orderable. */
  readonly humanPlayer: number;
  /** The observer session: every owner counts as "ours", so any player's entities are pickable
   *  (and none reads as an enemy — a spectator has no side to attack for). */
  readonly observer: boolean;
  /** The frame the player is clicking on — see {@link import('./types.js').UnitControlsOptions.drawnItems}. */
  readonly drawnItems: () => readonly DrawItem[];
  /** The renderer's exact per-entity sprite bounds (world px), or undefined for the kind box. */
  readonly boundsOf: ((ref: number) => EntityBounds | undefined) | undefined;
  /** Pixel-accurate refinement of {@link boundsOf} for building targets, or undefined to keep the box. */
  readonly pixelHitOf: ((ref: number, wx: number, wy: number) => boolean | undefined) | undefined;
}

/** The drawable kinds a unit-controls click resolves to (a signpost has its own picker). */
export type UnitTargetKind = 'settler' | 'building';

/** The pickable target sets the unit controls hit-test a click against, plus the order-issuing set. */
export interface UnitTargets {
  /** Owned, pickable targets (settlers + buildings) with their world-px feet anchors. */
  owned(kind?: UnitTargetKind): Pickable[];
  /** Enemy attack targets — settlers AND buildings owned by another player. A right-click on one issues
   *  an `attackUnit` order (the sim accepts a building target). */
  enemies(): Pickable[];
  /** The human's gatherers' drop-off flags, each mapped to its owning gatherer (a flag→unit proxy). */
  flags(): Pickable[];
  /** The human's standing signposts — direct-click targets only (a marquee never grabs a post). */
  signposts(): Pickable[];
  /**
   * The owned settlers among `refs`, in draw order — the set an order is issued to. Unlike the hit-test
   * sets it is bound to the selection, not the screen: a selection survives the camera panning away from
   * it, and it reaches a settler standing inside a building, which the frame does not draw.
   */
  ownedSettlersIn(refs: ReadonlySet<number>): FormationUnit[];
}

/**
 * The pickable target-set builders for the unit controls — each turns the frame the player is looking at
 * into the {@link Pickable}s a click hit-tests against. Pure with respect to controller state (they read
 * only the snapshot + the injected render frame data), so they live apart from the selection/order logic.
 */
export function createUnitTargets(deps: UnitTargetsDeps): UnitTargets {
  // The id→owner map, memoized by snapshot identity: one gesture runs several builders (a click-release
  // chains owned → flags → signposts) and `sim.snapshot()` is itself memoized per tick, so the
  // O(entities) pass runs once per tick rather than once per builder.
  const ownersOf = memoBySnapshot((snap: WorldSnapshot) => {
    const ownerOf = new Map<number, number>();
    for (const e of snap.entities) {
      const player = ownerPlayerOf(e);
      if (player !== undefined) ownerOf.set(e.id, player);
    }
    return ownerOf;
  });

  /** Whether an entity with this owner belongs to the pickable "ours" set. */
  const pickableOwner = (owner: number | undefined): boolean =>
    owner !== undefined && (deps.observer || owner === deps.humanPlayer);

  /** The item's kind when it is one a unit-controls click resolves to, else null. */
  const unitKindOf = (item: DrawItem): UnitTargetKind | null =>
    item.kind === 'settler' || item.kind === 'building' ? item.kind : null;

  /** A drawn settler/building as a hit target. A building refines to solid pixels (its sprite box
   *  overhangs the footprint); a settler keeps the deliberately generous box. */
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
      const ownerOf = ownersOf(deps.snapshot());
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        const itemKind = unitKindOf(it);
        if (itemKind === null || (kind !== undefined && itemKind !== kind)) continue;
        if (!isHitTarget(it)) continue;
        if (!pickableOwner(ownerOf.get(it.ref))) continue;
        out.push(hitTarget(it, itemKind));
      }
      return out;
    },

    enemies(): Pickable[] {
      const ownerOf = ownersOf(deps.snapshot());
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        // A unit OR a building is an attack target — a warrior can raze an enemy structure.
        const itemKind = unitKindOf(it);
        if (itemKind === null) continue;
        // The ghost guard is what keeps the attack set fog-gated: an explored structure the fog has
        // since swallowed still draws, as a memory you cannot order a swing at.
        if (!isHitTarget(it)) continue;
        const owner = ownerOf.get(it.ref);
        if (owner === undefined || pickableOwner(owner)) continue; // neutral or "ours" — not an enemy
        out.push(hitTarget(it, itemKind));
      }
      return out;
    },

    flags(): Pickable[] {
      // flag-id → owning gatherer-id (not a player id); an observer picks every player's flags
      const gathererOf = gathererByFlag(deps.snapshot(), deps.observer ? 'any' : deps.humanPlayer);
      if (gathererOf.size === 0) return [];
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        if (it.isFlag !== true || !isHitTarget(it)) continue;
        const gatherer = gathererOf.get(it.ref);
        if (gatherer === undefined) continue; // an unbound / non-human flag — not a selection proxy
        out.push({ ref: gatherer, x: it.x, y: it.y, kind: 'settler' });
      }
      return out;
    },

    signposts(): Pickable[] {
      const ownerOf = ownersOf(deps.snapshot());
      const out: Pickable[] = [];
      for (const it of deps.drawnItems()) {
        // Only the post itself — its direction boards ride synthetic negative refs (see sprite-scene.ts).
        if (it.kind !== 'signpost' || it.ref <= 0 || !isHitTarget(it)) continue;
        if (!pickableOwner(ownerOf.get(it.ref))) continue;
        out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: deps.boundsOf?.(it.ref) });
      }
      return out;
    },

    ownedSettlersIn(refs: ReadonlySet<number>): FormationUnit[] {
      if (refs.size === 0) return [];
      const out: FormationUnit[] = [];
      for (const e of deps.snapshot().entities) {
        if (!refs.has(e.id) || !isSettler(e) || !pickableOwner(ownerPlayerOf(e))) continue;
        const pos = positionOf(e);
        if (pos === undefined) continue;
        // Feet anchor only, projected straight from the position: no elevation lift and no cull, because
        // this set pairs units to formation slots against each other rather than against the screen.
        out.push({ ref: e.id, ...tileToScreen(pos.x / ONE, pos.y / ONE) });
      }
      // Front-to-back then by id, the drawn scene's own order — assignFormation's pairing breaks
      // equal-cost ties by input index, so the slot a unit lands in must not depend on entity order.
      out.sort((a, b) => a.y - b.y || a.x - b.x || a.ref - b.ref);
      return out;
    },
  };
}
