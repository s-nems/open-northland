import { type Fixed, ONE, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { palisadeLayoutOf, planShiftX } from '../../src/data/scene/palisade-connections.js';
import { PALISADE_STAGGER_PX } from '../../src/data/scene/palisade-stagger.js';
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
    // Each edge's two posts split between its ends: the hub holds the one nearer it on all six.
    expect(hub?.palisadePosts).toHaveLength(6);
    // Six spokes and the six edges joining the ring, two posts each.
    expect(items.flatMap((item) => item.palisadePosts ?? [])).toHaveLength(24);
  });

  it('draws each post of an edge with the end it stands nearer, offset from that end', () => {
    const items = buildSpriteScene(snapshotOf([palisade(1, 10, 10), palisade(2, 11, 10)]));
    const near = items.find((item) => item.ref === 1)?.palisadePosts ?? [];
    const far = items.find((item) => item.ref === 2)?.palisadePosts ?? [];
    expect(near).toHaveLength(1);
    expect(far).toHaveLength(1);
    expect(near[0]?.dx).toBeGreaterThan(0);
    expect(far[0]?.dx).toBeLessThan(0);
    // A third of the edge from each end.
    expect(near[0]?.dx).toBeCloseTo(-(far[0]?.dx ?? 0), 5);
  });

  it('draws a hex-diagonal run straight, posts included, shifts a row whole and keeps a column', () => {
    const run: Array<readonly [number, number]> = [
      [10, 11],
      [11, 10],
      [11, 9],
      [12, 8],
      [12, 7],
    ];
    const items = buildSpriteScene(snapshotOf(run.map(([hx, hy], i) => palisade(i + 1, hx, hy))));
    const drawn = run.map((_, i) => items.find((item) => item.ref === i + 1));
    const xs = drawn.map((item) => item?.x ?? Number.NaN);
    for (let i = 1; i < xs.length; i++) expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeCloseTo(17);
    // Every post sits on the line through the anchors: x advances 17 px per 19 px row.
    const first = drawn[0];
    for (const item of drawn) {
      for (const post of item?.palisadePosts ?? []) {
        const x = (item?.x ?? 0) + post.dx - (first?.x ?? 0);
        const y = (item?.y ?? 0) + post.dy - (first?.y ?? 0);
        expect(x).toBeCloseTo((-y * 17) / 19);
      }
    }

    const row = buildSpriteScene(snapshotOf([palisade(1, 10, 10), palisade(2, 11, 10)]));
    for (const item of row) expect((item.x + PALISADE_STAGGER_PX) % 34).toBe(0);
    const column = buildSpriteScene(
      snapshotOf([palisade(1, 10, 9), palisade(2, 10, 10), palisade(3, 10, 11), palisade(4, 10, 12)]),
    );
    for (const item of column) expect(item.x % 34).toBe(0);
  });

  it('staggers the riser of a shallow line and keeps the corners of a rectangle square', () => {
    const shallow = buildSpriteScene(
      snapshotOf([palisade(1, 9, 10), palisade(2, 10, 10), palisade(3, 10, 9), palisade(4, 11, 9)]),
    );
    const xOf = (items: typeof shallow, ref: number): number =>
      items.find((i) => i.ref === ref)?.x ?? Number.NaN;
    // Row 10 steps up at column 10 to row 9: staggered, the riser leans the way the line runs.
    expect(xOf(shallow, 3) - xOf(shallow, 2)).toBe(2 * PALISADE_STAGGER_PX);

    const corner = buildSpriteScene(
      snapshotOf([palisade(1, 10, 10), palisade(2, 10, 11), palisade(3, 10, 12), palisade(4, 11, 12)]),
    );
    for (const ref of [1, 2, 3]) expect(xOf(corner, ref) % 34).toBe(0);
  });

  it('plans a line where its walls will stand among the standing ones, and a standing piece where it is', () => {
    const standing = snapshotOf([palisade(1, 10, 10), palisade(2, 11, 10)]);
    const row = palisadeLayoutOf(standing);
    const rowEnd = buildSpriteScene(standing).find((item) => item.ref === 2);
    // The row's end under the cursor, and a lone stake beside it that extends the row.
    expect(planShiftX([{ hx: 11, hy: 10 }], row)).toEqual([(rowEnd?.x ?? 0) - 11 * 34]);
    expect(planShiftX([{ hx: 12, hy: 10 }], row)).toEqual([-PALISADE_STAGGER_PX]);
    expect(planShiftX([{ hx: 12, hy: 10 }])).toEqual([0]);

    const column = palisadeLayoutOf(
      snapshotOf([palisade(1, 10, 8), palisade(2, 10, 9), palisade(3, 10, 10)]),
    );
    const extended = [
      { hx: 10, hy: 10 },
      { hx: 10, hy: 11 },
    ];
    expect(planShiftX(extended, column)).toEqual([0, 0]);
  });

  it('draws unfinished segments as ground markers and excludes them from wall connections', () => {
    const unclaimed = palisade(2, 1, 0, (ONE / 2) as Fixed);
    const claimed = palisade(3, 2, 0, (ONE / 2) as Fixed);
    (unclaimed.components as Record<string, unknown>).Palisade = {
      ...unclaimed.components.Palisade,
      reservation: null,
    };
    (claimed.components as Record<string, unknown>).Palisade = {
      ...claimed.components.Palisade,
      reservation: { builder: 40 },
    };
    const items = buildSpriteScene(snapshotOf([palisade(1, 0, 0), unclaimed, claimed]));
    expect(items.find((item) => item.ref === 2)?.palisadeSite).toBe('unclaimed');
    expect(items.find((item) => item.ref === 3)?.palisadeSite).toBe('claimed');
    expect(items.flatMap((item) => item.palisadePosts ?? [])).toEqual([]);
  });

  it('keeps the flag, and no heap, at a site whose wood is in until its strike raises the wall', () => {
    const stocked = palisade(2, 1, 0, 0 as Fixed);
    (stocked.components as Record<string, unknown>).Palisade = {
      ...stocked.components.Palisade,
      reservation: { builder: 40 },
    };
    (stocked.components as Record<string, unknown>).Stockpile = { amounts: [[5, 1]] };
    const items = buildSpriteScene(snapshotOf([palisade(1, 0, 0), stocked]));
    const item = items.find((drawn) => drawn.ref === 2);
    expect(item?.palisadeSite).toBe('claimed');
    expect(item?.goodType).toBeUndefined();
    expect(items.flatMap((drawn) => drawn.palisadePosts ?? [])).toEqual([]);
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

  it('staggers the outer posts a gate leaves standing on its terminals with the gate', () => {
    const gate = palisade(2, 10, 10, ONE, 697);
    const items = buildSpriteScene(
      snapshotOf([
        palisade(1, 8, 10),
        {
          ...gate,
          components: {
            ...gate.components,
            Palisade: {
              ...gate.components.Palisade,
              walk: [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 })),
              gate: { open: false, counterpartGfxIndex: 701 },
            },
          },
        },
        palisade(3, 12, 10),
      ]),
    );
    for (const ref of [1, 2, 3]) {
      const x = items.find((item) => item.ref === ref)?.x ?? Number.NaN;
      expect((x + PALISADE_STAGGER_PX) % 34, `ref ${ref}`).toBe(0);
    }
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

  it('interpolates the source durability ladder for damaged finished posts', () => {
    const items = buildSpriteScene(snapshotOf([damagedPalisade(1, 0, 0, 80), damagedPalisade(2, 1, 0, 20)]));
    const edge = items.flatMap((item) => item.palisadePosts ?? []);
    expect(items.find((item) => item.ref === 1)?.builtPct).toBe(80);
    expect(edge.map((post) => post.builtPct)).toEqual([60, 40]);
  });
});
