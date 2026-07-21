import { buildSpriteScene, type EntityBounds } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { gathererByFlag, ownerPlayerOf } from '../../game/snapshot.js';
import type { Pickable } from '../picking.js';
import { memoBySnapshot } from '../projections/index.js';

/** What the pickable target sets need from the unit-controls options (a subset threaded through). */
export interface UnitTargetsDeps {
  /** Read the current detached snapshot (memoized while sim state is unchanged). */
  readonly snapshot: () => WorldSnapshot;
  /** The human player whose units are selectable/orderable. */
  readonly humanPlayer: number;
  /** The observer session: every owner counts as "ours", so any player's entities are pickable
   *  (and none reads as an enemy — a spectator has no side to attack for). */
  readonly observer: boolean;
  /** The renderer's exact per-entity sprite bounds (world px), or undefined for the kind box. */
  readonly boundsOf: ((ref: number) => EntityBounds | undefined) | undefined;
  /** Pixel-accurate refinement of {@link boundsOf} for building targets, or undefined to keep the box. */
  readonly pixelHitOf: ((ref: number, wx: number, wy: number) => boolean | undefined) | undefined;
  /** The viewer's fog visibility at a fractional tile (gates the enemy hit-test set), or undefined = no fog. */
  readonly fogVisible: ((tileX: number, tileY: number) => boolean) | undefined;
}

/** The snapshot-derived pickable target sets the unit controls hit-test against. */
export interface UnitTargets {
  /** Owned, pickable targets (settlers + buildings) with their world-px feet anchors. */
  owned(kind?: 'settler' | 'building'): Pickable[];
  /** Enemy attack targets — settlers AND buildings owned by another player, fog-culled like the drawn
   *  scene. A right-click on one issues an `attackUnit` order (the sim accepts a building target). */
  enemies(): Pickable[];
  /** The human's gatherers' drop-off flags, each mapped to its owning gatherer (a flag→unit proxy). */
  flags(): Pickable[];
  /** The human's standing signposts — direct-click targets only (a marquee never grabs a post). */
  signposts(): Pickable[];
}

/**
 * The pickable target-set builders for the unit controls — each turns the current snapshot into the
 * {@link Pickable}s a click hit-tests against. Pure with respect to controller state (they read only the
 * snapshot + the injected render hit-test helpers), so they live apart from the selection/order logic.
 */
export function createUnitTargets(deps: UnitTargetsDeps): UnitTargets {
  // The unculled sprite scene + the id→owner map, both memoized by snapshot identity: one gesture runs
  // several builders (a click-release chains owned → flags → signposts), and `sim.snapshot()` is itself
  // memoized per tick — so the O(entities) project+sort and the owner map are built once, not per builder.
  const sceneFor = memoBySnapshot((snap) => buildSpriteScene(snap));
  /** Map each entity id → the player that owns it (absent for a neutral/unowned entity), from a snapshot. */
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

  return {
    owned(kind?: 'settler' | 'building'): Pickable[] {
      const snap = deps.snapshot();
      const ownerOf = ownersOf(snap);
      const out: Pickable[] = [];
      for (const it of sceneFor(snap)) {
        if (it.kind !== 'settler' && it.kind !== 'building') continue;
        if (kind !== undefined && it.kind !== kind) continue;
        if (!pickableOwner(ownerOf.get(it.ref))) continue;
        const pixelHitOf = deps.pixelHitOf;
        out.push({
          ref: it.ref,
          x: it.x,
          y: it.y,
          kind: it.kind,
          box: deps.boundsOf?.(it.ref),
          // Buildings refine to solid pixels (see UnitControlsOptions.pixelHitOf); settlers keep the box.
          ...(it.kind === 'building' && pixelHitOf !== undefined
            ? { pixelHit: (wx: number, wy: number) => pixelHitOf(it.ref, wx, wy) }
            : {}),
        });
      }
      return out;
    },

    enemies(): Pickable[] {
      const snap = deps.snapshot();
      const ownerOf = ownersOf(snap);
      const pixelHitOf = deps.pixelHitOf;
      const out: Pickable[] = [];
      for (const it of buildSpriteScene(snap, { fogVisible: deps.fogVisible })) {
        // A unit OR a building is an attack target — a warrior can raze an enemy structure.
        if (it.kind !== 'settler' && it.kind !== 'building') continue;
        const owner = ownerOf.get(it.ref);
        if (owner === undefined || pickableOwner(owner)) continue; // neutral or "ours" — not an enemy
        out.push({
          ref: it.ref,
          x: it.x,
          y: it.y,
          kind: it.kind,
          box: deps.boundsOf?.(it.ref),
          // A building refines to solid pixels (its sprite box overhangs the footprint); a settler keeps
          // the box — the same split the owned() picker uses.
          ...(it.kind === 'building' && pixelHitOf !== undefined
            ? { pixelHit: (wx: number, wy: number) => pixelHitOf(it.ref, wx, wy) }
            : {}),
        });
      }
      return out;
    },

    flags(): Pickable[] {
      const snap = deps.snapshot();
      // flag-id → owning gatherer-id (not a player id); an observer picks every player's flags
      const gathererOf = gathererByFlag(snap, deps.observer ? 'any' : deps.humanPlayer);
      if (gathererOf.size === 0) return [];
      const out: Pickable[] = [];
      for (const it of sceneFor(snap)) {
        if (it.isFlag !== true) continue;
        const gatherer = gathererOf.get(it.ref);
        if (gatherer === undefined) continue; // an unbound / non-human flag — not a selection proxy
        out.push({ ref: gatherer, x: it.x, y: it.y, kind: 'settler' });
      }
      return out;
    },

    signposts(): Pickable[] {
      const snap = deps.snapshot();
      const ownerOf = ownersOf(snap);
      const out: Pickable[] = [];
      for (const it of sceneFor(snap)) {
        // Only the post itself — its direction boards ride synthetic negative refs (see sprite-scene.ts).
        if (it.kind !== 'signpost' || it.ref <= 0) continue;
        if (!pickableOwner(ownerOf.get(it.ref))) continue;
        out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: deps.boundsOf?.(it.ref) });
      }
      return out;
    },
  };
}
