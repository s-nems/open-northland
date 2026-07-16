import { buildSpriteScene, type EntityBounds } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { gathererByFlag, ownerPlayerOf } from '../../game/snapshot.js';
import type { Pickable } from '../picking.js';

/** What the pickable target sets need from the unit-controls options (a subset threaded through). */
export interface UnitTargetsDeps {
  /** Read the current frozen snapshot (rebuilt every frame; each query pulls it on demand). */
  readonly snapshot: () => WorldSnapshot;
  /** The human player whose units are selectable/orderable. */
  readonly humanPlayer: number;
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
  /** Enemy settlers — units owned by another player, fog-culled like the drawn scene. */
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
  /** Map each entity id → the player that owns it (absent for a neutral/unowned entity), from a snapshot. */
  const ownersOf = (snap: WorldSnapshot): Map<number, number> => {
    const ownerOf = new Map<number, number>();
    for (const e of snap.entities) {
      const player = ownerPlayerOf(e);
      if (player !== undefined) ownerOf.set(e.id, player);
    }
    return ownerOf;
  };

  return {
    owned(kind?: 'settler' | 'building'): Pickable[] {
      const snap = deps.snapshot();
      const ownerOf = ownersOf(snap);
      const out: Pickable[] = [];
      for (const it of buildSpriteScene(snap)) {
        if (it.kind !== 'settler' && it.kind !== 'building') continue;
        if (kind !== undefined && it.kind !== kind) continue;
        if (ownerOf.get(it.ref) !== deps.humanPlayer) continue;
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
      const out: Pickable[] = [];
      for (const it of buildSpriteScene(snap, { fogVisible: deps.fogVisible })) {
        if (it.kind !== 'settler') continue; // only a unit is an attack target
        const owner = ownerOf.get(it.ref);
        if (owner === undefined || owner === deps.humanPlayer) continue; // neutral or own — not an enemy
        out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: deps.boundsOf?.(it.ref) });
      }
      return out;
    },

    flags(): Pickable[] {
      const snap = deps.snapshot();
      const gathererOf = gathererByFlag(snap, deps.humanPlayer); // flag-id → owning gatherer-id (not a player id)
      if (gathererOf.size === 0) return [];
      const out: Pickable[] = [];
      for (const it of buildSpriteScene(snap)) {
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
      for (const it of buildSpriteScene(snap)) {
        // Only the post itself — its direction boards ride synthetic negative refs (see sprite-scene.ts).
        if (it.kind !== 'signpost' || it.ref <= 0) continue;
        if (ownerOf.get(it.ref) !== deps.humanPlayer) continue;
        out.push({ ref: it.ref, x: it.x, y: it.y, kind: it.kind, box: deps.boundsOf?.(it.ref) });
      }
      return out;
    },
  };
}
