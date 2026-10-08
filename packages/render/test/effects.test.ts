import type { Entity, SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  BONES_LIFETIME_TICKS,
  type CombatEffect,
  effectAlpha,
  foldCombatEffects,
  MAX_ACTIVE_EFFECTS,
  WRECK_LIFETIME_TICKS,
} from '../src/data/effects/index.js';
import { CombatEffectsLayer } from '../src/gpu/overlays/effects-layer.js';
import { cameraViewport, makeElevationField } from '../src/index.js';

const died = (id: number, animal = false): SimEvent => ({
  kind: 'settlerDied',
  entity: id as Entity,
  cause: 'damage',
  player: 0,
  animal,
  at: { hx: 8, hy: 10 },
});

describe('combat remains', () => {
  it('leaves bones for a positioned human death, never an animal or a drained resource', () => {
    const marks = foldCombatEffects(
      [],
      [
        died(4),
        died(5, true),
        {
          kind: 'resourceDepleted',
          node: 7 as Entity,
          goodType: 21,
          at: { hx: 12, hy: 14 },
        },
        { kind: 'settlerDied', entity: 8 as Entity, cause: 'damage', player: 0 },
      ],
      100,
    );
    expect(marks).toEqual([{ kind: 'bones', hx: 8, hy: 10, spawnTick: 100, seed: expect.any(Number) }]);
    expect(foldCombatEffects(marks, [died(6, true)], 101)).toBe(marks);
  });

  it('leaves one debris mark per ruin node and none for a ruinless removal', () => {
    const wrecked = (ruins: { hx: number; hy: number }[]): SimEvent => ({
      kind: 'vehicleDestroyed',
      entity: 9 as Entity,
      player: 0,
      vehicleType: 5,
      tribe: 1,
      cause: 'destroyed',
      at: { hx: 6, hy: 6 },
      ruins,
    });
    const ruins = [
      { hx: 6, hy: 6 },
      { hx: 7, hy: 6 },
      { hx: 6, hy: 7 },
    ];
    const marks = foldCombatEffects([], [wrecked(ruins), wrecked([])], 3);
    expect(marks.map(({ kind, hx, hy }) => ({ kind, hx, hy }))).toEqual(
      ruins.map((at) => ({ kind: 'wreck', ...at })),
    );
    expect(new Set(marks.map((e) => e.seed)).size).toBe(3);
    expect(foldCombatEffects(marks, [], WRECK_LIFETIME_TICKS + 2)).toHaveLength(3);
    expect(foldCombatEffects(marks, [], WRECK_LIFETIME_TICKS + 3)).toEqual([]);
  });

  it('caps remains independently of the number of hits', () => {
    const marks = foldCombatEffects(
      [],
      Array.from({ length: MAX_ACTIVE_EFFECTS + 30 }, (_, i) => died(i)),
      1,
    );
    expect(marks).toHaveLength(MAX_ACTIVE_EFFECTS);
    const hits: SimEvent[] = Array.from({ length: 500 }, (_, i) => ({
      kind: 'combatHit',
      attacker: 1 as Entity,
      target: i as Entity,
      at: { hx: i, hy: 6 },
    }));
    expect(foldCombatEffects(marks, hits, 2)).toBe(marks);
  });

  it('holds remains, then fades continuously and retires their retained children', () => {
    const bones: CombatEffect = { kind: 'bones', hx: 0, hy: 0, spawnTick: 0, seed: 1 };
    expect(effectAlpha(bones, 0)).toBe(1);
    expect(effectAlpha(bones, BONES_LIFETIME_TICKS * 0.9)).toBeCloseTo(0.5);
    expect(effectAlpha(bones, BONES_LIFETIME_TICKS)).toBe(0);
    const layer = new CombatEffectsLayer();
    const flat = makeElevationField(undefined, 0, 0);
    const vp = cameraViewport({ offsetX: 400, offsetY: 300, scale: 1 }, 800, 600, 512);
    layer.ingest([died(2)], 0);
    layer.draw(flat, vp, 0);
    const node = layer.groundContainer.children[0];
    expect(node).toBeDefined();
    layer.ingest([], BONES_LIFETIME_TICKS);
    layer.draw(flat, vp, BONES_LIFETIME_TICKS);
    expect(node?.destroyed).toBe(true);
    expect(layer.groundContainer.children).toHaveLength(0);
    layer.destroy();
  });
});
