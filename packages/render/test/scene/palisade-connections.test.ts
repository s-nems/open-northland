import { type Fixed, ONE, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildSpriteScene, PALISADE_POST_SPACING_PX, palisadePostOffsets } from '../../src/index.js';
import { snapshotOf } from '../support/fixtures.js';

function palisade(id: number, hx: number, hy: number, built: Fixed = ONE, gfxIndex = 691) {
  const position = positionOfNode(hx, hy);
  return {
    id,
    components: {
      Position: position,
      Palisade: { gfxIndex, tribe: 1, built },
      ...(built < ONE ? { UnderConstruction: {} } : {}),
    },
  };
}

function damagedPalisade(id: number, hx: number, hy: number, hitpoints: number) {
  const entity = palisade(id, hx, hy);
  return {
    ...entity,
    components: { ...entity.components, Health: { hitpoints, max: 100 } },
  };
}

describe('palisadePostOffsets', () => {
  it('fills horizontal and diagonal half-cell edges with no span wider than a post body', () => {
    for (const [dx, dy] of [
      [34, 0],
      [34, 19],
      [-34, 19],
      [0, 19],
    ] as const) {
      const posts = palisadePostOffsets(dx, dy);
      const points = [{ dx: 0, dy: 0 }, ...posts, { dx, dy }];
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1];
        const to = points[i];
        expect(from).toBeDefined();
        expect(to).toBeDefined();
        if (from === undefined || to === undefined) continue;
        expect(Math.hypot(to.dx - from.dx, to.dy - from.dy)).toBeLessThanOrEqual(PALISADE_POST_SPACING_PX);
      }
    }
  });

  it('emits only interior posts, so endpoints remain tied to their own entities', () => {
    const posts = palisadePostOffsets(34, 0);
    expect(posts).toHaveLength(2);
    expect(posts[0]?.dx).toBeCloseTo(34 / 3);
    expect(posts[1]?.dx).toBeCloseTo(68 / 3);
    expect(posts.every((post) => post.dy === 0)).toBe(true);
    expect(palisadePostOffsets(0, 0)).toEqual([]);
  });

  it('joins every one of the six half-cell directions once, including a corner', () => {
    const centre = palisade(1, 10, 10);
    const neighbours = [
      palisade(2, 11, 10),
      palisade(3, 9, 10),
      palisade(4, 9, 9),
      palisade(5, 10, 9),
      palisade(6, 9, 11),
      palisade(7, 10, 11),
    ];
    const items = buildSpriteScene(snapshotOf([centre, ...neighbours]));
    expect(items).toHaveLength(7);
    const hub = items.find((item) => item.ref === 1);
    expect(hub?.kind).toBe('palisade');
    expect(hub?.palisadePosts).toHaveLength(12);
  });

  it('drops both adjoining edges when a corner post is removed', () => {
    const before = buildSpriteScene(snapshotOf([palisade(1, 0, 0), palisade(2, 1, 0), palisade(3, 1, 1)]));
    expect(before.flatMap((item) => item.palisadePosts ?? [])).toHaveLength(4);
    const after = buildSpriteScene(snapshotOf([palisade(1, 0, 0), palisade(3, 1, 1)]));
    expect(after.flatMap((item) => item.palisadePosts ?? [])).toEqual([]);
  });

  it('does not interpolate ordinary posts through a gate anchor', () => {
    const gate = palisade(2, 1, 0, ONE, 696);
    const items = buildSpriteScene(
      snapshotOf([
        palisade(1, 0, 0),
        {
          ...gate,
          components: {
            ...gate.components,
            Palisade: { ...gate.components.Palisade, gate: { open: false, counterpartGfxIndex: 700 } },
          },
        },
      ]),
    );
    expect(items.flatMap((item) => item.palisadePosts ?? [])).toEqual([]);
  });

  it.each([
    {
      label: 'horizontal',
      gfxIndex: 697,
      walk: [
        { dx: -2, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 2, dy: 0 },
      ],
      outside: [
        { hx: 7, hy: 10 },
        { hx: 13, hy: 10 },
      ],
    },
    {
      label: 'falling diagonal',
      gfxIndex: 696,
      walk: [
        { dx: -1, dy: -2 },
        { dx: -1, dy: -1 },
        { dx: 0, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 1, dy: 2 },
      ],
      outside: [
        { hx: 8, hy: 7 },
        { hx: 11, hy: 13 },
      ],
    },
    {
      label: 'rising diagonal',
      gfxIndex: 698,
      walk: [
        { dx: 1, dy: -2 },
        { dx: 0, dy: -1 },
        { dx: 0, dy: 0 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: 2 },
      ],
      outside: [
        { hx: 11, hy: 7 },
        { hx: 8, hy: 13 },
      ],
    },
  ])('joins outside walls to both $label gate terminals without filling the passage', (spec) => {
    const gate = palisade(2, 10, 10, ONE, spec.gfxIndex);
    const items = buildSpriteScene(
      snapshotOf([
        palisade(1, spec.outside[0]?.hx ?? 0, spec.outside[0]?.hy ?? 0),
        {
          ...gate,
          components: {
            ...gate.components,
            Palisade: {
              ...gate.components.Palisade,
              walk: spec.walk,
              gate: { open: false, counterpartGfxIndex: spec.gfxIndex + 4 },
            },
          },
        },
        palisade(3, spec.outside[1]?.hx ?? 0, spec.outside[1]?.hy ?? 0),
      ]),
    );
    expect(items.find((item) => item.ref === 1)?.palisadePosts).toHaveLength(3);
    expect(items.find((item) => item.ref === 2)?.palisadePosts).toBeUndefined();
    expect(items.find((item) => item.ref === 3)?.palisadePosts).toHaveLength(3);
    const collars = items.flatMap((item) => item.palisadePosts ?? []);
    expect(collars).toHaveLength(6);
    expect(collars.filter((post) => post.variantStep === 3)).toHaveLength(2);
  });

  it('interpolates construction progress between the edge endpoints', () => {
    const items = buildSpriteScene(
      snapshotOf([palisade(1, 0, 0), palisade(2, 1, 0, (ONE / 2) as Fixed, 695)]),
    );
    const edge = items.find((item) => item.ref === 1)?.palisadePosts;
    expect(edge?.map((post) => [post.gfxIndex, post.variantStep, post.builtPct])).toEqual([
      [691, 1, 83],
      [691, 2, 66],
    ]);
  });

  it('interpolates the source durability ladder for damaged finished posts', () => {
    const items = buildSpriteScene(snapshotOf([damagedPalisade(1, 0, 0, 80), damagedPalisade(2, 1, 0, 20)]));
    const edge = items.find((item) => item.ref === 1)?.palisadePosts;
    expect(items.find((item) => item.ref === 1)?.builtPct).toBe(80);
    expect(edge?.map((post) => post.builtPct)).toEqual([60, 40]);
  });
});
