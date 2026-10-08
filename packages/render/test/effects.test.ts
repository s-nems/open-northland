import { type Entity, packSnapshotDelta, type SimEvent, SnapshotMirror } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  BONES_LIFETIME_TICKS,
  boneAlpha,
  collectBonePiles,
  foldWreckMarks,
  MAX_ACTIVE_WRECKS,
  WRECK_LIFETIME_TICKS,
} from '../src/data/effects/index.js';
import { CombatEffectsLayer } from '../src/gpu/overlays/effects-layer.js';
import { cameraViewport, makeElevationField } from '../src/index.js';
import { snapshotOf } from './support/fixtures.js';

const wrecked = (ruins: { hx: number; hy: number }[], entity = 9): SimEvent => ({
  kind: 'vehicleDestroyed',
  entity: entity as Entity,
  player: 0,
  vehicleType: 5,
  tribe: 1,
  cause: 'destroyed',
  at: { hx: 6, hy: 6 },
  ruins,
});

/** Tiles past any map, so a box of this reach holds the whole world. */
const MAP_REACH = 1 << 12;

const pile = (id: number, tick: number) => ({ id, components: { BonePile: { hx: 8, hy: 10, tick } } });

describe('wreck debris', () => {
  it('leaves one debris mark per ruin node and none for a ruinless removal', () => {
    const ruins = [
      { hx: 6, hy: 6 },
      { hx: 7, hy: 6 },
      { hx: 6, hy: 7 },
    ];
    const marks = foldWreckMarks([], [wrecked(ruins), wrecked([])], 3);
    expect(marks.map(({ hx, hy }) => ({ hx, hy }))).toEqual(ruins);
    expect(new Set(marks.map((e) => e.seed)).size).toBe(3);
    expect(foldWreckMarks(marks, [], WRECK_LIFETIME_TICKS + 2)).toHaveLength(3);
    expect(foldWreckMarks(marks, [], WRECK_LIFETIME_TICKS + 3)).toEqual([]);
  });

  it('caps the marks and keeps the list through a frame that raised none', () => {
    const marks = foldWreckMarks(
      [],
      Array.from({ length: MAX_ACTIVE_WRECKS + 30 }, (_, i) => wrecked([{ hx: i, hy: 6 }], i)),
      1,
    );
    expect(marks).toHaveLength(MAX_ACTIVE_WRECKS);
    expect(foldWreckMarks(marks, [], 2)).toBe(marks);
  });
});

describe('bone piles', () => {
  it('lie whole, then fade slowly when bones fade, and stay whole for good otherwise', () => {
    expect(boneAlpha(0, true)).toBe(1);
    expect(boneAlpha(BONES_LIFETIME_TICKS / 3, true)).toBe(1);
    expect(boneAlpha((BONES_LIFETIME_TICKS * 2) / 3, true)).toBeCloseTo(0.5);
    expect(boneAlpha(BONES_LIFETIME_TICKS, true)).toBe(0);
    expect(boneAlpha(BONES_LIFETIME_TICKS * 100, false)).toBe(1);
  });

  const flat = makeElevationField(undefined, 0, 0);
  const viewport = cameraViewport({ offsetX: 400, offsetY: 300, scale: 1 }, 800, 600, 512);

  it('draws the saved piles of the snapshot and retires a faded one', () => {
    const layer = new CombatEffectsLayer();
    const snapshot = snapshotOf([pile(2, 0)]);
    layer.draw({ snapshot, elevation: flat, viewport, renderTime: 0 });
    const node = layer.groundContainer.children[0];
    expect(node?.alpha).toBe(1);
    layer.draw({ snapshot, elevation: flat, viewport, renderTime: BONES_LIFETIME_TICKS });
    expect(node?.destroyed).toBe(true);
    expect(layer.groundContainer.children).toHaveLength(0);
    layer.setBonesFade(false);
    layer.draw({ snapshot, elevation: flat, viewport, renderTime: BONES_LIFETIME_TICKS * 10 });
    expect(layer.groundContainer.children[0]?.alpha).toBe(1);
    layer.destroy();
  });

  it('shows a pile on explored ground and hides it on unexplored ground', () => {
    const layer = new CombatEffectsLayer();
    const snapshot = snapshotOf([pile(2, 0)]);
    let explored = false;
    const frame = { snapshot, elevation: flat, viewport, renderTime: 1, fogExplored: () => explored };
    layer.draw(frame);
    expect(layer.groundContainer.children).toHaveLength(0);
    explored = true;
    layer.draw(frame);
    expect(layer.groundContainer.children).toHaveLength(1);
    layer.destroy();
  });

  it('keeps its index equal to a fresh walk as piles arrive and go', () => {
    const mirror = new SnapshotMirror();
    const WHOLE_MAP = { minX: -MAP_REACH, minY: -MAP_REACH, maxX: MAP_REACH, maxY: MAP_REACH };
    let sequence = 0;
    const apply = (
      touched: { id: number; components: Record<string, unknown> }[],
      removed: number[] = [],
    ) => {
      mirror.apply(
        packSnapshotDelta({
          tick: sequence,
          sequence,
          rebuild: sequence++ === 0,
          touched: touched.map(({ id, components }) => ({ id, components, removed: [] })),
          removed,
          events: [],
        }),
      );
    };
    apply([pile(2, 0)]);
    expect(collectBonePiles(mirror.snapshot(), WHOLE_MAP, [])).toBe(1);
    apply([pile(3, 1), { id: 4, components: { Health: { hitpoints: 1, max: 1 } } }]);
    expect(mirror.verifyIndexes()).toEqual([]);
    apply([], [2]);
    expect(collectBonePiles(mirror.snapshot(), WHOLE_MAP, [])).toBe(1);
    expect(mirror.verifyIndexes()).toEqual([]);
  });
});
