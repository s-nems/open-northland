import { fx } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { mapStartFocus } from '../src/game/map-start.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * Headless coverage for the start-camera focus ladder (`?map=` opens on the player's start, not the
 * corner). The rungs — human settlers → human buildings → any entity → map centre — encode the policy
 * the PR exists to fix, so each is pinned here. `mapStartFocus` is pure over a `WorldSnapshot`; positions
 * are fixed-point visual-tile coords, so `fx.fromInt(col/row)` builds a synthetic snapshot that reads back
 * as the plain tile coord (`fx.toFloat`).
 */

const HUMAN = 0;
const ENEMY = 1;

/** A snapshot entity at tile `(col,row)`; `kind` sets the marker component, `owner` its `Owner.player`. */
function entity(
  id: number,
  kind: 'settler' | 'building' | 'resource',
  col: number,
  row: number,
  owner?: number,
): Ent {
  const components: Record<string, unknown> = { Position: { x: fx.fromInt(col), y: fx.fromInt(row) } };
  if (kind === 'settler') components.Settler = {};
  if (kind === 'building') components.Building = { buildingType: 1 };
  if (owner !== undefined) components.Owner = { player: owner };
  return { id, components };
}

describe('mapStartFocus', () => {
  it('centres on the human player settler cluster, ignoring distant human buildings and enemy units', () => {
    const focus = mapStartFocus(
      snapshotOf([
        entity(1, 'settler', 10, 10, HUMAN),
        entity(2, 'settler', 20, 20, HUMAN),
        entity(3, 'building', 100, 100, HUMAN), // the scattered base — must NOT drag the focus
        entity(4, 'settler', 200, 200, ENEMY), // an enemy start — must NOT count
      ]),
      256,
      256,
    );
    expect(focus).toEqual({ x: 15, y: 15 });
  });

  it('falls back to the human buildings centroid when the human has no settlers', () => {
    const focus = mapStartFocus(
      snapshotOf([
        entity(1, 'building', 10, 10, HUMAN),
        entity(2, 'building', 30, 10, HUMAN),
        entity(3, 'settler', 200, 200, ENEMY),
      ]),
      256,
      256,
    );
    expect(focus).toEqual({ x: 20, y: 10 });
  });

  it('falls back to ANY placed entity on a foreign-owned-only map', () => {
    const focus = mapStartFocus(
      snapshotOf([entity(1, 'settler', 40, 40, ENEMY), entity(2, 'building', 60, 40, ENEMY)]),
      256,
      256,
    );
    expect(focus).toEqual({ x: 50, y: 40 });
  });

  it('falls back to the map centre when no settler/building is placed (resources never pull focus)', () => {
    // A resource carries a Position but no Settler/Building marker, so an entity-less-of-units map — the
    // 108 imported maps whose only sim entities are harvestable nodes — frames on the map centre.
    expect(mapStartFocus(snapshotOf([entity(1, 'resource', 10, 10)]), 100, 80)).toEqual({ x: 50, y: 40 });
    expect(mapStartFocus(snapshotOf([]), 100, 80)).toEqual({ x: 50, y: 40 });
  });
});
